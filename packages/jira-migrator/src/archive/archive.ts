import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  canonicalizeJson,
  sha256,
  sha256CanonicalJson,
} from "./canonicalJson.js";
import {
  type ArchiveRawPayloadInput,
  type CreateRawArchiveOptions,
  type JsonValue,
  RAW_ARCHIVE_ENTITY_KINDS,
  RAW_ARCHIVE_SOURCE_IDENTITY_REQUIRED_KEYS,
  type RawArchiveClassification,
  type RawArchiveEntityKind,
  type RawArchiveEntryV1,
  type RawArchiveEnvelopeV1,
  RawArchiveError,
  type RawArchiveErrorCode,
  type RawArchiveManifestV1,
  type RawArchivePermissionVerification,
  type RawArchiveReference,
  type RawArchiveRetention,
  type RawArchiveSourceEndpoint,
  type RawArchiveSourceIdentity,
  type RawArchiveSourceScope,
  type RawArchiveVerificationSummary,
  type RawArchiveVersionV1,
} from "./model.js";
import {
  assertSafeArchivePathSyntax,
  assertSecureNode,
  ensureSecureDirectory,
  validateRawArchivePermissionVerification,
} from "./permissions.js";

const HEX_64 = /^[a-f0-9]{64}$/u;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FORBIDDEN_METADATA_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
]);

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

function fail(code: RawArchiveErrorCode): never {
  throw new RawArchiveError(code);
}

const assertIso = (value: string, future = false): void => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || (future && timestamp <= Date.now())) {
    fail("invalid_archive_configuration");
  }
};

const assertManifestIso = (value: string): void => {
  if (!Number.isFinite(Date.parse(value))) fail("manifest_malformed");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: RawArchiveErrorCode,
): void => {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) fail(code);
};

const sanitizeSourceEndpoint = (value: unknown): RawArchiveSourceEndpoint => {
  if (!isRecord(value)) fail("invalid_source_metadata");
  assertExactKeys(
    value,
    ["method", "pathname", "pagination"],
    "invalid_source_metadata",
  );
  if (
    value.method !== "GET" ||
    typeof value.pathname !== "string" ||
    !value.pathname.startsWith("/") ||
    value.pathname.includes("?") ||
    value.pathname.includes("#") ||
    value.pathname.includes("://")
  ) {
    fail("invalid_source_metadata");
  }
  if (value.pagination === undefined) {
    return { method: "GET", pathname: value.pathname };
  }
  if (!isRecord(value.pagination)) fail("invalid_source_metadata");
  assertExactKeys(
    value.pagination,
    ["start_at", "max_results", "next_page_token"],
    "invalid_source_metadata",
  );
  const startAt = value.pagination.start_at;
  const maxResults = value.pagination.max_results;
  const pageCursor = value.pagination.next_page_token;
  if (
    (startAt !== undefined &&
      (!Number.isSafeInteger(startAt) || Number(startAt) < 0)) ||
    (maxResults !== undefined &&
      (!Number.isSafeInteger(maxResults) || Number(maxResults) <= 0)) ||
    (pageCursor !== undefined &&
      (typeof pageCursor !== "string" || pageCursor.length === 0))
  ) {
    fail("invalid_source_metadata");
  }
  const pagination = {
    ...(startAt === undefined ? {} : { start_at: Number(startAt) }),
    ...(maxResults === undefined ? {} : { max_results: Number(maxResults) }),
    ...(pageCursor === undefined ? {} : { next_page_token: pageCursor }),
  };
  if (Object.keys(pagination).length === 0) fail("invalid_source_metadata");
  return {
    method: "GET",
    pathname: value.pathname,
    pagination,
  };
};

const assertSourceIdentity: (
  value: unknown,
  entityKind: RawArchiveEntityKind,
  sourceScope: RawArchiveSourceScope,
) => asserts value is { [key: string]: JsonValue } = (
  value,
  entityKind,
  sourceScope,
) => {
  if (!isRecord(value)) fail("invalid_source_metadata");
  for (const key of RAW_ARCHIVE_SOURCE_IDENTITY_REQUIRED_KEYS[entityKind]) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      fail("invalid_source_metadata");
    }
  }
  if (
    value.cloud_id !== sourceScope.cloud_id ||
    (value.project_key !== undefined &&
      value.project_key !== sourceScope.project_key) ||
    (value.entity_kind !== undefined && value.entity_kind !== entityKind)
  ) {
    fail("invalid_source_metadata");
  }
};

const assertNoForbiddenMetadata = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenMetadata(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      fail("invalid_source_metadata");
    }
    assertNoForbiddenMetadata(child);
  }
};

const valueContainsSecret = (value: unknown, secret: string): boolean => {
  if (typeof value === "string") return value.includes(secret);
  if (Array.isArray(value)) {
    return value.some((item) => valueContainsSecret(item, secret));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      key.includes(secret) || valueContainsSecret(child, secret),
  );
};

const assertNoSecret = (
  values: readonly string[],
  ...inputs: unknown[]
): void => {
  for (const secret of values) {
    if (!secret) continue;
    if (inputs.some((value) => valueContainsSecret(value, secret))) {
      fail("secret_material_detected");
    }
  }
};

const assertInside = (root: string, path: string): void => {
  const rel = relative(root, path);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  fail("path_outside_archive");
};

const writeExclusiveFile = async (
  path: string,
  bytes: string,
): Promise<void> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") throw error;
    fail("archive_io_failed");
  } finally {
    await handle?.close();
  }
};

const parseJson = (bytes: string, code: RawArchiveErrorCode): unknown => {
  try {
    return JSON.parse(bytes);
  } catch {
    fail(code);
  }
};

const assertString: (value: unknown) => asserts value is string = (value) => {
  if (typeof value !== "string" || value.length === 0)
    fail("manifest_malformed");
};

const parseEnvelope = (value: unknown): RawArchiveEnvelopeV1 => {
  if (!isRecord(value)) fail("manifest_malformed");
  assertExactKeys(
    value,
    ["envelope_schema_version", "manifest_sha256", "manifest"],
    "manifest_malformed",
  );
  if (value.envelope_schema_version !== 1) fail("unsupported_schema_version");
  assertString(value.manifest_sha256);
  if (!HEX_64.test(value.manifest_sha256)) fail("manifest_malformed");
  if (!isRecord(value.manifest)) fail("manifest_malformed");
  const manifest = value.manifest;
  assertExactKeys(
    manifest,
    [
      "schema_version",
      "run_id",
      "source_scope",
      "created_at",
      "retention",
      "permission_verification",
      "entries",
    ],
    "manifest_malformed",
  );
  if (manifest.schema_version !== 1) fail("unsupported_schema_version");
  assertString(manifest.run_id);
  assertString(manifest.created_at);
  assertManifestIso(manifest.created_at);
  if (!isRecord(manifest.source_scope)) fail("manifest_malformed");
  assertExactKeys(
    manifest.source_scope,
    ["cloud_id", "project_key"],
    "manifest_malformed",
  );
  assertString(manifest.source_scope.cloud_id);
  assertString(manifest.source_scope.project_key);
  if (!isRecord(manifest.retention)) fail("manifest_malformed");
  assertExactKeys(
    manifest.retention,
    ["owner", "retention_until", "policy_ref"],
    "manifest_malformed",
  );
  assertString(manifest.retention.owner);
  assertString(manifest.retention.retention_until);
  assertString(manifest.retention.policy_ref);
  assertManifestIso(manifest.retention.retention_until);
  if (!isRecord(manifest.permission_verification)) fail("manifest_malformed");
  const permissionKind = manifest.permission_verification.kind;
  if (permissionKind === "posix_mode") {
    assertExactKeys(
      manifest.permission_verification,
      ["kind", "verified"],
      "manifest_malformed",
    );
    if (manifest.permission_verification.verified !== true)
      fail("manifest_malformed");
  } else if (permissionKind === "external_acl") {
    assertExactKeys(
      manifest.permission_verification,
      ["kind", "verified_by", "verified_at"],
      "manifest_malformed",
    );
    assertString(manifest.permission_verification.verified_by);
    assertString(manifest.permission_verification.verified_at);
    assertManifestIso(manifest.permission_verification.verified_at);
  } else {
    fail("manifest_malformed");
  }
  if (!Array.isArray(manifest.entries)) fail("manifest_malformed");
  for (const entry of manifest.entries) {
    if (!isRecord(entry)) fail("manifest_malformed");
    assertExactKeys(
      entry,
      [
        "entry_id",
        "entity_kind",
        "source_identity",
        "source_endpoint",
        "classification",
        "redaction_status",
        "versions",
        "current_sha256",
      ],
      "manifest_malformed",
    );
    assertString(entry.entry_id);
    assertString(entry.current_sha256);
    if (!HEX_64.test(entry.entry_id) || !HEX_64.test(entry.current_sha256)) {
      fail("manifest_malformed");
    }
    if (
      !RAW_ARCHIVE_ENTITY_KINDS.includes(
        entry.entity_kind as RawArchiveEntityKind,
      )
    ) {
      fail("manifest_malformed");
    }
    if (!isRecord(entry.source_identity) || !isRecord(entry.source_endpoint)) {
      fail("manifest_malformed");
    }
    try {
      sanitizeSourceEndpoint(entry.source_endpoint);
    } catch {
      fail("manifest_malformed");
    }
    if (
      entry.source_endpoint.method !== "GET" ||
      typeof entry.source_endpoint.pathname !== "string" ||
      (entry.classification !== "internal" &&
        entry.classification !== "restricted_pii") ||
      entry.redaction_status !== "not_redacted_verified_no_configured_secret"
    ) {
      fail("manifest_malformed");
    }
    if (!Array.isArray(entry.versions) || entry.versions.length === 0) {
      fail("manifest_malformed");
    }
    for (const version of entry.versions) {
      if (!isRecord(version)) fail("manifest_malformed");
      assertExactKeys(
        version,
        ["sha256", "byte_size", "relative_path", "fetched_at"],
        "manifest_malformed",
      );
      assertString(version.sha256);
      assertString(version.relative_path);
      assertString(version.fetched_at);
      assertManifestIso(version.fetched_at);
      if (
        !HEX_64.test(version.sha256) ||
        !Number.isSafeInteger(version.byte_size) ||
        Number(version.byte_size) < 0
      ) {
        fail("manifest_malformed");
      }
    }
  }
  return value as unknown as RawArchiveEnvelopeV1;
};

const envelopeFor = (manifest: RawArchiveManifestV1): RawArchiveEnvelopeV1 => ({
  envelope_schema_version: 1,
  manifest_sha256: sha256CanonicalJson(manifest as unknown as JsonValue),
  manifest,
});

const objectRelativePath = (digest: string): string =>
  `objects/sha256/${digest.slice(0, 2)}/${digest}.json`;

const entryIdFor = (
  sourceScope: RawArchiveSourceScope,
  entityKind: RawArchiveEntityKind,
  sourceIdentity: { [key: string]: JsonValue },
): string =>
  sha256CanonicalJson({
    source_scope: sourceScope,
    entity_kind: entityKind,
    source_identity: sourceIdentity,
  } as unknown as JsonValue);

export class RawArchive {
  readonly root: string;
  readonly runId: string;
  private readonly options: CreateRawArchiveOptions;
  private readonly permissionModel: "posix" | "windows";

  constructor(options: CreateRawArchiveOptions) {
    assertSafeArchivePathSyntax(options.root);
    const permissionVerification: RawArchivePermissionVerification =
      options.permissionVerification.kind === "external_acl"
        ? {
            kind: "external_acl",
            verified_by: options.permissionVerification.verified_by,
            verified_at: options.permissionVerification.verified_at,
          }
        : {
            kind: "posix_mode",
            verified: options.permissionVerification.verified,
          };
    this.options = {
      root: options.root,
      runId: options.runId,
      sourceScope: { ...options.sourceScope },
      createdAt: options.createdAt,
      retention: { ...options.retention },
      permissionVerification,
      ...(options.forbiddenSecretValues === undefined
        ? {}
        : { forbiddenSecretValues: [...options.forbiddenSecretValues] }),
    };
    this.root = resolve(this.options.root);
    this.runId = this.options.runId;
    this.permissionModel = validateRawArchivePermissionVerification(
      this.options.permissionVerification,
    );
    this.validateConfiguration();
  }

  async archive(input: ArchiveRawPayloadInput): Promise<RawArchiveReference> {
    const prepared = this.prepareInput(input);
    await this.ensureLayout();
    const runDirectory = this.runDirectory();
    const lockPath = join(runDirectory, ".manifest.lock");
    try {
      await writeExclusiveFile(lockPath, "locked\n");
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") fail("lock_conflict");
      throw error;
    }
    try {
      await assertSecureNode(lockPath, "file", this.permissionModel);
      const manifest = await this.loadOrCreateManifest();
      const existing = manifest.entries.find(
        (entry) => entry.entry_id === prepared.entryId,
      );
      if (
        existing &&
        (existing.classification !== prepared.classification ||
          canonicalizeJson(existing.source_endpoint) !==
            canonicalizeJson(prepared.sourceEndpoint))
      ) {
        fail("entry_metadata_conflict");
      }
      const existingVersion = existing?.versions.find(
        (version) => version.sha256 === prepared.digest,
      );
      if (existingVersion) {
        await this.verifyObject(existingVersion);
        if (existing && existing.current_sha256 !== prepared.digest) {
          existing.current_sha256 = prepared.digest;
          await this.replaceManifest(manifest);
          await this.verifyEnvelopeAndObjects(true);
        }
        return this.reference(prepared.entryId, prepared.digest);
      }

      await this.writeObject(prepared.digest, prepared.canonicalPayload);
      const version: RawArchiveVersionV1 = {
        sha256: prepared.digest,
        byte_size: Buffer.byteLength(prepared.canonicalPayload),
        relative_path: objectRelativePath(prepared.digest),
        fetched_at: prepared.fetchedAt,
      };
      if (existing) {
        existing.versions.push(version);
        existing.current_sha256 = prepared.digest;
      } else {
        manifest.entries.push({
          entry_id: prepared.entryId,
          entity_kind: prepared.entityKind,
          source_identity: prepared.sourceIdentity,
          source_endpoint: prepared.sourceEndpoint,
          classification: prepared.classification,
          redaction_status: "not_redacted_verified_no_configured_secret",
          versions: [version],
          current_sha256: prepared.digest,
        });
      }
      manifest.entries.sort((left, right) =>
        left.entry_id.localeCompare(right.entry_id, "en"),
      );
      await this.replaceManifest(manifest);
      await this.verifyEnvelopeAndObjects(true);
      return this.reference(prepared.entryId, prepared.digest);
    } finally {
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }

  async read(reference: RawArchiveReference): Promise<JsonValue> {
    if (reference.runId !== this.runId) fail("reference_not_found");
    await this.assertNoLock();
    const envelope = await this.verifyEnvelopeAndObjects(false);
    const entry = envelope.manifest.entries.find(
      (candidate) => candidate.entry_id === reference.entryId,
    );
    const version = entry?.versions.find(
      (candidate) => candidate.sha256 === reference.contentSha256,
    );
    if (!version) fail("reference_not_found");
    return this.readObject(version);
  }

  async verify(): Promise<RawArchiveVerificationSummary> {
    await this.assertNoLock();
    const envelope = await this.verifyEnvelopeAndObjects(false);
    return {
      runId: envelope.manifest.run_id,
      manifestSha256: envelope.manifest_sha256,
      entryCount: envelope.manifest.entries.length,
      objectCount: new Set(
        envelope.manifest.entries.flatMap((entry) =>
          entry.versions.map((version) => version.sha256),
        ),
      ).size,
      permissionVerification: envelope.manifest.permission_verification,
    };
  }

  private validateConfiguration(): void {
    if (!SAFE_RUN_ID.test(this.runId) || !isAbsolute(this.options.root)) {
      fail("invalid_archive_configuration");
    }
    const { sourceScope, retention, permissionVerification } = this.options;
    if (
      !isRecord(sourceScope) ||
      !isRecord(retention) ||
      !isRecord(permissionVerification)
    ) {
      fail("invalid_archive_configuration");
    }
    assertExactKeys(
      sourceScope,
      ["cloud_id", "project_key"],
      "invalid_archive_configuration",
    );
    assertExactKeys(
      retention,
      ["owner", "retention_until", "policy_ref"],
      "invalid_archive_configuration",
    );
    if (!sourceScope.cloud_id || !sourceScope.project_key) {
      fail("invalid_archive_configuration");
    }
    if (!retention.owner || !retention.policy_ref) {
      fail("invalid_archive_configuration");
    }
    assertIso(this.options.createdAt);
    assertIso(retention.retention_until, true);
    validateRawArchivePermissionVerification(permissionVerification);
  }

  private prepareInput(input: ArchiveRawPayloadInput): {
    entryId: string;
    digest: string;
    canonicalPayload: string;
    entityKind: RawArchiveEntityKind;
    sourceIdentity: RawArchiveSourceIdentity;
    sourceEndpoint: RawArchiveSourceEndpoint;
    classification: RawArchiveClassification;
    fetchedAt: string;
  } {
    const entityKind = input.entityKind;
    const classification = input.classification;
    const fetchedAt = input.fetchedAt;
    if (!RAW_ARCHIVE_ENTITY_KINDS.includes(entityKind)) {
      fail("invalid_source_metadata");
    }
    assertSourceIdentity(
      input.sourceIdentity,
      entityKind,
      this.options.sourceScope,
    );
    const sourceIdentity = JSON.parse(
      canonicalizeJson(input.sourceIdentity),
    ) as RawArchiveSourceIdentity;
    if (classification !== "internal" && classification !== "restricted_pii") {
      fail("invalid_source_metadata");
    }
    const sourceEndpoint = sanitizeSourceEndpoint(input.sourceEndpoint);
    assertIso(fetchedAt);
    assertNoForbiddenMetadata(input.metadata);
    assertNoForbiddenMetadata(sourceIdentity);
    assertNoForbiddenMetadata(sourceEndpoint);
    const canonicalPayload = canonicalizeJson(input.payload);
    const archiveMetadata = {
      archive: {
        run_id: this.runId,
        source_scope: this.options.sourceScope,
        created_at: this.options.createdAt,
        retention: this.options.retention,
        permission_verification: this.options.permissionVerification,
      },
      source_identity: sourceIdentity,
      source_endpoint: sourceEndpoint,
      metadata: input.metadata ?? null,
    };
    canonicalizeJson(archiveMetadata);
    assertNoSecret(
      this.options.forbiddenSecretValues ?? [],
      input.payload,
      archiveMetadata,
    );
    return {
      entryId: entryIdFor(this.options.sourceScope, entityKind, sourceIdentity),
      digest: sha256(canonicalPayload),
      canonicalPayload,
      entityKind,
      sourceIdentity,
      sourceEndpoint,
      classification,
      fetchedAt,
    };
  }

  private runDirectory(): string {
    const path = join(this.root, "runs", this.runId);
    assertInside(this.root, path);
    return path;
  }

  private manifestPath(): string {
    return join(this.runDirectory(), "manifest.json");
  }

  private async ensureLayout(): Promise<void> {
    await ensureSecureDirectory(this.root, this.permissionModel);
    await ensureSecureDirectory(
      join(this.root, "objects"),
      this.permissionModel,
    );
    await ensureSecureDirectory(
      join(this.root, "objects", "sha256"),
      this.permissionModel,
    );
    await ensureSecureDirectory(join(this.root, "runs"), this.permissionModel);
    await ensureSecureDirectory(this.runDirectory(), this.permissionModel);
  }

  private initialManifest(): RawArchiveManifestV1 {
    return {
      schema_version: 1,
      run_id: this.runId,
      source_scope: this.options.sourceScope,
      created_at: this.options.createdAt,
      retention: this.options.retention,
      permission_verification: this.options.permissionVerification,
      entries: [],
    };
  }

  private async loadOrCreateManifest(): Promise<RawArchiveManifestV1> {
    try {
      await lstat(this.manifestPath());
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT")
        return this.initialManifest();
      fail("archive_io_failed");
    }
    return (await this.verifyEnvelopeAndObjects(true)).manifest;
  }

  private assertManifestIdentity(manifest: RawArchiveManifestV1): void {
    if (
      manifest.run_id !== this.runId ||
      canonicalizeJson(manifest.source_scope) !==
        canonicalizeJson(this.options.sourceScope) ||
      manifest.created_at !== this.options.createdAt ||
      canonicalizeJson(manifest.retention) !==
        canonicalizeJson(this.options.retention) ||
      canonicalizeJson(manifest.permission_verification) !==
        canonicalizeJson(this.options.permissionVerification)
    ) {
      fail("manifest_malformed");
    }
  }

  private async writeObject(digest: string, bytes: string): Promise<void> {
    const directory = join(this.root, "objects", "sha256", digest.slice(0, 2));
    await ensureSecureDirectory(directory, this.permissionModel);
    const path = join(directory, `${digest}.json`);
    assertInside(this.root, path);
    try {
      await writeExclusiveFile(path, bytes);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    await assertSecureNode(path, "file", this.permissionModel);
    await this.verifyObject({
      sha256: digest,
      byte_size: Buffer.byteLength(bytes),
      relative_path: objectRelativePath(digest),
      fetched_at: this.options.createdAt,
    });
  }

  private async replaceManifest(manifest: RawArchiveManifestV1): Promise<void> {
    const envelope = envelopeFor(manifest);
    const bytes = canonicalizeJson(envelope as unknown as JsonValue);
    const temporary = join(
      this.runDirectory(),
      `.manifest.${randomUUID()}.tmp`,
    );
    assertInside(this.root, temporary);
    try {
      await writeExclusiveFile(temporary, bytes);
      await assertSecureNode(temporary, "file", this.permissionModel);
      await rename(temporary, this.manifestPath());
      if (this.permissionModel === "posix") {
        const directoryHandle = await open(dirname(this.manifestPath()), "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async assertNoLock(): Promise<void> {
    try {
      await lstat(join(this.runDirectory(), ".manifest.lock"));
      fail("lock_conflict");
    } catch (error) {
      if (error instanceof RawArchiveError) throw error;
      if (isNodeError(error) && error.code === "ENOENT") return;
      fail("archive_io_failed");
    }
  }

  private async verifyEnvelopeAndObjects(
    allowLock: boolean,
  ): Promise<RawArchiveEnvelopeV1> {
    if (!allowLock) await this.assertNoLock();
    await assertSecureNode(this.root, "directory", this.permissionModel);
    await assertSecureNode(
      join(this.root, "objects"),
      "directory",
      this.permissionModel,
    );
    await assertSecureNode(
      join(this.root, "objects", "sha256"),
      "directory",
      this.permissionModel,
    );
    await assertSecureNode(
      join(this.root, "runs"),
      "directory",
      this.permissionModel,
    );
    await assertSecureNode(
      this.runDirectory(),
      "directory",
      this.permissionModel,
    );
    let bytes: string;
    try {
      bytes = await readFile(this.manifestPath(), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT")
        fail("manifest_missing");
      fail("archive_io_failed");
    }
    await assertSecureNode(this.manifestPath(), "file", this.permissionModel);
    const envelope = parseEnvelope(parseJson(bytes, "manifest_malformed"));
    if (canonicalizeJson(envelope) !== bytes) fail("manifest_malformed");
    const checksum = sha256CanonicalJson(
      envelope.manifest as unknown as JsonValue,
    );
    if (checksum !== envelope.manifest_sha256)
      fail("manifest_checksum_mismatch");
    this.assertManifestIdentity(envelope.manifest);
    assertNoSecret(this.options.forbiddenSecretValues ?? [], envelope.manifest);
    const entryIds = new Set<string>();
    let previousEntryId: string | null = null;
    for (const entry of envelope.manifest.entries) {
      try {
        assertSourceIdentity(
          entry.source_identity,
          entry.entity_kind,
          envelope.manifest.source_scope,
        );
      } catch {
        fail("manifest_malformed");
      }
      if (
        entry.entry_id !==
          entryIdFor(
            envelope.manifest.source_scope,
            entry.entity_kind,
            entry.source_identity,
          ) ||
        entryIds.has(entry.entry_id) ||
        (previousEntryId !== null && previousEntryId > entry.entry_id)
      ) {
        fail("manifest_malformed");
      }
      entryIds.add(entry.entry_id);
      previousEntryId = entry.entry_id;
      const versionDigests = new Set<string>();
      for (const version of entry.versions) {
        if (versionDigests.has(version.sha256)) fail("manifest_malformed");
        versionDigests.add(version.sha256);
      }
      if (!versionDigests.has(entry.current_sha256)) fail("manifest_malformed");
      for (const version of entry.versions) await this.verifyObject(version);
    }
    return envelope;
  }

  private async verifyObject(version: RawArchiveVersionV1): Promise<JsonValue> {
    const expected = objectRelativePath(version.sha256);
    if (version.relative_path !== expected) fail("path_outside_archive");
    const path = resolve(this.root, version.relative_path);
    assertInside(this.root, path);
    await assertSecureNode(dirname(path), "directory", this.permissionModel);
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") fail("object_missing");
      fail("archive_io_failed");
    }
    await assertSecureNode(path, "file", this.permissionModel);
    if (bytes.byteLength !== version.byte_size) fail("object_size_mismatch");
    if (sha256(bytes) !== version.sha256) fail("object_checksum_mismatch");
    const text = bytes.toString("utf8");
    const parsed = parseJson(text, "object_malformed_json");
    assertNoSecret(this.options.forbiddenSecretValues ?? [], parsed);
    let canonical: string;
    try {
      canonical = canonicalizeJson(parsed as JsonValue);
    } catch {
      fail("object_malformed_json");
    }
    if (canonical !== text) fail("object_malformed_json");
    return parsed as JsonValue;
  }

  private async readObject(version: RawArchiveVersionV1): Promise<JsonValue> {
    return this.verifyObject(version);
  }

  private reference(
    entryId: string,
    contentSha256: string,
  ): RawArchiveReference {
    return { runId: this.runId, entryId, contentSha256 };
  }
}

export const createRawArchive = (
  options: CreateRawArchiveOptions,
): RawArchive => new RawArchive(options);

export const readRawArchiveReference = async (
  options: CreateRawArchiveOptions,
  reference: RawArchiveReference,
): Promise<JsonValue> => createRawArchive(options).read(reference);

export const verifyRawArchive = async (
  options: CreateRawArchiveOptions,
): Promise<RawArchiveVerificationSummary> => createRawArchive(options).verify();

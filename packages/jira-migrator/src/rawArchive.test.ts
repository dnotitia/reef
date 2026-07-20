import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ArchiveRawPayloadInput,
  type CreateRawArchiveOptions,
  type JsonValue,
  type RawArchiveEnvelopeV1,
  RawArchiveError,
  type RawArchiveSourceIdentity,
  canonicalizeJson,
  createRawArchive,
  sha256CanonicalJson,
  validateRawArchivePermissionVerification,
} from "./rawArchive.js";

const tempDirectories: string[] = [];
const FUTURE = "2999-01-01T00:00:00.000Z";
const NOW = "2026-07-10T12:00:00.000Z";

const makeBase = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "reef-raw-archive-test-"));
  tempDirectories.push(path);
  return path;
};

const options = (root: string, runId = "run-001"): CreateRawArchiveOptions => ({
  root,
  runId,
  sourceScope: { cloud_id: "cloud-abc", project_key: "ALPHA" },
  createdAt: NOW,
  retention: {
    owner: "migration-operator",
    retention_until: FUTURE,
    policy_ref: "policy://jira-archive-v1",
  },
  permissionVerification: { kind: "posix_mode", verified: true },
  forbiddenSecretValues: ["canary-x"],
});

const input = (
  overrides: Partial<ArchiveRawPayloadInput> = {},
): ArchiveRawPayloadInput => ({
  entityKind: "issue",
  sourceIdentity: {
    cloud_id: "cloud-abc",
    project_key: "ALPHA",
    issue_id: "10001",
  },
  sourceEndpoint: { method: "GET", pathname: "/rest/api/3/issue/10001" },
  classification: "internal",
  fetchedAt: NOW,
  payload: { id: 10001, key: "ALPHA-1", order: [3, 2, 1] },
  ...overrides,
});

const readEnvelope = async (
  root: string,
  runId = "run-001",
): Promise<RawArchiveEnvelopeV1> =>
  JSON.parse(
    await readFile(join(root, "runs", runId, "manifest.json"), "utf8"),
  );

const writeEnvelope = async (
  root: string,
  envelope: RawArchiveEnvelopeV1,
  runId = "run-001",
): Promise<void> => {
  await writeFile(
    join(root, "runs", runId, "manifest.json"),
    canonicalizeJson(envelope as unknown as JsonValue),
    { mode: 0o600 },
  );
};

const errorCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "no_error";
  } catch (error) {
    expect(error).toBeInstanceOf(RawArchiveError);
    return (error as RawArchiveError).code;
  }
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RFC 8785 JSON canonicalization", () => {
  it("matches the RFC serialization example and rejects non-I-JSON values", () => {
    const value = {
      numbers: [Number("333333333.33333329"), 1e30, 4.5, 0.002, 1e-27],
      string: '€$\u000f\nA\'B"\\"/',
      literals: [null, true, false],
    };
    expect(canonicalizeJson(value)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\"/"}',
    );
    expect(() => canonicalizeJson({ value: Number.NaN })).toThrow(
      "invalid_json_value",
    );
    expect(() => canonicalizeJson({ value: "\ud800" })).toThrow(
      "invalid_json_value",
    );
  });

  it("makes object insertion order irrelevant while preserving array order", () => {
    const left = { z: 1, a: { y: 2, x: 3 }, array: [2, 1] };
    const right = { array: [2, 1], a: { x: 3, y: 2 }, z: 1 };
    expect(canonicalizeJson(left)).toBe(canonicalizeJson(right));
    expect(sha256CanonicalJson(left)).toBe(sha256CanonicalJson(right));
    expect(canonicalizeJson({ array: [1, 2] })).not.toBe(
      canonicalizeJson({ array: [2, 1] }),
    );
  });
});

describe("RawArchive", () => {
  it("deduplicates retries and content across runs", async () => {
    const root = join(await makeBase(), "archive");
    const firstArchive = createRawArchive(options(root));
    const first = await firstArchive.archive(input());
    const manifestBefore = await readFile(
      join(root, "runs", "run-001", "manifest.json"),
      "utf8",
    );
    const second = await firstArchive.archive(
      input({ payload: { order: [3, 2, 1], key: "ALPHA-1", id: 10001 } }),
    );
    expect(second).toEqual(first);
    expect(
      await readFile(join(root, "runs", "run-001", "manifest.json"), "utf8"),
    ).toBe(manifestBefore);

    const otherRun = createRawArchive(options(root, "run-002"));
    await otherRun.archive(input());
    const prefix = first.contentSha256.slice(0, 2);
    expect(await readdir(join(root, "objects", "sha256", prefix))).toEqual([
      `${first.contentSha256}.json`,
    ]);
  });

  it("preserves prior versions and converges entry ordering", async () => {
    const base = await makeBase();
    const root = join(base, "archive-a");
    const archive = createRawArchive(options(root));
    const original = await archive.archive(input());
    const changed = await archive.archive(
      input({ payload: { changed: true } }),
    );
    const envelope = await readEnvelope(root);
    expect(
      envelope.manifest.entries[0]?.versions.map((item) => item.sha256),
    ).toEqual([original.contentSha256, changed.contentSha256]);
    expect(envelope.manifest.entries[0]?.current_sha256).toBe(
      changed.contentSha256,
    );
    await expect(archive.read(original)).resolves.toMatchObject({
      key: "ALPHA-1",
    });
    await archive.archive(input());
    expect((await readEnvelope(root)).manifest.entries[0]?.current_sha256).toBe(
      original.contentSha256,
    );

    const one = input({
      sourceIdentity: {
        cloud_id: "cloud-abc",
        project_key: "ALPHA",
        issue_id: "1",
      },
      payload: { id: 1 },
    });
    const two = input({
      sourceIdentity: {
        cloud_id: "cloud-abc",
        project_key: "ALPHA",
        issue_id: "2",
      },
      payload: { id: 2 },
    });
    const rootB = join(base, "archive-b");
    const rootC = join(base, "archive-c");
    const archiveB = createRawArchive(options(rootB));
    const archiveC = createRawArchive(options(rootC));
    await archiveB.archive(one);
    await archiveB.archive(two);
    await archiveC.archive(two);
    await archiveC.archive(one);
    expect((await archiveB.verify()).manifestSha256).toBe(
      (await archiveC.verify()).manifestSha256,
    );
  });

  it("round-trips raw-only values for downstream entity kinds", async () => {
    const root = join(await makeBase(), "archive");
    const archive = createRawArchive(options(root));
    const kinds = [
      "issue",
      "description_adf",
      "changelog_history",
      "watcher_list",
      "custom_field",
    ] as const;
    for (const [index, kind] of kinds.entries()) {
      const payload = {
        numeric_id: 10000 + index,
        unknown_raw_only: `marker-${kind}`,
        array_order: ["b", "a"],
      };
      const sourceIdentity: RawArchiveSourceIdentity =
        kind === "issue"
          ? {
              cloud_id: "cloud-abc",
              project_key: "ALPHA",
              issue_id: `raw-${index}`,
            }
          : kind === "changelog_history"
            ? {
                cloud_id: "cloud-abc",
                issue_id: `raw-${index}`,
                history_id: `history-${index}`,
              }
            : kind === "custom_field"
              ? {
                  cloud_id: "cloud-abc",
                  issue_id: `raw-${index}`,
                  entity_kind: kind,
                  field_id: `field-${index}`,
                }
              : {
                  cloud_id: "cloud-abc",
                  issue_id: `raw-${index}`,
                  entity_kind: kind,
                };
      const reference = await archive.archive(
        input({
          entityKind: kind,
          sourceIdentity,
          payload,
        }),
      );
      await expect(archive.read(reference)).resolves.toEqual(payload);
    }
  });

  it("fails closed for missing, tampered, and unsupported artifacts", async () => {
    const base = await makeBase();

    const missingRoot = join(base, "missing");
    const missingArchive = createRawArchive(options(missingRoot));
    await missingArchive.archive(input());
    await rm(join(missingRoot, "runs", "run-001", "manifest.json"));
    expect(await errorCode(missingArchive.verify())).toBe("manifest_missing");

    const tamperedRoot = join(base, "tampered");
    const tampered = createRawArchive(options(tamperedRoot));
    const reference = await tampered.archive(input());
    const envelope = await readEnvelope(tamperedRoot);
    const version = envelope.manifest.entries[0]?.versions[0];
    if (!version) throw new Error("missing test version");
    const objectPath = join(tamperedRoot, version.relative_path);
    const bytes = await readFile(objectPath);
    bytes[0] = bytes[0] === 0x7b ? 0x5b : 0x7b;
    await writeFile(objectPath, bytes, { mode: 0o600 });
    expect(await errorCode(tampered.read(reference))).toBe(
      "object_checksum_mismatch",
    );

    const schemaRoot = join(base, "schema");
    const schema = createRawArchive(options(schemaRoot));
    await schema.archive(input());
    const unsupported = await readEnvelope(schemaRoot);
    (
      unsupported as unknown as { envelope_schema_version: number }
    ).envelope_schema_version = 2;
    await writeEnvelope(schemaRoot, unsupported);
    expect(await errorCode(schema.verify())).toBe("unsupported_schema_version");
  });

  it("distinguishes size, malformed JSON, and manifest checksum failures", async () => {
    const base = await makeBase();

    const sizeRoot = join(base, "size");
    const sizeArchive = createRawArchive(options(sizeRoot));
    await sizeArchive.archive(input());
    const sizeEnvelope = await readEnvelope(sizeRoot);
    const sizeVersion = sizeEnvelope.manifest.entries[0]?.versions[0];
    if (!sizeVersion) throw new Error("missing test version");
    sizeVersion.byte_size += 1;
    sizeEnvelope.manifest_sha256 = sha256CanonicalJson(
      sizeEnvelope.manifest as unknown as JsonValue,
    );
    await writeEnvelope(sizeRoot, sizeEnvelope);
    expect(await errorCode(sizeArchive.verify())).toBe("object_size_mismatch");

    const checksumRoot = join(base, "manifest-checksum");
    const checksumArchive = createRawArchive(options(checksumRoot));
    await checksumArchive.archive(input());
    const checksumEnvelope = await readEnvelope(checksumRoot);
    checksumEnvelope.manifest.created_at = "2026-07-10T12:00:01.000Z";
    await writeEnvelope(checksumRoot, checksumEnvelope);
    expect(await errorCode(checksumArchive.verify())).toBe(
      "manifest_checksum_mismatch",
    );

    const canonicalRoot = join(base, "manifest-canonical");
    const canonicalArchive = createRawArchive(options(canonicalRoot));
    await canonicalArchive.archive(input());
    const canonicalPath = join(
      canonicalRoot,
      "runs",
      "run-001",
      "manifest.json",
    );
    await writeFile(
      canonicalPath,
      `${await readFile(canonicalPath, "utf8")}\n`,
      {
        mode: 0o600,
      },
    );
    expect(await errorCode(canonicalArchive.verify())).toBe(
      "manifest_malformed",
    );

    const malformedRoot = join(base, "malformed");
    const malformedArchive = createRawArchive(options(malformedRoot));
    await malformedArchive.archive(input());
    const malformedEnvelope = await readEnvelope(malformedRoot);
    const malformedVersion = malformedEnvelope.manifest.entries[0]?.versions[0];
    if (!malformedVersion) throw new Error("missing test version");
    const malformedBytes = "{";
    const digest = createHash("sha256").update(malformedBytes).digest("hex");
    const targetRelative = `objects/sha256/${digest.slice(0, 2)}/${digest}.json`;
    await mkdir(join(malformedRoot, "objects", "sha256", digest.slice(0, 2)), {
      mode: 0o700,
    });
    await writeFile(join(malformedRoot, targetRelative), malformedBytes, {
      mode: 0o600,
    });
    malformedVersion.sha256 = digest;
    malformedVersion.byte_size = 1;
    malformedVersion.relative_path = targetRelative;
    const malformedEntry = malformedEnvelope.manifest.entries[0];
    if (!malformedEntry) throw new Error("missing test entry");
    malformedEntry.current_sha256 = digest;
    malformedEnvelope.manifest_sha256 = sha256CanonicalJson(
      malformedEnvelope.manifest as unknown as JsonValue,
    );
    await writeEnvelope(malformedRoot, malformedEnvelope);
    expect(await errorCode(malformedArchive.verify())).toBe(
      "object_malformed_json",
    );
  });

  it("rejects concurrent writers, excessive permissions, and symlinks", async () => {
    const base = await makeBase();
    const root = join(base, "archive");
    const archive = createRawArchive(options(root));
    await archive.archive(input());
    const lock = join(root, "runs", "run-001", ".manifest.lock");
    await writeFile(lock, "locked\n", { mode: 0o600 });
    expect(await errorCode(archive.verify())).toBe("lock_conflict");
    await rm(lock);

    await chmod(root, 0o755);
    expect(await errorCode(archive.verify())).toBe("permission_violation");
    await chmod(root, 0o700);

    const symlinkRoot = join(base, "symlink-root");
    await symlink(root, symlinkRoot, "dir");
    const symlinkArchive = createRawArchive(options(symlinkRoot));
    expect(await errorCode(symlinkArchive.verify())).toBe(
      "symlink_not_allowed",
    );
  });

  it("rejects secrets and forbidden headers before creating archive files", async () => {
    const base = await makeBase();
    const secretRoot = join(base, "secret-archive");
    const archive = createRawArchive(options(secretRoot));
    const secretFailure = archive.archive(
      input({ payload: { token: "canary-x" } }),
    );
    expect(await errorCode(secretFailure)).toBe("secret_material_detected");
    await expect(lstat(secretRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const metadataRoot = join(base, "metadata-archive");
    const metadataArchive = createRawArchive(options(metadataRoot));
    expect(
      await errorCode(
        metadataArchive.archive(
          input({ metadata: { Authorization: "not-even-stored" } }),
        ),
      ),
    ).toBe("invalid_source_metadata");
    expect(
      await errorCode(
        archive.archive(
          input({
            sourceIdentity: {
              cloud_id: "cloud-abc",
              project_key: "ALPHA",
              issue_id: "undefined-pagination",
            },
            sourceEndpoint: {
              method: "GET",
              pathname: "/rest/api/3/search/jql",
              pagination: { next_page_token: undefined },
            },
          }),
        ),
      ),
    ).toBe("invalid_source_metadata");
    await expect(lstat(metadataRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const identityRoot = join(base, "identity-archive");
    const identityArchive = createRawArchive(options(identityRoot));
    expect(
      await errorCode(
        identityArchive.archive(input({ sourceIdentity: [] as never })),
      ),
    ).toBe("invalid_source_metadata");
    await expect(lstat(identityRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const escapedRoot = join(base, "escaped-secret-archive");
    const escapedCanary = 'line\nbreak\\with"quote';
    const escapedArchive = createRawArchive({
      ...options(escapedRoot),
      forbiddenSecretValues: [escapedCanary],
    });
    expect(
      await errorCode(
        escapedArchive.archive(input({ payload: { token: escapedCanary } })),
      ),
    ).toBe("secret_material_detected");
    await expect(lstat(escapedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("snapshots mutable caller input before asynchronous archive writes", async () => {
    const base = await makeBase();
    const root = join(base, "mutable-input");
    const mutableOptions = options(root);
    const archive = createRawArchive(mutableOptions);
    mutableOptions.sourceScope.cloud_id = "canary-x";
    mutableOptions.retention.owner = "canary-x";
    mutableOptions.forbiddenSecretValues = [];
    const sourceIdentity: RawArchiveSourceIdentity<"issue"> = {
      cloud_id: "cloud-abc",
      project_key: "ALPHA",
      issue_id: "mutable-10001",
    };
    const mutableInput = input({ sourceIdentity });

    const pending = archive.archive(mutableInput);
    sourceIdentity.issue_id = "canary-x";
    mutableInput.classification = "restricted_pii";
    mutableInput.fetchedAt = "2040-01-01T00:00:00.000Z";

    await pending;
    const envelope = await readEnvelope(root);
    expect(envelope.manifest.entries[0]).toMatchObject({
      classification: "internal",
      source_identity: { issue_id: "mutable-10001" },
      versions: [{ fetched_at: NOW }],
    });
    expect(JSON.stringify(envelope)).not.toContain("canary-x");
  });

  it("rejects invalid classification and non-allowlisted endpoint data before mutation", async () => {
    const root = join(await makeBase(), "metadata-boundary");
    const archive = createRawArchive(options(root));
    await archive.archive(
      input({
        sourceEndpoint: {
          method: "GET",
          pathname: "/rest/api/3/search/jql",
          pagination: { start_at: 0, max_results: 50, next_page_token: "next" },
        },
      }),
    );
    const manifestBefore = await readFile(
      join(root, "runs", "run-001", "manifest.json"),
      "utf8",
    );

    expect(
      await errorCode(
        archive.archive(
          input({
            classification: "public" as never,
            sourceIdentity: {
              cloud_id: "cloud-abc",
              project_key: "ALPHA",
              issue_id: "invalid-classification",
            },
          }),
        ),
      ),
    ).toBe("invalid_source_metadata");
    expect(
      await errorCode(
        archive.archive(
          input({
            sourceIdentity: {
              cloud_id: "cloud-abc",
              project_key: "ALPHA",
              issue_id: "invalid-endpoint",
            },
            sourceEndpoint: {
              method: "GET",
              pathname: "/rest/api/3/issue/10001",
              headers: { "X-Api-Key": "not-stored" },
            } as never,
          }),
        ),
      ),
    ).toBe("invalid_source_metadata");
    expect(
      await readFile(join(root, "runs", "run-001", "manifest.json"), "utf8"),
    ).toBe(manifestBefore);
    await expect(archive.verify()).resolves.toMatchObject({ entryCount: 1 });
  });

  it("rejects persisted run secrets and existing-entry metadata conflicts", async () => {
    const base = await makeBase();
    const runSecretRoot = join(base, "run-secret-boundary");
    const runSecretArchive = createRawArchive({
      ...options(runSecretRoot, "canary-x"),
      forbiddenSecretValues: ["canary-x"],
    });
    expect(await errorCode(runSecretArchive.archive(input()))).toBe(
      "secret_material_detected",
    );
    await expect(lstat(runSecretRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const root = join(base, "entry-metadata-boundary");
    const archive = createRawArchive(options(root));
    await archive.archive(input());
    const manifestBefore = await readFile(
      join(root, "runs", "run-001", "manifest.json"),
      "utf8",
    );
    expect(
      await errorCode(
        archive.archive(input({ classification: "restricted_pii" })),
      ),
    ).toBe("entry_metadata_conflict");
    expect(
      await errorCode(
        archive.archive(
          input({
            sourceEndpoint: {
              method: "GET",
              pathname: "/rest/api/3/issue/10001/properties",
            },
          }),
        ),
      ),
    ).toBe("entry_metadata_conflict");
    expect(
      await readFile(join(root, "runs", "run-001", "manifest.json"), "utf8"),
    ).toBe(manifestBefore);
  });

  it("requires retention and the host-specific permission acknowledgement", async () => {
    const base = await makeBase();
    expect(() =>
      createRawArchive({
        ...options(join(base, "expired")),
        retention: {
          owner: "operator",
          retention_until: "2020-01-01T00:00:00.000Z",
          policy_ref: "policy://archive",
        },
      }),
    ).toThrow("invalid_archive_configuration");
    expect(() =>
      validateRawArchivePermissionVerification(
        { kind: "posix_mode", verified: true },
        "win32",
      ),
    ).toThrow("invalid_archive_configuration");
    expect(() =>
      validateRawArchivePermissionVerification(
        {
          kind: "external_acl",
          verified_by: "operator",
          verified_at: NOW,
        },
        "win32",
      ),
    ).not.toThrow();
  });

  it("keeps traversal-like identities out of filesystem names", async () => {
    const root = join(await makeBase(), "archive");
    const archive = createRawArchive(options(root));
    await archive.archive(
      input({
        sourceIdentity: {
          cloud_id: "cloud-abc",
          project_key: "ALPHA",
          issue_id: "../민감/ALPHA-1",
        },
        payload: { marker: "pii-is-private" },
      }),
    );
    const tree = (
      await Promise.all(
        [join(root, "objects"), join(root, "runs")].map((path) =>
          readdir(path, { recursive: true }),
        ),
      )
    )
      .flat()
      .map(String);
    expect(tree.join("\n")).not.toContain("민감");
    expect(tree.join("\n")).not.toContain("ALPHA-1");
    expect(tree.join("\n")).not.toContain("..");
  });
});

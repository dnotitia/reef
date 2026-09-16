#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseAllDocuments, stringify } from "yaml";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_NAMESPACE = "reef";
const DEFAULT_ROLLOUT_DEADLINE_MS = 120_000;
const DEFAULT_ROLLOUT_POLL_MS = 1_000;
const DEFAULT_KUBERNETES_TIMEOUT_MS = 120_000;
const CREDENTIAL_ENV_KEYS = [
  "REEF_CONTROL_PLANE_TOKEN",
  "REEF_EVENT_PROCESSOR_AKB_TOKEN",
  "REEF_AKB_ADMIN_TOKEN",
  "AKB_DEPLOYMENT_TOKEN",
  "AKB_ADMIN_TOKEN",
];
const OCI_REPOSITORY_COMPONENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const OCI_REGISTRY_COMPONENT_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]+)?$/u;
const RUNTIME_IMAGES = Object.freeze({
  web: Object.freeze({ name: "reef-web", target: "reef-web" }),
  eventProcessor: Object.freeze({
    name: "reef-event-processor",
    target: "reef-event-processor",
  }),
});

const USAGE = `Usage:
  deploy/k8s/deploy.sh build --build-artifact <path> [options]
  deploy/k8s/deploy.sh deploy [options]
  deploy/k8s/deploy.sh register --build-artifact <path> [options]
  deploy/k8s/deploy.sh resume --source-rollout-id <uuid> [options]

Required environment:
  AKB_BACKEND_URL             AKB base URL (register/deploy/resume)
  REEF_CONTROL_PLANE_TOKEN    system-admin deployment credential (AKB modes)
  REGISTRY                    OCI registry prefix (build/deploy)

Options:
  --app-id <uuid>             persisted Reef App Definition id
  --build-artifact <path>    build identity artifact path
  --request-key <uuid>        idempotency key; reuse it to replay a request
  --source-rollout-id <uuid>  blocked rollout id for resume
  --receipt <path>            safe registration/rollout receipt to read/write
  --namespace <name>          Kubernetes namespace (default: reef)
  --kustomize-dir <path>      overlay directory (default: deploy/k8s/overlays/example)
  --rollout-deadline-ms <ms>  AKB observation deadline (default: 120000)
  --rollout-poll-ms <ms>      AKB observation interval (default: 1000)
  --help                      show this help
`;

export class DeploymentError extends Error {
  constructor(message, { stage, details = {} } = {}) {
    super(message);
    this.name = "DeploymentError";
    this.stage = stage ?? "deployment";
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      stage: this.stage,
      ...this.details,
    };
  }
}

export class DeploymentProcessError extends DeploymentError {
  constructor(command, args, exitCode, stage) {
    const rendered = [command, ...args].map((value) => String(value)).join(" ");
    super(`Deployment command failed: ${rendered} (exit ${exitCode})`, {
      stage,
      details: { command, exitCode },
    });
    this.name = "DeploymentProcessError";
  }
}

function safeEnv(input) {
  const env = { ...input };
  for (const key of CREDENTIAL_ENV_KEYS) delete env[key];
  return env;
}

export function defaultRunCommand(
  command,
  args,
  { cwd = DEFAULT_ROOT_DIR, env = safeEnv(process.env), input } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function runChecked(
  runCommand,
  command,
  args,
  { cwd, env, input, stage },
) {
  let result;
  try {
    result = await runCommand(command, args, {
      cwd,
      env: safeEnv(env ?? process.env),
      input,
    });
  } catch {
    throw new DeploymentError(
      `Deployment command was unavailable: ${command}`,
      {
        stage: stage ?? "command_unavailable",
        details: { command },
      },
    );
  }
  if (!result || result.exitCode !== 0) {
    throw new DeploymentProcessError(
      command,
      args,
      result?.exitCode ?? 1,
      stage ?? "command_failed",
    );
  }
  return result.stdout ?? "";
}

function parsePositiveInteger(value, name, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new DeploymentError(`${name} must be a positive integer`, {
      stage: "input_validation",
    });
  }
  return parsed;
}

function requireNonEmpty(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeploymentError(`${name} is required`, {
      stage: "input_validation",
    });
  }
  return value.trim();
}

function validateImageRepository(
  value,
  name,
  { allowRegistryOnly = false } = {},
) {
  const registry = requireNonEmpty(value, name).replace(/\/+$/u, "");
  const [firstComponent, ...repositoryComponents] = registry.split("/");
  const validFirstComponent =
    OCI_REPOSITORY_COMPONENT_PATTERN.test(firstComponent) ||
    OCI_REGISTRY_COMPONENT_PATTERN.test(firstComponent);
  if (
    registry.length === 0 ||
    registry.includes("@") ||
    /\s/u.test(registry) ||
    !validFirstComponent ||
    (!allowRegistryOnly && repositoryComponents.length === 0) ||
    !repositoryComponents.every((component) =>
      OCI_REPOSITORY_COMPONENT_PATTERN.test(component),
    )
  ) {
    throw new DeploymentError(
      `${name} must be an OCI image repository without a tag`,
      {
        stage: "input_validation",
      },
    );
  }
  return registry;
}

function validateRegistry(value) {
  return validateImageRepository(value, "REGISTRY", {
    allowRegistryOnly: true,
  });
}

function parseArgs(argv) {
  let mode = "deploy";
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    mode = argv[0];
    index = 1;
  }
  if (!["build", "deploy", "register", "resume"].includes(mode)) {
    throw new DeploymentError(`Unknown release command: ${mode}`, {
      stage: "input_validation",
    });
  }
  const options = { mode };
  const valueFlags = new Set([
    "app-id",
    "build-artifact",
    "request-key",
    "source-rollout-id",
    "receipt",
    "namespace",
    "kustomize-dir",
    "rollout-deadline-ms",
    "rollout-poll-ms",
  ]);
  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new DeploymentError(`Unexpected argument: ${argument}`, {
        stage: "input_validation",
      });
    }
    const name = argument.slice(2);
    if (!valueFlags.has(name)) {
      throw new DeploymentError(`Unknown option: --${name}`, {
        stage: "input_validation",
      });
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new DeploymentError(`Option --${name} requires a value`, {
        stage: "input_validation",
      });
    }
    options[name.replaceAll("-", "_")] = value;
    index += 1;
  }
  return options;
}

async function loadCore(rootDir) {
  const corePath = path.join(rootDir, "packages", "core", "dist", "index.js");
  try {
    return await import(pathToFileURL(corePath).href);
  } catch {
    throw new DeploymentError(
      "Could not load the built @reef/core artifact; run pnpm install or rebuild packages/core",
      { stage: "core_artifact" },
    );
  }
}

async function readSourceIdentity(rootDir, runCommand, env) {
  const dirty = await runChecked(
    runCommand,
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: rootDir, env, stage: "source_cleanliness" },
  );
  if (dirty.trim().length > 0) {
    throw new DeploymentError(
      "The release source must be clean so the committed Blueprint is the artifact source",
      { stage: "source_cleanliness" },
    );
  }
  const sourceRevision = (
    await runChecked(runCommand, "git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      env,
      stage: "source_identity",
    })
  ).trim();
  if (!/^[0-9a-f]{40,64}$/iu.test(sourceRevision)) {
    throw new DeploymentError("git HEAD is not a full source revision", {
      stage: "source_identity",
    });
  }
  const packageJson = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8"),
  );
  const version = requireNonEmpty(packageJson.version, "root package version");
  return { sourceRevision: sourceRevision.toLowerCase(), version };
}

function parseDigest(core, value) {
  const parsed = core.ReleaseImageDigestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new DeploymentError("An immutable sha256 image digest is required", {
    stage: "artifact_validation",
  });
}

async function buildAndPushImage({
  rootDir,
  registry,
  runtime,
  sourceRevision,
  version,
  runCommand,
  env,
  core,
}) {
  const imageRepository = `${registry}/${runtime.name}`;
  // Keep every pushed tag unique. The release identity travels in the image
  // labels/build args and the digest returned by buildx; a public version or
  // source tag must never be moved by a later artifact.
  const buildTag = `build-${version.replaceAll("+", "_")}-${sourceRevision}-${randomUUID()}`;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "reef-release-"));
  const metadataPath = path.join(tempDir, "buildx-metadata.json");
  try {
    await runChecked(
      runCommand,
      "docker",
      [
        "buildx",
        "build",
        "--platform",
        "linux/amd64",
        "--build-arg",
        `REEF_VERSION=${version}`,
        "--build-arg",
        `REEF_SOURCE_REVISION=${sourceRevision}`,
        "--target",
        runtime.target,
        "--tag",
        `${imageRepository}:${buildTag}`,
        "--push",
        "--metadata-file",
        metadataPath,
        "--file",
        path.join(rootDir, "Dockerfile"),
        rootDir,
      ],
      { cwd: rootDir, env, stage: "image_build_push" },
    );
    let metadata;
    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch {
      throw new DeploymentError("Docker build did not return image metadata", {
        stage: "image_provenance",
      });
    }
    const imageDigest = parseDigest(core, metadata?.["containerimage.digest"]);
    return { imageRepository, imageDigest };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function buildAndPushImages({
  rootDir,
  registry,
  sourceRevision,
  version,
  runCommand,
  env,
  core,
  artifactPath,
}) {
  const web = await buildAndPushImage({
    rootDir,
    registry,
    runtime: RUNTIME_IMAGES.web,
    sourceRevision,
    version,
    runCommand,
    env,
    core,
  });
  const eventProcessor = await buildAndPushImage({
    rootDir,
    registry,
    runtime: RUNTIME_IMAGES.eventProcessor,
    sourceRevision,
    version,
    runCommand,
    env,
    core,
  });
  const images = { web, eventProcessor };
  if (artifactPath) {
    await writeBuildArtifact(
      artifactPath,
      buildArtifactRecord(images, { sourceRevision, version }),
    );
  }
  return images;
}

function serializeRuntimeImages(images) {
  return {
    web: {
      image_repository: images.web.imageRepository,
      image_digest: images.web.imageDigest,
      image_reference: `${images.web.imageRepository}@${images.web.imageDigest}`,
    },
    event_processor: {
      image_repository: images.eventProcessor.imageRepository,
      image_digest: images.eventProcessor.imageDigest,
      image_reference: `${images.eventProcessor.imageRepository}@${images.eventProcessor.imageDigest}`,
    },
  };
}

function buildArtifactRecord(images, { sourceRevision, version }) {
  return {
    kind: "reef-build-artifact",
    runtime_images: serializeRuntimeImages(images),
    source_revision: sourceRevision,
    version,
  };
}

function imageFromArtifact(value, core, label) {
  const imageDigest = parseDigest(core, value?.image_digest);
  const imageRepository = validateImageRepository(
    value?.image_repository,
    `${label} image repository`,
  );
  if (value?.image_reference !== `${imageRepository}@${imageDigest}`) {
    throw new DeploymentError(`${label} image reference is not digest-pinned`, {
      stage: "artifact_validation",
    });
  }
  return { imageRepository, imageDigest };
}

function runtimeImagesFromArtifact(value, core, label) {
  if (!value || typeof value !== "object") {
    throw new DeploymentError(`${label} must include both runtime images`, {
      stage: "artifact_validation",
    });
  }
  return {
    web: imageFromArtifact(value.web, core, `${label} web`),
    eventProcessor: imageFromArtifact(
      value.event_processor,
      core,
      `${label} event processor`,
    ),
  };
}

async function finalizeRelease({
  rootDir,
  sourceRevision,
  version,
  runtimeImages,
  core,
}) {
  let blueprint;
  try {
    blueprint = JSON.parse(
      await readFile(
        path.join(rootDir, "release", "reef-release-blueprint.json"),
        "utf8",
      ),
    );
  } catch {
    throw new DeploymentError(
      "The committed Release Blueprint could not be read",
      {
        stage: "artifact_validation",
      },
    );
  }
  try {
    const payload = await core.finalizeAppReleaseManifest({
      blueprint,
      version,
      sourceRevision,
      runtimeImages: {
        web: runtimeImages.web.imageDigest,
        eventProcessor: runtimeImages.eventProcessor.imageDigest,
      },
    });
    return await core.verifyFinalizedRelease(payload);
  } catch (error) {
    if (error instanceof DeploymentError) throw error;
    throw new DeploymentError(
      "Release Blueprint or artifact provenance is invalid",
      {
        stage: "artifact_validation",
      },
    );
  }
}

async function writeBuildArtifact(artifactPath, artifact) {
  const absolute = path.resolve(artifactPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, absolute);
}

async function readBuildArtifact(artifactPath, core, identity) {
  if (!artifactPath) {
    throw new DeploymentError(
      "register requires the identity artifact produced by the image build",
      { stage: "artifact_validation" },
    );
  }
  let artifact;
  try {
    artifact = JSON.parse(await readFile(path.resolve(artifactPath), "utf8"));
  } catch {
    throw new DeploymentError("The build identity artifact could not be read", {
      stage: "artifact_validation",
    });
  }
  const runtimeImages = runtimeImagesFromArtifact(
    artifact?.runtime_images,
    core,
    "Build artifact",
  );
  const sourceRevision = core.ReleaseSourceRevisionSchema.safeParse(
    artifact?.source_revision,
  );
  const version = core.ReleaseVersionSchema.safeParse(artifact?.version);
  if (
    artifact?.kind !== "reef-build-artifact" ||
    !sourceRevision.success ||
    !version.success ||
    sourceRevision.data.toLowerCase() !== identity.sourceRevision ||
    version.data !== identity.version
  ) {
    throw new DeploymentError(
      "The build identity artifact does not match the current source and version",
      { stage: "artifact_validation" },
    );
  }
  return runtimeImages;
}

function registrationFromCore(core, app, release, payload, runtimeImages) {
  const parsed = core.ReleaseRegistrationResultSchema.parse({
    appId: app.id,
    releaseId: release.id,
    appKey: app.appKey,
    version: payload.version,
    sourceRevision: payload.manifest.source_revision,
    runtimeImageDigests: {
      web: payload.manifest.runtime_images.web,
      eventProcessor: payload.manifest.runtime_images.event_processor,
    },
    manifestChecksum: payload.manifest_checksum,
    appReplayed: app.replayed === true,
    releaseReplayed: release.replayed === true,
  });
  const registration = {
    ...parsed,
    imageDigest: parsed.runtimeImageDigests.web,
    eventProcessorImageDigest: parsed.runtimeImageDigests.eventProcessor,
    imageRepositories: {
      web: runtimeImages.web.imageRepository,
      eventProcessor: runtimeImages.eventProcessor.imageRepository,
    },
  };
  if (
    release.appId !== registration.appId ||
    release.version !== registration.version ||
    release.manifestChecksum !== registration.manifestChecksum
  ) {
    throw new DeploymentError(
      "AKB returned a release identity different from the artifact",
      {
        stage: "release_registration",
      },
    );
  }
  return registration;
}

async function registerRelease({
  env,
  core,
  payload,
  appId,
  createRegistry,
  runtimeImages,
  fetchImpl,
}) {
  const baseUrl = requireNonEmpty(env.AKB_BACKEND_URL, "AKB_BACKEND_URL");
  const token = requireNonEmpty(
    env.REEF_CONTROL_PLANE_TOKEN,
    "REEF_CONTROL_PLANE_TOKEN",
  );
  const registry = createRegistry({
    baseUrl,
    adminToken: token,
    fetch: fetchImpl,
  });
  let app;
  try {
    app = appId ? await registry.getApp(appId) : await registry.createApp();
    if (app.appKey !== "reef") {
      throw new DeploymentError(
        "The persisted App Definition is not the Reef app_key=reef identity",
        { stage: "release_registration" },
      );
    }
    const release = await registry.createRelease({ appId: app.id, ...payload });
    return registrationFromCore(core, app, release, payload, runtimeImages);
  } catch (error) {
    if (error instanceof DeploymentError) throw error;
    throw new DeploymentError("AKB App or Release registration failed", {
      stage: "release_registration",
    });
  }
}

function makeReceipt(registration, fields = {}, runtimeImages) {
  return {
    kind: "reef-release-receipt",
    app_id: registration.appId,
    release_id: registration.releaseId,
    app_key: registration.appKey,
    version: registration.version,
    source_revision: registration.sourceRevision,
    runtime_images: {
      web: {
        image_repository: runtimeImages.web.imageRepository,
        image_digest: registration.runtimeImageDigests.web,
        image_reference: `${runtimeImages.web.imageRepository}@${registration.runtimeImageDigests.web}`,
      },
      event_processor: {
        image_repository: runtimeImages.eventProcessor.imageRepository,
        image_digest: registration.runtimeImageDigests.eventProcessor,
        image_reference: `${runtimeImages.eventProcessor.imageRepository}@${registration.runtimeImageDigests.eventProcessor}`,
      },
    },
    manifest_checksum: registration.manifestChecksum,
    app_replayed: registration.appReplayed,
    release_replayed: registration.releaseReplayed,
    ...fields,
  };
}

async function writeReceipt(receiptPath, receipt) {
  if (!receiptPath) return;
  const absolute = path.resolve(receiptPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, absolute);
}

async function readReceipt(receiptPath, core) {
  if (!receiptPath) return null;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path.resolve(receiptPath), "utf8"));
  } catch {
    throw new DeploymentError("The supplied receipt could not be read", {
      stage: "receipt_validation",
    });
  }
  try {
    if (parsed.kind !== "reef-release-receipt") {
      throw new Error("unexpected receipt kind");
    }
    const parsedRegistration = core.ReleaseRegistrationResultSchema.parse({
      appId: parsed.app_id,
      releaseId: parsed.release_id,
      appKey: parsed.app_key,
      version: parsed.version,
      sourceRevision: parsed.source_revision,
      runtimeImageDigests: {
        web: parsed.runtime_images.web.image_digest,
        eventProcessor: parsed.runtime_images.event_processor.image_digest,
      },
      manifestChecksum: parsed.manifest_checksum,
      appReplayed: parsed.app_replayed === true,
      releaseReplayed: parsed.release_replayed === true,
    });
    const runtimeImages = runtimeImagesFromArtifact(
      parsed.runtime_images,
      core,
      "Release receipt",
    );
    const registration = {
      ...parsedRegistration,
      imageDigest: parsedRegistration.runtimeImageDigests.web,
      eventProcessorImageDigest:
        parsedRegistration.runtimeImageDigests.eventProcessor,
      imageRepositories: {
        web: runtimeImages.web.imageRepository,
        eventProcessor: runtimeImages.eventProcessor.imageRepository,
      },
    };
    return { registration, receipt: parsed, runtimeImages };
  } catch {
    throw new DeploymentError(
      "The supplied receipt has invalid release identity",
      {
        stage: "receipt_validation",
      },
    );
  }
}

async function readReceiptIfPresent(receiptPath, core) {
  if (!receiptPath) return null;
  try {
    await access(path.resolve(receiptPath));
  } catch {
    return null;
  }
  return readReceipt(receiptPath, core);
}

function sameRegistration(left, right) {
  return (
    left?.appId === right?.appId &&
    left?.releaseId === right?.releaseId &&
    left?.version === right?.version &&
    left?.sourceRevision === right?.sourceRevision &&
    left?.runtimeImageDigests?.web === right?.runtimeImageDigests?.web &&
    left?.runtimeImageDigests?.eventProcessor ===
      right?.runtimeImageDigests?.eventProcessor &&
    left?.manifestChecksum === right?.manifestChecksum
  );
}

async function reusableReceiptRelease({
  rootDir,
  core,
  identity,
  registry,
  appId,
  receipt,
}) {
  if (
    !receipt ||
    (appId !== undefined && receipt.registration.appId !== appId) ||
    receipt.registration.version !== identity.version ||
    receipt.registration.sourceRevision.toLowerCase() !==
      identity.sourceRevision
  ) {
    return null;
  }
  const payload = await finalizeRelease({
    rootDir,
    sourceRevision: identity.sourceRevision,
    version: identity.version,
    runtimeImages: receipt.runtimeImages,
    core,
  });
  if (
    payload.manifest_checksum !== receipt.registration.manifestChecksum ||
    payload.manifest.source_revision !==
      receipt.registration.sourceRevision.toLowerCase() ||
    payload.manifest.runtime_images.web !==
      receipt.registration.runtimeImageDigests.web ||
    payload.manifest.runtime_images.event_processor !==
      receipt.registration.runtimeImageDigests.eventProcessor ||
    receipt.runtimeImages.web.imageRepository !== `${registry}/reef-web` ||
    receipt.runtimeImages.eventProcessor.imageRepository !==
      `${registry}/reef-event-processor`
  ) {
    throw new DeploymentError(
      "The release receipt does not match the current canonical release",
      {
        stage: "receipt_validation",
        details: {
          app_id: receipt.registration.appId,
          release_id: receipt.registration.releaseId,
        },
      },
    );
  }
  return {
    images: receipt.runtimeImages,
    payload,
    registration: receipt.registration,
  };
}

function buildProvenanceAnnotation(registration) {
  if (!registration.runtimeImageDigests) {
    return [
      `Deploy reef-web v${registration.version}`,
      `source ${registration.sourceRevision}`,
      `app ${registration.appId}`,
      `release ${registration.releaseId}`,
      `image ${registration.imageDigest}`,
      `manifest ${registration.manifestChecksum}`,
    ].join("; ");
  }
  const digests = runtimeImageDigests(registration);
  return [
    `Deploy reef v${registration.version}`,
    `source ${registration.sourceRevision}`,
    `app ${registration.appId}`,
    `release ${registration.releaseId}`,
    `web-image ${digests.web}`,
    `event-processor-image ${digests.eventProcessor}`,
    `manifest ${registration.manifestChecksum}`,
  ].join("; ");
}

function runtimeImageDigests(registration) {
  return (
    registration.runtimeImageDigests ?? {
      web: registration.imageDigest,
      eventProcessor:
        registration.eventProcessorImageDigest ?? registration.imageDigest,
    }
  );
}

const IDENTITY_CONFIG_KEYS = Object.freeze({
  REEF_APP_ID: "appId",
  REEF_RELEASE_ID: "releaseId",
  REEF_RELEASE_VERSION: "version",
  REEF_RELEASE_SOURCE_REVISION: "sourceRevision",
  REEF_RELEASE_IMAGE_DIGEST: "imageDigest",
  REEF_RELEASE_MANIFEST_CHECKSUM: "manifestChecksum",
});

const RUNTIME_IDENTITY_KEYS = Object.freeze({
  REEF_APP_ID: "appId",
  REEF_RELEASE_ID: "releaseId",
  REEF_RELEASE_VERSION: "version",
  REEF_RELEASE_SOURCE_REVISION: "sourceRevision",
  REEF_RELEASE_MANIFEST_CHECKSUM: "manifestChecksum",
  REEF_EVENT_PROCESSOR_IMAGE_DIGEST: "eventProcessorImageDigest",
});

export function renderKubernetesManifest(
  renderedYaml,
  { registration, imageRepository, eventProcessorImageRepository },
) {
  let documents;
  try {
    documents = parseAllDocuments(renderedYaml).filter(
      (document) => document.toString().trim().length > 0,
    );
  } catch {
    throw new DeploymentError("kustomize returned invalid YAML", {
      stage: "kubernetes_render",
    });
  }
  const resources = documents.map((document) => document.toJS());
  const deployment = resources.find(
    (resource) =>
      resource?.kind === "Deployment" &&
      resource?.metadata?.name === "reef-web",
  );
  const configMap = resources.find(
    (resource) =>
      resource?.kind === "ConfigMap" &&
      resource?.metadata?.name === "reef-web-config",
  );
  if (!deployment || !configMap) {
    throw new DeploymentError(
      "kustomize output must contain reef-web Deployment and reef-web-config",
      { stage: "kubernetes_render" },
    );
  }
  const eventProcessorDeployment = resources.find(
    (resource) =>
      resource?.kind === "Deployment" &&
      resource?.metadata?.name === "reef-event-processor",
  );
  if (eventProcessorImageRepository && !eventProcessorDeployment) {
    throw new DeploymentError(
      "kustomize output must contain the private reef-event-processor Deployment",
      { stage: "kubernetes_render" },
    );
  }
  const containers = deployment.spec?.template?.spec?.containers;
  const container = Array.isArray(containers)
    ? containers.find((candidate) => candidate?.name === "reef-web")
    : undefined;
  if (!container) {
    throw new DeploymentError(
      "reef-web container is missing from kustomize output",
      {
        stage: "kubernetes_render",
      },
    );
  }
  const imageDigestReference = `${imageRepository}@${registration.imageDigest}`;
  container.image = imageDigestReference;
  const templateMetadata = deployment.spec.template.metadata ?? {};
  deployment.spec.template.metadata = templateMetadata;
  const annotations = templateMetadata.annotations ?? {};
  templateMetadata.annotations = annotations;
  const provenance = buildProvenanceAnnotation(registration);
  annotations["kubernetes.io/change-cause"] = provenance;
  const deploymentAnnotations = deployment.metadata.annotations ?? {};
  deployment.metadata.annotations = deploymentAnnotations;
  deploymentAnnotations["kubernetes.io/change-cause"] = provenance;
  const existingEnv = Array.isArray(container.env)
    ? container.env.filter(
        (entry) => !Object.hasOwn(IDENTITY_CONFIG_KEYS, entry?.name),
      )
    : [];
  container.env = existingEnv;
  for (const [key, registrationKey] of Object.entries(IDENTITY_CONFIG_KEYS)) {
    container.env.push({
      name: key,
      value: String(registration[registrationKey]),
    });
  }
  if (!eventProcessorImageRepository || !eventProcessorDeployment) {
    return resources.map((resource) => stringify(resource)).join("---\n");
  }
  const processorContainers =
    eventProcessorDeployment.spec?.template?.spec?.containers;
  const processorContainer = Array.isArray(processorContainers)
    ? processorContainers.find(
        (candidate) => candidate?.name === "reef-event-processor",
      )
    : undefined;
  if (!processorContainer) {
    throw new DeploymentError(
      "reef-event-processor container is missing from kustomize output",
      { stage: "kubernetes_render" },
    );
  }
  if (
    eventProcessorDeployment.spec?.replicas !== 1 ||
    eventProcessorDeployment.spec?.strategy?.type !== "Recreate"
  ) {
    throw new DeploymentError(
      "reef-event-processor must use one replica and a Recreate rollout",
      { stage: "kubernetes_render" },
    );
  }
  processorContainer.image = `${eventProcessorImageRepository}@${runtimeImageDigests(registration).eventProcessor}`;
  const processorTemplateMetadata =
    eventProcessorDeployment.spec.template.metadata ?? {};
  eventProcessorDeployment.spec.template.metadata = processorTemplateMetadata;
  const processorAnnotations = processorTemplateMetadata.annotations ?? {};
  processorTemplateMetadata.annotations = processorAnnotations;
  processorAnnotations["kubernetes.io/change-cause"] = provenance;
  const processorDeploymentAnnotations =
    eventProcessorDeployment.metadata.annotations ?? {};
  eventProcessorDeployment.metadata.annotations =
    processorDeploymentAnnotations;
  processorDeploymentAnnotations["kubernetes.io/change-cause"] = provenance;
  const processorEnv = Array.isArray(processorContainer.env)
    ? processorContainer.env.filter(
        (entry) => !Object.hasOwn(RUNTIME_IDENTITY_KEYS, entry?.name),
      )
    : [];
  processorContainer.env = processorEnv;
  for (const [key, registrationKey] of Object.entries(RUNTIME_IDENTITY_KEYS)) {
    processorContainer.env.push({
      name: key,
      value: String(registration[registrationKey]),
    });
  }
  const forbiddenProcessorExposure = resources.some(
    (resource) =>
      (resource?.kind === "Service" || resource?.kind === "Ingress") &&
      (resource?.metadata?.name === "reef-event-processor" ||
        resource?.spec?.selector?.app === "reef-event-processor"),
  );
  if (
    forbiddenProcessorExposure ||
    resources.some((resource) => resource?.kind === "HorizontalPodAutoscaler")
  ) {
    throw new DeploymentError(
      "Event processor must remain private with no public Service, Ingress, or HPA",
      { stage: "kubernetes_render" },
    );
  }
  return resources.map((resource) => stringify(resource)).join("---\n");
}

function assertNoCredentialInManifest(manifest, token) {
  if (manifest.includes(token)) {
    throw new DeploymentError(
      "The Kubernetes manifest contains the control-plane credential",
      {
        stage: "kubernetes_render",
      },
    );
  }
  for (const key of CREDENTIAL_ENV_KEYS) {
    if (manifest.includes(key)) {
      throw new DeploymentError(
        "The Kubernetes manifest contains a control-plane credential key",
        {
          stage: "kubernetes_render",
        },
      );
    }
  }
}

async function kubernetesJson({ runCommand, rootDir, env, args, stage }) {
  const output = await runChecked(runCommand, "kubectl", args, {
    cwd: rootDir,
    env,
    stage,
  });
  try {
    return JSON.parse(output);
  } catch {
    throw new DeploymentError("kubectl returned invalid JSON", { stage });
  }
}

function findContainer(containers, name) {
  return Array.isArray(containers)
    ? containers.find((container) => container?.name === name)
    : undefined;
}

export function assertKubernetesReadback({
  deployment,
  pods,
  registration,
  imageRepository,
  eventProcessorImageRepository,
  eventProcessorDeployment,
  eventProcessorPods,
}) {
  const expectedImage = `${imageRepository}@${registration.imageDigest}`;
  const deploymentContainer = findContainer(
    deployment.spec?.template?.spec?.containers,
    "reef-web",
  );
  if (deploymentContainer?.image !== expectedImage) {
    throw new DeploymentError(
      "Kubernetes Deployment image does not match the release digest",
      {
        stage: "runtime_identity_mismatch",
      },
    );
  }
  const cause =
    deployment.spec?.template?.metadata?.annotations?.[
      "kubernetes.io/change-cause"
    ];
  const deploymentCause =
    deployment.metadata?.annotations?.["kubernetes.io/change-cause"];
  if (
    cause !== buildProvenanceAnnotation(registration) ||
    deploymentCause !== cause
  ) {
    throw new DeploymentError(
      "Kubernetes Deployment provenance does not match the release",
      {
        stage: "runtime_identity_mismatch",
      },
    );
  }
  const expectedConfig = Object.fromEntries(
    Object.entries(IDENTITY_CONFIG_KEYS).map(([key, registrationKey]) => [
      key,
      String(registration[registrationKey]),
    ]),
  );
  const deploymentConfig = Object.fromEntries(
    (Array.isArray(deploymentContainer?.env) ? deploymentContainer.env : [])
      .filter(
        (entry) => entry && Object.hasOwn(IDENTITY_CONFIG_KEYS, entry.name),
      )
      .map((entry) => [entry.name, entry.value]),
  );
  for (const [key, value] of Object.entries(expectedConfig)) {
    if (deploymentConfig[key] !== value) {
      throw new DeploymentError(
        "Kubernetes Deployment release configuration does not match the applied release",
        {
          stage: "runtime_identity_mismatch",
        },
      );
    }
  }
  const activePods = Array.isArray(pods.items)
    ? pods.items.filter(
        (pod) =>
          pod?.metadata?.deletionTimestamp === undefined ||
          pod?.metadata?.deletionTimestamp === null,
      )
    : [];
  if (activePods.length === 0) {
    throw new DeploymentError("No reef-web pod was returned after readiness", {
      stage: "runtime_identity_mismatch",
    });
  }
  for (const pod of activePods) {
    const podContainer = findContainer(pod.spec?.containers, "reef-web");
    const status = findContainer(pod.status?.containerStatuses, "reef-web");
    // Runtimes may report a config/platform identifier instead of the
    // pullable manifest digest. Reject an explicit conflicting @digest, while
    // relying on the immutable pod spec for identifiers without that shape.
    const runtimeDigest =
      typeof status?.imageID === "string"
        ? status.imageID.match(/@(sha256:[0-9a-f]{64})(?:$|[^0-9a-f])/u)?.[1]
        : undefined;
    if (
      podContainer?.image !== expectedImage ||
      status?.ready !== true ||
      typeof status?.imageID !== "string" ||
      status.imageID.length === 0 ||
      (runtimeDigest !== undefined &&
        runtimeDigest !== registration.imageDigest)
    ) {
      throw new DeploymentError(
        "A reef-web pod does not match the applied release identity",
        {
          stage: "runtime_identity_mismatch",
        },
      );
    }
  }
  if (eventProcessorDeployment !== undefined) {
    const processorExpectedImage = `${eventProcessorImageRepository}@${runtimeImageDigests(registration).eventProcessor}`;
    const processorDeploymentContainer = findContainer(
      eventProcessorDeployment.spec?.template?.spec?.containers,
      "reef-event-processor",
    );
    if (
      eventProcessorDeployment.spec?.replicas !== 1 ||
      eventProcessorDeployment.spec?.strategy?.type !== "Recreate" ||
      processorDeploymentContainer?.image !== processorExpectedImage
    ) {
      throw new DeploymentError(
        "Kubernetes event processor Deployment does not match the release",
        { stage: "runtime_identity_mismatch" },
      );
    }
    const processorCause =
      eventProcessorDeployment.spec?.template?.metadata?.annotations?.[
        "kubernetes.io/change-cause"
      ];
    const processorDeploymentCause =
      eventProcessorDeployment.metadata?.annotations?.[
        "kubernetes.io/change-cause"
      ];
    if (
      processorCause !== buildProvenanceAnnotation(registration) ||
      processorDeploymentCause !== processorCause
    ) {
      throw new DeploymentError(
        "Kubernetes event processor provenance does not match the release",
        { stage: "runtime_identity_mismatch" },
      );
    }
    const processorConfig = Object.fromEntries(
      (Array.isArray(processorDeploymentContainer?.env)
        ? processorDeploymentContainer.env
        : []
      )
        .filter(
          (entry) => entry && Object.hasOwn(RUNTIME_IDENTITY_KEYS, entry.name),
        )
        .map((entry) => [entry.name, entry.value]),
    );
    for (const [key, registrationKey] of Object.entries(
      RUNTIME_IDENTITY_KEYS,
    )) {
      if (processorConfig[key] !== String(registration[registrationKey])) {
        throw new DeploymentError(
          "Kubernetes event processor release configuration does not match the applied release",
          { stage: "runtime_identity_mismatch" },
        );
      }
    }
    const activeProcessorPods = Array.isArray(eventProcessorPods?.items)
      ? eventProcessorPods.items.filter(
          (pod) =>
            pod?.metadata?.deletionTimestamp === undefined ||
            pod?.metadata?.deletionTimestamp === null,
        )
      : [];
    if (activeProcessorPods.length === 0) {
      throw new DeploymentError(
        "No reef-event-processor pod was returned after readiness",
        { stage: "runtime_identity_mismatch" },
      );
    }
    for (const pod of activeProcessorPods) {
      const processorPodContainer = findContainer(
        pod.spec?.containers,
        "reef-event-processor",
      );
      const processorStatus = findContainer(
        pod.status?.containerStatuses,
        "reef-event-processor",
      );
      const processorRuntimeDigest =
        typeof processorStatus?.imageID === "string"
          ? processorStatus.imageID.match(
              /@(sha256:[0-9a-f]{64})(?:$|[^0-9a-f])/u,
            )?.[1]
          : undefined;
      if (
        processorPodContainer?.image !== processorExpectedImage ||
        processorStatus?.ready !== true ||
        typeof processorStatus?.imageID !== "string" ||
        processorStatus.imageID.length === 0 ||
        (processorRuntimeDigest !== undefined &&
          processorRuntimeDigest !==
            runtimeImageDigests(registration).eventProcessor)
      ) {
        throw new DeploymentError(
          "A reef-event-processor pod does not match the applied release",
          { stage: "runtime_identity_mismatch" },
        );
      }
    }
  }
}

export async function applyKubernetesRelease({
  rootDir,
  namespace,
  kustomizeDir,
  registration,
  imageRepository,
  eventProcessorImageRepository,
  token,
  runCommand = defaultRunCommand,
  env = process.env,
  kubernetesTimeoutMs = DEFAULT_KUBERNETES_TIMEOUT_MS,
}) {
  const rendered = await runChecked(
    runCommand,
    "kubectl",
    ["kustomize", kustomizeDir],
    { cwd: rootDir, env, stage: "kubernetes_render" },
  );
  const manifest = renderKubernetesManifest(rendered, {
    registration,
    imageRepository,
    eventProcessorImageRepository,
  });
  assertNoCredentialInManifest(manifest, token);
  await runChecked(
    runCommand,
    "kubectl",
    ["apply", "--namespace", namespace, "--filename", "-"],
    {
      cwd: rootDir,
      env,
      input: manifest,
      stage: "kubernetes_apply",
    },
  );
  await runChecked(
    runCommand,
    "kubectl",
    [
      "rollout",
      "status",
      "deployment/reef-web",
      "--namespace",
      namespace,
      `--timeout=${Math.ceil(kubernetesTimeoutMs / 1000)}s`,
    ],
    { cwd: rootDir, env, stage: "runtime_readiness" },
  );
  await runChecked(
    runCommand,
    "kubectl",
    [
      "rollout",
      "status",
      "deployment/reef-event-processor",
      "--namespace",
      namespace,
      `--timeout=${Math.ceil(kubernetesTimeoutMs / 1000)}s`,
    ],
    { cwd: rootDir, env, stage: "runtime_readiness" },
  );
  const deployment = await kubernetesJson({
    runCommand,
    rootDir,
    env,
    args: [
      "get",
      "deployment/reef-web",
      "--namespace",
      namespace,
      "--output",
      "json",
    ],
    stage: "runtime_identity_readback",
  });
  const eventProcessorDeployment = await kubernetesJson({
    runCommand,
    rootDir,
    env,
    args: [
      "get",
      "deployment/reef-event-processor",
      "--namespace",
      namespace,
      "--output",
      "json",
    ],
    stage: "runtime_identity_readback",
  });
  const pods = await kubernetesJson({
    runCommand,
    rootDir,
    env,
    args: [
      "get",
      "pods",
      "--namespace",
      namespace,
      "--selector",
      "app=reef-web",
      "--output",
      "json",
    ],
    stage: "runtime_identity_readback",
  });
  const eventProcessorPods = await kubernetesJson({
    runCommand,
    rootDir,
    env,
    args: [
      "get",
      "pods",
      "--namespace",
      namespace,
      "--selector",
      "app=reef-event-processor",
      "--output",
      "json",
    ],
    stage: "runtime_identity_readback",
  });
  assertKubernetesReadback({
    deployment,
    pods,
    registration,
    imageRepository,
    eventProcessorDeployment,
    eventProcessorPods,
    eventProcessorImageRepository,
  });
  return {
    manifest,
    deployment,
    pods,
    eventProcessorDeployment,
    eventProcessorPods,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function observeRollout({
  rollout,
  appId,
  expectedReleaseId,
  expectedManifestChecksum,
  rolloutAdapter,
  deadlineMs,
  pollMs,
  now = () => Date.now(),
  sleep = delay,
}) {
  const startedAt = now();
  let current = rollout;
  while (true) {
    try {
      current = await rolloutAdapter.getRollout(appId, current.jobId);
    } catch {
      throw new DeploymentError("AKB rollout observation failed", {
        stage: "rollout_observation",
        details: { app_id: appId, job_id: current.jobId },
      });
    }
    if (
      current.releaseId !== expectedReleaseId ||
      current.manifestChecksum !== expectedManifestChecksum
    ) {
      throw new DeploymentError(
        "AKB rollout observation returned a different release identity",
        {
          stage: "rollout_observation",
          details: {
            app_id: appId,
            job_id: current.jobId,
            release_id: current.releaseId,
            manifest_checksum: current.manifestChecksum,
          },
        },
      );
    }
    if (current.status === "applied") return current;
    if (current.status === "blocked") {
      throw new DeploymentError(
        "AKB rollout is blocked; no Kubernetes mutation was attempted",
        {
          stage: "rollout_blocked",
          details: {
            app_id: appId,
            job_id: current.jobId,
            status: current.status,
          },
        },
      );
    }
    if (now() - startedAt >= deadlineMs) {
      throw new DeploymentError(
        "AKB rollout did not reach applied before the deadline",
        {
          stage: "rollout_timeout",
          details: {
            app_id: appId,
            job_id: current.jobId,
            status: current.status,
          },
        },
      );
    }
    await sleep(pollMs);
  }
}

function ensureRolloutKey(core, value, name) {
  const parsed = core.ControlPlaneIdSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new DeploymentError(`${name} must be a UUID`, {
    stage: "input_validation",
  });
}

async function requestAndObserve({
  core,
  env,
  registration,
  fetchImpl,
  requestKey,
  sourceRolloutId,
  resume,
  deadlineMs,
  pollMs,
  now,
  sleep,
}) {
  const rolloutAdapter = core.createAkbAppRollout({
    baseUrl: requireNonEmpty(env.AKB_BACKEND_URL, "AKB_BACKEND_URL"),
    adminToken: requireNonEmpty(
      env.REEF_CONTROL_PLANE_TOKEN,
      "REEF_CONTROL_PLANE_TOKEN",
    ),
    fetch: fetchImpl,
  });
  let response;
  try {
    response = resume
      ? await rolloutAdapter.resumeRollout({
          appId: registration.appId,
          sourceRolloutId,
          releaseId: registration.releaseId,
          manifestChecksum: registration.manifestChecksum,
          idempotencyKey: requestKey,
        })
      : await rolloutAdapter.requestRollout({
          appId: registration.appId,
          releaseId: registration.releaseId,
          manifestChecksum: registration.manifestChecksum,
          idempotencyKey: requestKey,
        });
  } catch {
    throw new DeploymentError(
      resume
        ? "AKB rollout resume request failed"
        : "AKB rollout request failed",
      {
        stage: resume ? "rollout_resume" : "rollout_request",
        details: {
          app_id: registration.appId,
          release_id: registration.releaseId,
          request_key: requestKey,
          ...(sourceRolloutId ? { source_rollout_id: sourceRolloutId } : {}),
        },
      },
    );
  }
  const applied = await observeRollout({
    rollout: response.rollout,
    appId: registration.appId,
    expectedReleaseId: registration.releaseId,
    expectedManifestChecksum: registration.manifestChecksum,
    rolloutAdapter,
    deadlineMs,
    pollMs,
    now,
    sleep,
  });
  return { response, applied };
}

async function runBuildOnly({ rootDir, env, options, core, runCommand }) {
  const artifactPath = requireNonEmpty(
    options.build_artifact ?? env.REEF_BUILD_ARTIFACT,
    "build artifact path",
  );
  await runChecked(
    runCommand,
    "pnpm",
    ["--filter", "@reef/core", "run", "build"],
    {
      cwd: rootDir,
      env,
      stage: "core_build",
    },
  );
  const releaseCore = core ?? (await loadCore(rootDir));
  const identity = await readSourceIdentity(rootDir, runCommand, env);
  const registry = validateRegistry(options.registry ?? env.REGISTRY);
  const images = await buildAndPushImages({
    rootDir,
    registry,
    sourceRevision: identity.sourceRevision,
    version: identity.version,
    runCommand,
    env,
    core: releaseCore,
    artifactPath,
  });
  return buildArtifactRecord(images, identity);
}

async function runRegisterOnly({
  rootDir,
  env,
  options,
  core,
  runCommand,
  fetchImpl,
}) {
  await runChecked(
    runCommand,
    "pnpm",
    ["--filter", "@reef/core", "run", "build"],
    {
      cwd: rootDir,
      env,
      stage: "core_build",
    },
  );
  const releaseCore = core ?? (await loadCore(rootDir));
  const identity = await readSourceIdentity(rootDir, runCommand, env);
  const buildArtifact = await readBuildArtifact(
    options.build_artifact ?? env.REEF_BUILD_ARTIFACT,
    releaseCore,
    identity,
  );
  const payload = await finalizeRelease({
    rootDir,
    sourceRevision: identity.sourceRevision,
    version: identity.version,
    runtimeImages: buildArtifact,
    core: releaseCore,
  });
  const receiptPath = options.receipt ?? env.REEF_RELEASE_RECEIPT;
  const previousReceipt = await readReceiptIfPresent(receiptPath, releaseCore);
  const registration = await registerRelease({
    env,
    core: releaseCore,
    payload,
    appId:
      options.app_id ?? env.REEF_APP_ID ?? previousReceipt?.registration.appId,
    createRegistry: releaseCore.createAkbAppRegistry,
    runtimeImages: buildArtifact,
    fetchImpl,
  });
  await writeReceipt(
    receiptPath,
    makeReceipt(registration, { outcome: "registered" }, buildArtifact),
  );
  return makeReceipt(registration, { outcome: "registered" }, buildArtifact);
}

async function runDeploy({
  rootDir,
  env,
  options,
  core,
  runCommand,
  now,
  sleep,
  fetchImpl,
}) {
  await runChecked(
    runCommand,
    "pnpm",
    ["--filter", "@reef/core", "run", "build"],
    {
      cwd: rootDir,
      env,
      stage: "core_build",
    },
  );
  const releaseCore = core ?? (await loadCore(rootDir));
  const identity = await readSourceIdentity(rootDir, runCommand, env);
  const registry = validateRegistry(options.registry ?? env.REGISTRY);
  const receiptPath = options.receipt ?? env.REEF_RELEASE_RECEIPT;
  const previousReceipt = await readReceiptIfPresent(receiptPath, releaseCore);
  const rolloutDeadlineMs = parsePositiveInteger(
    options.rollout_deadline_ms ?? env.REEF_ROLLOUT_DEADLINE_MS,
    "rollout deadline",
    DEFAULT_ROLLOUT_DEADLINE_MS,
  );
  const rolloutPollMs = parsePositiveInteger(
    options.rollout_poll_ms ?? env.REEF_ROLLOUT_POLL_MS,
    "rollout poll interval",
    DEFAULT_ROLLOUT_POLL_MS,
  );
  const namespace = requireNonEmpty(
    options.namespace ?? env.NAMESPACE ?? DEFAULT_NAMESPACE,
    "Kubernetes namespace",
  );
  const kustomizeDir = path.resolve(
    rootDir,
    options.kustomize_dir ?? env.KUSTOMIZE_DIR ?? "deploy/k8s/overlays/example",
  );
  const kubernetesTimeoutMs = parsePositiveInteger(
    env.REEF_KUBERNETES_TIMEOUT_MS,
    "Kubernetes timeout",
    DEFAULT_KUBERNETES_TIMEOUT_MS,
  );
  const reused = await reusableReceiptRelease({
    rootDir,
    core: releaseCore,
    identity,
    registry,
    appId: options.app_id ?? env.REEF_APP_ID,
    receipt: previousReceipt,
  });
  let runtimeImages;
  let payload;
  let registration;
  if (reused) {
    ({ images: runtimeImages, payload, registration } = reused);
  } else {
    runtimeImages = await buildAndPushImages({
      rootDir,
      registry,
      sourceRevision: identity.sourceRevision,
      version: identity.version,
      runCommand,
      env,
      core: releaseCore,
      artifactPath: options.build_artifact ?? env.REEF_BUILD_ARTIFACT,
    });
    payload = await finalizeRelease({
      rootDir,
      sourceRevision: identity.sourceRevision,
      version: identity.version,
      runtimeImages,
      core: releaseCore,
    });
    registration = await registerRelease({
      env,
      core: releaseCore,
      payload,
      appId:
        options.app_id ??
        env.REEF_APP_ID ??
        previousReceipt?.registration.appId,
      createRegistry: releaseCore.createAkbAppRegistry,
      runtimeImages,
      fetchImpl,
    });
  }
  const previousRequestKey =
    previousReceipt &&
    previousReceipt &&
    sameRegistration(previousReceipt.registration, registration)
      ? previousReceipt.receipt.request_key
      : undefined;
  const requestKey = ensureRolloutKey(
    releaseCore,
    options.request_key ??
      env.REEF_ROLLOUT_REQUEST_KEY ??
      previousRequestKey ??
      randomUUID(),
    "request key",
  );
  await writeReceipt(
    receiptPath,
    makeReceipt(registration, { request_key: requestKey }, runtimeImages),
  );
  let requestAndObservation;
  try {
    requestAndObservation = await requestAndObserve({
      core: releaseCore,
      env,
      registration,
      fetchImpl,
      requestKey,
      deadlineMs: rolloutDeadlineMs,
      pollMs: rolloutPollMs,
      now,
      sleep,
    });
  } catch (error) {
    await writeReceipt(
      receiptPath,
      makeReceipt(
        registration,
        {
          request_key: requestKey,
          rollout_status: error.details?.status ?? "unknown",
          rollout_job_id: error.details?.job_id ?? null,
          deployment_status: "not_applied",
          outcome: "rollout_failed",
        },
        runtimeImages,
      ),
    );
    throw error;
  }
  const appliedReceipt = makeReceipt(
    registration,
    {
      request_key: requestKey,
      rollout_job_id: requestAndObservation.applied.jobId,
      rollout_status: requestAndObservation.applied.status,
      deployment_status: "pending",
      outcome: "rollout_applied",
    },
    runtimeImages,
  );
  await writeReceipt(receiptPath, appliedReceipt);
  try {
    await applyKubernetesRelease({
      rootDir,
      namespace,
      kustomizeDir,
      registration,
      imageRepository: runtimeImages.web.imageRepository,
      eventProcessorImageRepository:
        runtimeImages.eventProcessor.imageRepository,
      token: requireNonEmpty(
        env.REEF_CONTROL_PLANE_TOKEN,
        "REEF_CONTROL_PLANE_TOKEN",
      ),
      runCommand,
      env,
      kubernetesTimeoutMs,
    });
  } catch (error) {
    await writeReceipt(
      receiptPath,
      makeReceipt(
        registration,
        {
          request_key: requestKey,
          rollout_job_id: requestAndObservation.applied.jobId,
          rollout_status: requestAndObservation.applied.status,
          deployment_status: "failed",
          outcome: "runtime_failed",
        },
        runtimeImages,
      ),
    );
    throw error;
  }
  const complete = makeReceipt(
    registration,
    {
      request_key: requestKey,
      rollout_job_id: requestAndObservation.applied.jobId,
      rollout_status: requestAndObservation.applied.status,
      deployment_status: "ready",
      outcome: "deployed",
    },
    runtimeImages,
  );
  await writeReceipt(receiptPath, complete);
  return complete;
}

async function runResume({
  rootDir,
  env,
  options,
  core,
  runCommand,
  now,
  sleep,
  fetchImpl,
}) {
  await runChecked(
    runCommand,
    "pnpm",
    ["--filter", "@reef/core", "run", "build"],
    {
      cwd: rootDir,
      env,
      stage: "core_build",
    },
  );
  const releaseCore = core ?? (await loadCore(rootDir));
  const receiptPath = options.receipt ?? env.REEF_RELEASE_RECEIPT;
  const saved = await readReceipt(receiptPath, releaseCore);
  const registration = saved?.registration;
  if (!registration) {
    throw new DeploymentError("resume requires a registration receipt", {
      stage: "input_validation",
    });
  }
  const sourceRolloutId = ensureRolloutKey(
    releaseCore,
    options.source_rollout_id ??
      env.REEF_SOURCE_ROLLOUT_ID ??
      saved.receipt.rollout_job_id,
    "source rollout id",
  );
  const originalRequestKey = saved.receipt.request_key;
  const resumeKey = ensureRolloutKey(
    releaseCore,
    options.request_key ??
      env.REEF_ROLLOUT_REQUEST_KEY ??
      saved.receipt.resume_request_key ??
      randomUUID(),
    "resume request key",
  );
  if (resumeKey === originalRequestKey) {
    throw new DeploymentError("resume requires a new idempotency key", {
      stage: "input_validation",
    });
  }
  const rolloutDeadlineMs = parsePositiveInteger(
    options.rollout_deadline_ms ?? env.REEF_ROLLOUT_DEADLINE_MS,
    "rollout deadline",
    DEFAULT_ROLLOUT_DEADLINE_MS,
  );
  const rolloutPollMs = parsePositiveInteger(
    options.rollout_poll_ms ?? env.REEF_ROLLOUT_POLL_MS,
    "rollout poll interval",
    DEFAULT_ROLLOUT_POLL_MS,
  );
  const namespace = requireNonEmpty(
    options.namespace ?? env.NAMESPACE ?? DEFAULT_NAMESPACE,
    "Kubernetes namespace",
  );
  const kustomizeDir = path.resolve(
    rootDir,
    options.kustomize_dir ?? env.KUSTOMIZE_DIR ?? "deploy/k8s/overlays/example",
  );
  const kubernetesTimeoutMs = parsePositiveInteger(
    env.REEF_KUBERNETES_TIMEOUT_MS,
    "Kubernetes timeout",
    DEFAULT_KUBERNETES_TIMEOUT_MS,
  );
  const registry = releaseCore.createAkbAppRegistry({
    baseUrl: requireNonEmpty(env.AKB_BACKEND_URL, "AKB_BACKEND_URL"),
    adminToken: requireNonEmpty(
      env.REEF_CONTROL_PLANE_TOKEN,
      "REEF_CONTROL_PLANE_TOKEN",
    ),
    fetch: fetchImpl,
  });
  const release = await registry.getRelease(
    registration.appId,
    registration.releaseId,
  );
  let verifiedRelease;
  try {
    verifiedRelease = await releaseCore.verifyFinalizedRelease({
      version: release.version,
      manifest: release.manifest,
      manifest_checksum: release.manifestChecksum,
    });
  } catch {
    throw new DeploymentError(
      "The resumed release manifest is not a valid immutable Reef release",
      { stage: "release_registration" },
    );
  }
  if (
    release.version !== registration.version ||
    release.manifestChecksum !== registration.manifestChecksum ||
    verifiedRelease.manifest.source_revision !== registration.sourceRevision ||
    verifiedRelease.manifest.runtime_images.web !==
      registration.runtimeImageDigests.web ||
    verifiedRelease.manifest.runtime_images.event_processor !==
      registration.runtimeImageDigests.eventProcessor
  ) {
    throw new DeploymentError(
      "The resumed release identity does not match the receipt",
      {
        stage: "release_registration",
      },
    );
  }
  let applied;
  try {
    ({ applied } = await requestAndObserve({
      core: releaseCore,
      env,
      registration,
      fetchImpl,
      requestKey: resumeKey,
      sourceRolloutId,
      resume: true,
      deadlineMs: rolloutDeadlineMs,
      pollMs: rolloutPollMs,
      now,
      sleep,
    }));
  } catch (error) {
    await writeReceipt(
      receiptPath,
      makeReceipt(
        registration,
        {
          request_key: originalRequestKey ?? null,
          resume_request_key: resumeKey,
          source_rollout_id: sourceRolloutId,
          rollout_job_id: error.details?.job_id ?? null,
          rollout_status: error.details?.status ?? "unknown",
          deployment_status: "not_applied",
          outcome: "resume_failed",
        },
        saved.runtimeImages,
      ),
    );
    throw error;
  }
  const runtimeImages = saved.runtimeImages;
  const receipt = makeReceipt(
    registration,
    {
      request_key: originalRequestKey ?? null,
      resume_request_key: resumeKey,
      source_rollout_id: sourceRolloutId,
      rollout_job_id: applied.jobId,
      rollout_status: applied.status,
      deployment_status: "pending",
      outcome: "rollout_applied",
    },
    runtimeImages,
  );
  await writeReceipt(receiptPath, receipt);
  try {
    await applyKubernetesRelease({
      rootDir,
      namespace,
      kustomizeDir,
      registration,
      imageRepository: runtimeImages.web.imageRepository,
      eventProcessorImageRepository:
        runtimeImages.eventProcessor.imageRepository,
      token: requireNonEmpty(
        env.REEF_CONTROL_PLANE_TOKEN,
        "REEF_CONTROL_PLANE_TOKEN",
      ),
      runCommand,
      env,
      kubernetesTimeoutMs,
    });
  } catch (error) {
    await writeReceipt(receiptPath, {
      ...receipt,
      deployment_status: "failed",
      outcome: "runtime_failed",
    });
    throw error;
  }
  const complete = {
    ...receipt,
    deployment_status: "ready",
    outcome: "deployed",
  };
  await writeReceipt(receiptPath, complete);
  return complete;
}

export async function runReleaseDeployment({
  rootDir = DEFAULT_ROOT_DIR,
  env = process.env,
  options = { mode: "deploy" },
  runCommand = defaultRunCommand,
  now = () => Date.now(),
  sleep = delay,
  fetchImpl = globalThis.fetch,
  core,
} = {}) {
  if (options.mode === "build") {
    return runBuildOnly({ rootDir, env, options, core, runCommand });
  }
  if (options.mode === "register") {
    return runRegisterOnly({
      rootDir,
      env,
      options,
      core,
      runCommand,
      fetchImpl,
    });
  }
  if (options.mode === "resume") {
    return runResume({
      rootDir,
      env,
      options,
      core,
      runCommand,
      now,
      sleep,
      fetchImpl,
    });
  }
  return runDeploy({
    rootDir,
    env,
    options,
    core,
    runCommand,
    now,
    sleep,
    fetchImpl,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const result = await runReleaseDeployment({ options });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(SCRIPT_DIR, "release-deploy.mjs")
) {
  main().catch((error) => {
    const message =
      error instanceof DeploymentError
        ? error.message
        : "Release deployment failed";
    const stage = error instanceof DeploymentError ? error.stage : "deployment";
    process.stderr.write(`${stage}: ${message}\n`);
    process.exitCode = 1;
  });
}

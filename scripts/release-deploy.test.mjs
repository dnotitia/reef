import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as core from "../packages/core/dist/index.js";
import { parseAllDocuments } from "yaml";
import {
  applyKubernetesRelease,
  assertKubernetesReadback,
  observeRollout,
  renderKubernetesManifest,
  runReleaseDeployment,
} from "./release-deploy.mjs";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const IMAGE_DIGEST = `sha256:${"b".repeat(64)}`;
const EVENT_PROCESSOR_IMAGE_DIGEST = `sha256:${"c".repeat(64)}`;
const RUNTIME_IMAGES = {
  web: {
    image_repository: "registry.example/reef-web",
    image_digest: IMAGE_DIGEST,
    image_reference: `registry.example/reef-web@${IMAGE_DIGEST}`,
  },
  event_processor: {
    image_repository: "registry.example/reef-event-processor",
    image_digest: EVENT_PROCESSOR_IMAGE_DIGEST,
    image_reference: `registry.example/reef-event-processor@${EVENT_PROCESSOR_IMAGE_DIGEST}`,
  },
};
const TOKEN = "system-admin-secret";

test("the repair release requires a receipt before any AKB request", async () => {
  await assert.rejects(
    runReleaseDeployment({
      options: { mode: "deploy" },
      env: { REGISTRY: "registry.example" },
      core,
      runCommand: async (command, args) => ({
        exitCode: 0,
        stdout:
          command === "git" && args[0] === "rev-parse"
            ? `${"a".repeat(40)}\n`
            : "",
        stderr: "",
      }),
      fetchImpl: async () => {
        throw new Error("AKB must not be called");
      },
    }),
    /receipt/i,
  );
});
test("the obsolete repair option is rejected", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/release-deploy.mjs", "deploy", "--backfill-issue-relation-uris"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option: --backfill-issue-relation-uris/);
});
const PRODUCT_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const EVENT_PROCESSOR_MANIFEST = `---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reef-event-processor
spec:
  replicas: 1
  strategy:
    type: Recreate
  template:
    metadata: {}
    spec:
      containers:
        - name: reef-event-processor
          image: reef-event-processor:latest
`;

function processorDeploymentFixture(
  sourceRevision,
  manifestChecksum,
  digest = IMAGE_DIGEST,
  version = PRODUCT_VERSION,
) {
  const image = `registry.example/reef-event-processor@${digest}`;
  const provenance = [
    `Deploy reef v${version}`,
    `source ${sourceRevision}`,
    `app ${APP_ID}`,
    `release ${RELEASE_ID}`,
    `web-image ${IMAGE_DIGEST}`,
    `event-processor-image ${digest}`,
    `manifest ${manifestChecksum}`,
  ].join("; ");
  return {
    metadata: { annotations: { "kubernetes.io/change-cause": provenance } },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      template: {
        metadata: { annotations: { "kubernetes.io/change-cause": provenance } },
        spec: {
          containers: [
            {
              name: "reef-event-processor",
              image,
              env: [
                { name: "REEF_APP_ID", value: APP_ID },
                { name: "REEF_RELEASE_ID", value: RELEASE_ID },
                { name: "REEF_RELEASE_VERSION", value: version },
                { name: "REEF_RELEASE_SOURCE_REVISION", value: sourceRevision },
                {
                  name: "REEF_RELEASE_MANIFEST_CHECKSUM",
                  value: manifestChecksum,
                },
                { name: "REEF_EVENT_PROCESSOR_IMAGE_DIGEST", value: digest },
              ],
            },
          ],
        },
      },
    },
  };
}

function processorPodFixture(
  sourceRevision,
  manifestChecksum,
  digest = IMAGE_DIGEST,
) {
  return {
    items: [
      {
        spec: {
          containers: [
            {
              name: "reef-event-processor",
              image: `registry.example/reef-event-processor@${digest}`,
            },
          ],
        },
        status: {
          containerStatuses: [
            {
              name: "reef-event-processor",
              ready: true,
              imageID: `containerd://sha256:${"d".repeat(64)}`,
            },
          ],
        },
      },
    ],
  };
}

test("build-only creates a verifiable build artifact without AKB or Kubernetes calls", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-build-test-"),
  );
  const artifactPath = path.join(temporaryDirectory, "build.json");
  const sourceRevision = "a".repeat(40);
  const secondImageDigest = `sha256:${"c".repeat(64)}`;
  const existingRegistryTags = new Set([
    `registry.example/reef-web:v${PRODUCT_VERSION}`,
    `registry.example/reef-web:${sourceRevision}`,
  ]);
  const commands = [];
  let buildCount = 0;
  const runCommand = async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === "pnpm") return { exitCode: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "status") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { exitCode: 0, stdout: `${sourceRevision}\n`, stderr: "" };
    }
    if (command === "docker") {
      buildCount += 1;
      const tags = args
        .flatMap((argument, index) =>
          argument === "--tag" ? [args[index + 1]] : [],
        )
        .filter(Boolean);
      assert.equal(tags.length, 1);
      for (const tag of tags) {
        assert.equal(
          existingRegistryTags.has(tag),
          false,
          "a release build must not overwrite an existing mutable tag",
        );
        existingRegistryTags.add(tag);
      }
      const metadataPath = args[args.indexOf("--metadata-file") + 1];
      await writeFile(
        metadataPath,
        JSON.stringify({
          "containerimage.digest":
            buildCount === 1 ? IMAGE_DIGEST : secondImageDigest,
        }),
      );
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected child command: ${command}`);
  };

  try {
    const result = await runReleaseDeployment({
      rootDir: path.resolve("."),
      env: { REGISTRY: "registry.example" },
      options: { mode: "build", build_artifact: artifactPath },
      runCommand,
      fetchImpl: async () => {
        throw new Error("build-only must not call AKB");
      },
      core,
    });
    assert.deepEqual(result, {
      kind: "reef-build-artifact",
      runtime_images: {
        web: {
          image_repository: "registry.example/reef-web",
          image_digest: IMAGE_DIGEST,
          image_reference: `registry.example/reef-web@${IMAGE_DIGEST}`,
        },
        event_processor: {
          image_repository: "registry.example/reef-event-processor",
          image_digest: secondImageDigest,
          image_reference: `registry.example/reef-event-processor@${secondImageDigest}`,
        },
      },
      source_revision: sourceRevision,
      version: PRODUCT_VERSION,
    });
    assert.deepEqual(JSON.parse(await readFile(artifactPath, "utf8")), result);
    assert.equal(
      commands.some(({ command }) => command === "kubectl"),
      false,
    );
    const dockerArgs =
      commands.find(({ command }) => command === "docker")?.args ?? [];
    assert.ok(dockerArgs.includes(`REEF_VERSION=${PRODUCT_VERSION}`));
    assert.ok(dockerArgs.includes(`REEF_SOURCE_REVISION=${sourceRevision}`));
    const dockerTags = dockerArgs
      .flatMap((argument, index) =>
        argument === "--tag" ? [dockerArgs[index + 1]] : [],
      )
      .filter(Boolean);
    assert.equal(
      dockerTags.some((tag) => tag.endsWith(`:v${PRODUCT_VERSION}`)),
      false,
    );
    assert.equal(
      dockerTags.some((tag) => tag.endsWith(`:${sourceRevision}`)),
      false,
    );
    const dockerBuildTargets = commands
      .filter(({ command }) => command === "docker")
      .map(({ args }) => args[args.indexOf("--target") + 1]);
    assert.deepEqual(dockerBuildTargets, ["reef-web", "reef-event-processor"]);
    const buildTagPrefix = `registry.example/reef-web:build-${PRODUCT_VERSION}-${sourceRevision}-`;
    assert.equal(dockerTags[0].startsWith(buildTagPrefix), true);
    assert.match(
      dockerTags[0].slice(buildTagPrefix.length),
      /^[0-9a-f-]{36}$/u,
    );

    const rebuilt = await runReleaseDeployment({
      rootDir: path.resolve("."),
      env: { REGISTRY: "registry.example" },
      options: { mode: "build", build_artifact: artifactPath },
      runCommand,
      fetchImpl: async () => {
        throw new Error("build-only must not call AKB");
      },
      core,
    });
    assert.equal(rebuilt.runtime_images.web.image_digest, secondImageDigest);
    assert.notEqual(
      rebuilt.runtime_images.web.image_digest,
      result.runtime_images.web.image_digest,
    );
    assert.deepEqual(JSON.parse(await readFile(artifactPath, "utf8")), rebuilt);
    assert.equal(
      existingRegistryTags.has(`registry.example/reef-web:v${PRODUCT_VERSION}`),
      true,
    );
    assert.equal(
      existingRegistryTags.has(`registry.example/reef-web:${sourceRevision}`),
      true,
    );
    assert.equal(
      commands.filter(({ command }) => command === "docker").length,
      4,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("register consumes a build artifact generated for a host-port registry", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-host-port-register-test-"),
  );
  const artifactPath = path.join(temporaryDirectory, "build.json");
  const receiptPath = path.join(temporaryDirectory, "receipt.json");
  const sourceRevision = "a".repeat(40);
  const registry = "localhost:55000";
  const commands = [];
  const requests = [];
  const runCommand = async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === "pnpm") return { exitCode: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "status") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { exitCode: 0, stdout: `${sourceRevision}\n`, stderr: "" };
    }
    if (command === "docker") {
      const metadataPath = args[args.indexOf("--metadata-file") + 1];
      await writeFile(
        metadataPath,
        JSON.stringify({ "containerimage.digest": IMAGE_DIGEST }),
      );
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected child command: ${command}`);
  };
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/apps")) {
      return new Response(
        JSON.stringify({
          id: APP_ID,
          app_key: "reef",
          display_name: "Reef",
          description: "Reef project management workspace",
          created_at: "2026-09-04T06:00:00.000Z",
          updated_at: "2026-09-04T06:00:00.000Z",
          replayed: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    assert.ok(url.endsWith(`/apps/${APP_ID}/releases`));
    const body = JSON.parse(String(init.body));
    assert.equal(body.manifest.manifest_version, 2);
    assert.equal(body.manifest.image_digest, IMAGE_DIGEST);
    assert.equal(body.manifest.runtime_images, undefined);
    return new Response(
      JSON.stringify({
        id: RELEASE_ID,
        app_id: APP_ID,
        version: body.version,
        manifest: body.manifest,
        manifest_checksum: body.manifest_checksum,
        registered_at: "2026-09-04T06:00:00.000Z",
        replayed: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const built = await runReleaseDeployment({
      rootDir: path.resolve("."),
      env: { REGISTRY: registry },
      options: { mode: "build", build_artifact: artifactPath },
      runCommand,
      fetchImpl,
      core,
    });
    assert.equal(
      built.runtime_images.web.image_repository,
      `${registry}/reef-web`,
    );
    assert.equal(
      built.runtime_images.event_processor.image_repository,
      `${registry}/reef-event-processor`,
    );

    const registered = await runReleaseDeployment({
      rootDir: path.resolve("."),
      env: {
        AKB_BACKEND_URL: "https://akb.example.test",
        REEF_CONTROL_PLANE_TOKEN: TOKEN,
      },
      options: {
        mode: "register",
        build_artifact: artifactPath,
        receipt: receiptPath,
      },
      runCommand,
      fetchImpl,
      core,
    });
    assert.equal(registered.outcome, "registered");
    assert.equal(
      registered.runtime_images.web.image_repository,
      `${registry}/reef-web`,
    );
    assert.equal(requests.length, 2);
    assert.equal(
      commands.filter(({ command }) => command === "docker").length,
      2,
    );
    assert.equal(
      commands.some(({ command }) => command === "kubectl"),
      false,
    );
    assert.deepEqual(JSON.parse(await readFile(artifactPath, "utf8")), built);
    assert.deepEqual(
      JSON.parse(await readFile(receiptPath, "utf8")),
      registered,
    );
    for (const imageRepository of [
      `${registry}/reef-web:v${PRODUCT_VERSION}`,
      `${registry}/reef-web@${IMAGE_DIGEST}`,
      "reef-web:123",
    ]) {
      await writeFile(
        artifactPath,
        `${JSON.stringify({
          ...built,
          runtime_images: {
            web: {
              image_repository: imageRepository,
              image_digest: IMAGE_DIGEST,
              image_reference: `${imageRepository}@${IMAGE_DIGEST}`,
            },
            event_processor: built.runtime_images.event_processor,
          },
        })}\n`,
      );
      await assert.rejects(
        runReleaseDeployment({
          rootDir: path.resolve("."),
          env: {
            AKB_BACKEND_URL: "https://akb.example.test",
            REEF_CONTROL_PLANE_TOKEN: TOKEN,
          },
          options: {
            mode: "register",
            build_artifact: artifactPath,
            receipt: receiptPath,
          },
          runCommand,
          fetchImpl: async () => {
            throw new Error("invalid repository must not reach AKB");
          },
          core,
        }),
        /OCI image repository without a tag/u,
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("register-only returns a reusable result without rollout or Kubernetes mutation", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-register-test-"),
  );
  const receiptPath = path.join(temporaryDirectory, "receipt.json");
  const buildArtifactPath = path.join(temporaryDirectory, "build.json");
  const commands = [];
  const requests = [];
  const runCommand = async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === "pnpm") return { exitCode: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "status") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
    }
    throw new Error(`unexpected child command: ${command}`);
  };
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/apps")) {
      return new Response(
        JSON.stringify({
          id: APP_ID,
          app_key: "reef",
          display_name: "Reef",
          description: "Reef project management workspace",
          created_at: "2026-09-04T06:00:00.000Z",
          updated_at: "2026-09-04T06:00:00.000Z",
          replayed: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    assert.match(url, /\/apps\/[^/]+\/releases$/u);
    const body = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        id: RELEASE_ID,
        app_id: APP_ID,
        version: body.version,
        manifest: body.manifest,
        manifest_checksum: body.manifest_checksum,
        registered_at: "2026-09-04T06:00:00.000Z",
        replayed: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    await writeFile(
      buildArtifactPath,
      `${JSON.stringify({
        kind: "reef-build-artifact",
        runtime_images: RUNTIME_IMAGES,
        source_revision: "a".repeat(40),
        version: PRODUCT_VERSION,
      })}\n`,
    );
    const result = await runReleaseDeployment({
      rootDir: path.resolve("."),
      env: {
        AKB_BACKEND_URL: "https://akb.example.test",
        REEF_CONTROL_PLANE_TOKEN: TOKEN,
        REEF_RELEASE_RECEIPT: receiptPath,
      },
      options: {
        mode: "register",
        build_artifact: buildArtifactPath,
        receipt: receiptPath,
      },
      runCommand,
      fetchImpl,
      core,
    });

    assert.equal(result.outcome, "registered");
    assert.equal(result.app_id, APP_ID);
    assert.equal(result.release_id, RELEASE_ID);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(({ url }) => !url.includes("rollout")));
    assert.ok(
      commands.every(
        ({ command }) => command !== "docker" && command !== "kubectl",
      ),
    );
    for (const { options } of commands) {
      assert.equal(options.env.REEF_CONTROL_PLANE_TOKEN, undefined);
    }
    assert.deepEqual(JSON.parse(await readFile(receiptPath, "utf8")), result);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("register-only rejects a mutable image reference before image build or AKB calls", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-register-invalid-test-"),
  );
  const buildArtifactPath = path.join(temporaryDirectory, "build.json");
  const commands = [];
  const fetchImpl = async () => {
    throw new Error("network must not be reached");
  };
  try {
    await writeFile(
      buildArtifactPath,
      `${JSON.stringify({
        kind: "reef-build-artifact",
        runtime_images: {
          ...RUNTIME_IMAGES,
          web: {
            ...RUNTIME_IMAGES.web,
            image_digest: "reef-web:latest",
            image_reference: "registry.example/reef-web@reef-web:latest",
          },
        },
        source_revision: "a".repeat(40),
        version: PRODUCT_VERSION,
      })}\n`,
    );
    await assert.rejects(
      runReleaseDeployment({
        rootDir: path.resolve("."),
        env: {
          AKB_BACKEND_URL: "https://akb.example.test",
          REEF_CONTROL_PLANE_TOKEN: TOKEN,
        },
        options: { mode: "register", build_artifact: buildArtifactPath },
        runCommand: async (command, args, options) => {
          commands.push({ command, args, options });
          if (command === "pnpm")
            return { exitCode: 0, stdout: "", stderr: "" };
          if (command === "git" && args[0] === "status") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          if (command === "git" && args[0] === "rev-parse") {
            return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
          }
          throw new Error("unexpected command");
        },
        fetchImpl,
        core,
      }),
      /immutable sha256 image digest/u,
    );
    assert.equal(
      commands.filter(({ command }) => command === "docker").length,
      0,
    );
    assert.equal(
      commands.some(({ command }) => command === "kubectl"),
      false,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("register-only rejects a build artifact missing the processor image", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-register-missing-processor-test-"),
  );
  const buildArtifactPath = path.join(temporaryDirectory, "build.json");
  const commands = [];
  try {
    await writeFile(
      buildArtifactPath,
      `${JSON.stringify({
        kind: "reef-build-artifact",
        runtime_images: { web: RUNTIME_IMAGES.web },
        source_revision: "a".repeat(40),
        version: PRODUCT_VERSION,
      })}\n`,
    );
    await assert.rejects(
      runReleaseDeployment({
        rootDir: path.resolve("."),
        env: {
          AKB_BACKEND_URL: "https://akb.example.test",
          REEF_CONTROL_PLANE_TOKEN: TOKEN,
        },
        options: { mode: "register", build_artifact: buildArtifactPath },
        runCommand: async (command, args, options) => {
          commands.push({ command, args, options });
          if (command === "pnpm")
            return { exitCode: 0, stdout: "", stderr: "" };
          if (command === "git" && args[0] === "status")
            return { exitCode: 0, stdout: "", stderr: "" };
          if (command === "git" && args[0] === "rev-parse")
            return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
          throw new Error("unexpected command");
        },
        fetchImpl: async () => {
          throw new Error("network must not be reached");
        },
        core,
      }),
      /both runtime images/u,
    );
    assert.equal(
      commands.some(({ command }) => command === "docker"),
      false,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("register-only rejects a build artifact from another source revision or product version", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-register-stale-test-"),
  );
  const buildArtifactPath = path.join(temporaryDirectory, "build.json");
  try {
    for (const invalidIdentity of [
      { source_revision: "b".repeat(40), version: PRODUCT_VERSION },
      { source_revision: "a".repeat(40), version: "0.14.0" },
    ]) {
      const commands = [];
      let networkCalls = 0;
      await writeFile(
        buildArtifactPath,
        `${JSON.stringify({
          kind: "reef-build-artifact",
          runtime_images: RUNTIME_IMAGES,
          ...invalidIdentity,
        })}\n`,
      );
      await assert.rejects(
        runReleaseDeployment({
          rootDir: path.resolve("."),
          env: {
            AKB_BACKEND_URL: "https://akb.example.test",
            REEF_CONTROL_PLANE_TOKEN: TOKEN,
          },
          options: { mode: "register", build_artifact: buildArtifactPath },
          runCommand: async (command, args, options) => {
            commands.push({ command, args, options });
            if (command === "pnpm")
              return { exitCode: 0, stdout: "", stderr: "" };
            if (command === "git" && args[0] === "status") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }
            if (command === "git" && args[0] === "rev-parse") {
              return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
            }
            throw new Error("unexpected command");
          },
          fetchImpl: async () => {
            networkCalls += 1;
            throw new Error("network must not be reached");
          },
          core,
        }),
        (error) =>
          error?.stage === "artifact_validation" &&
          /does not match the current source and version/u.test(error.message),
      );
      assert.equal(networkCalls, 0);
      assert.equal(
        commands.some(
          ({ command }) => command === "docker" || command === "kubectl",
        ),
        false,
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("deploy observes AKB applied before applying the immutable Kubernetes revision", async () => {
  let backfillTarget = false;
  let checkIntent = false;
  let intentSeen = false;
  let failBackfill = true;
  let issuePatches = 0;
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-deploy-test-"),
  );
  const receiptPath = path.join(temporaryDirectory, "receipt.json");
  const buildArtifactPath = path.join(temporaryDirectory, "build.json");
  const commands = [];
  const requests = [];
  const events = [];
  let observations = 0;
  const sourceRevision = "a".repeat(40);
  const requestKey = "66666666-6666-4666-8666-666666666666";
  const jobId = "77777777-7777-4777-8777-777777777777";
  let manifestChecksum;
  let appliedInput = "";
  const kustomizeOutput = `apiVersion: v1
kind: ConfigMap
metadata:
  name: reef-web-config
data:
  AKB_BACKEND_URL: https://akb.example.test
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reef-web
spec:
  template:
    metadata:
      labels:
        app: reef-web
    spec:
      containers:
        - name: reef-web
          image: reef-web:latest
`;
  const rolloutBody = (status, extra = {}) => ({
    job_id: jobId,
    app_id: APP_ID,
    release_id: RELEASE_ID,
    manifest_checksum: manifestChecksum,
    status,
    blocked_reason: null,
    created_at: "2026-09-04T06:00:00.000Z",
    updated_at: "2026-09-04T06:00:00.000Z",
    completed_at: status === "applied" ? "2026-09-04T06:01:00.000Z" : null,
    targets: backfillTarget
      ? [
          {
            target_id: "33333333-3333-4333-8333-333333333333",
            installation_id: "44444444-4444-4444-8444-444444444444",
            vault_id: "55555555-5555-4555-8555-555555555555",
            ordinal: 0,
            batch: 0,
            canary: false,
            state: "applied",
            steps: [],
          },
        ]
      : [],
    ...extra,
  });
  const runCommand = async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === "pnpm") return { exitCode: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "status") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { exitCode: 0, stdout: `${sourceRevision}\n`, stderr: "" };
    }
    if (command === "docker") {
      const metadataPath = args[args.indexOf("--metadata-file") + 1];
      await writeFile(
        metadataPath,
        JSON.stringify({ "containerimage.digest": IMAGE_DIGEST }),
      );
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "kubectl" && args[0] === "kustomize") {
      events.push("kubernetes");
      return {
        exitCode: 0,
        stdout: `${kustomizeOutput}${EVENT_PROCESSOR_MANIFEST}`,
        stderr: "",
      };
    }
    if (command === "kubectl" && args[0] === "apply") {
      appliedInput = options.input;
      return { exitCode: 0, stdout: "configured\n", stderr: "" };
    }
    if (command === "kubectl" && args[0] === "rollout") {
      return {
        exitCode: 0,
        stdout: "deployment successfully rolled out\n",
        stderr: "",
      };
    }
    if (
      command === "kubectl" &&
      args[0] === "get" &&
      args[1] === "deployment/reef-web"
    ) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          metadata: {
            annotations: {
              "kubernetes.io/change-cause": [
                `Deploy reef v${PRODUCT_VERSION}`,
                `source ${sourceRevision}`,
                `app ${APP_ID}`,
                `release ${RELEASE_ID}`,
                `web-image ${IMAGE_DIGEST}`,
                `event-processor-image ${IMAGE_DIGEST}`,
                `manifest ${manifestChecksum}`,
              ].join("; "),
            },
          },
          spec: {
            template: {
              metadata: {
                annotations: {
                  "kubernetes.io/change-cause": [
                    `Deploy reef v${PRODUCT_VERSION}`,
                    `source ${sourceRevision}`,
                    `app ${APP_ID}`,
                    `release ${RELEASE_ID}`,
                    `web-image ${IMAGE_DIGEST}`,
                    `event-processor-image ${IMAGE_DIGEST}`,
                    `manifest ${manifestChecksum}`,
                  ].join("; "),
                },
              },
              spec: {
                containers: [
                  {
                    name: "reef-web",
                    image: `registry.example/reef-web@${IMAGE_DIGEST}`,
                    env: [
                      { name: "REEF_APP_ID", value: APP_ID },
                      { name: "REEF_RELEASE_ID", value: RELEASE_ID },
                      { name: "REEF_RELEASE_VERSION", value: PRODUCT_VERSION },
                      {
                        name: "REEF_RELEASE_SOURCE_REVISION",
                        value: sourceRevision,
                      },
                      {
                        name: "REEF_RELEASE_IMAGE_DIGEST",
                        value: IMAGE_DIGEST,
                      },
                      {
                        name: "REEF_RELEASE_MANIFEST_CHECKSUM",
                        value: manifestChecksum,
                      },
                    ],
                  },
                ],
              },
            },
          },
        }),
        stderr: "",
      };
    }
    if (
      command === "kubectl" &&
      args[0] === "get" &&
      args[1] === "deployment/reef-event-processor"
    ) {
      return {
        exitCode: 0,
        stdout: JSON.stringify(
          processorDeploymentFixture(sourceRevision, manifestChecksum),
        ),
        stderr: "",
      };
    }
    if (
      command === "kubectl" &&
      args[0] === "get" &&
      args[1] === "configmap/reef-web-config"
    ) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            REEF_APP_ID: APP_ID,
            REEF_RELEASE_ID: RELEASE_ID,
            REEF_RELEASE_VERSION: PRODUCT_VERSION,
            REEF_RELEASE_SOURCE_REVISION: sourceRevision,
            REEF_RELEASE_IMAGE_DIGEST: IMAGE_DIGEST,
            REEF_RELEASE_MANIFEST_CHECKSUM: manifestChecksum,
          },
        }),
        stderr: "",
      };
    }
    if (command === "kubectl" && args[0] === "get" && args[1] === "pods") {
      if (args.includes("app=reef-event-processor")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            processorPodFixture(sourceRevision, manifestChecksum),
          ),
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          items: [
            {
              spec: {
                containers: [
                  {
                    name: "reef-web",
                    image: `registry.example/reef-web@${IMAGE_DIGEST}`,
                    env: [
                      { name: "REEF_APP_ID", value: APP_ID },
                      { name: "REEF_RELEASE_ID", value: RELEASE_ID },
                      { name: "REEF_RELEASE_VERSION", value: PRODUCT_VERSION },
                      {
                        name: "REEF_RELEASE_SOURCE_REVISION",
                        value: sourceRevision,
                      },
                      {
                        name: "REEF_RELEASE_IMAGE_DIGEST",
                        value: IMAGE_DIGEST,
                      },
                      {
                        name: "REEF_RELEASE_MANIFEST_CHECKSUM",
                        value: manifestChecksum,
                      },
                    ],
                  },
                ],
              },
              status: {
                containerStatuses: [
                  {
                    name: "reef-web",
                    ready: true,
                    imageID: `containerd://sha256:${"d".repeat(64)}`,
                  },
                ],
              },
            },
          ],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected child command: ${command} ${args.join(" ")}`);
  };
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    const parsedUrl = new URL(url);
    if (backfillTarget && parsedUrl.pathname === "/api/v1/auth/me") {
      return Response.json({ auth_method: "jwt", is_admin: true });
    }
    if (
      backfillTarget &&
      parsedUrl.pathname === "/api/v1/vaults/reef-sample/info"
    ) {
      return Response.json({
        status: "active",
        is_archived: false,
        is_external_git: false,
        managed_by: null,
        role: "admin",
      });
    }
    if (parsedUrl.pathname.endsWith(`/apps/${APP_ID}/inventory`)) {
      return Response.json({
        items: backfillTarget
          ? [
              {
                installation_id: "44444444-4444-4444-8444-444444444444",
                app_id: APP_ID,
                vault_id: "55555555-5555-4555-8555-555555555555",
                vault_name: "reef-sample",
                lifecycle: "active",
              },
            ]
          : [],
        next_cursor: null,
      });
    }
    if (
      backfillTarget &&
      parsedUrl.pathname === "/api/v1/tables/reef-sample/sql"
    ) {
      const { sql } = JSON.parse(String(init.body));
      if (sql.startsWith("SELECT reef_id"))
        return Response.json({
          kind: "table_query",
          columns: [
            "reef_id",
            "document_uri",
            "depends_on",
            "blocks",
            "related_to",
            "updated_at",
          ],
          items: [
            {
              reef_id: "REEF-001",
              document_uri: "akb://reef-sample/doc/issue.md",
              depends_on: [],
              blocks: [],
              related_to: [],
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
          total: 1,
        });
      return Response.json({ kind: "table_sql", result: "UPDATE 1" });
    }
    if (backfillTarget && parsedUrl.pathname === "/api/v1/relations")
      return Response.json({
        uri: parsedUrl.searchParams.get("uri"),
        relations: [],
      });
    if (
      backfillTarget &&
      parsedUrl.pathname.startsWith("/api/v1/documents/reef-sample/")
    ) {
      const documentPath = parsedUrl.pathname.slice(
        "/api/v1/documents/reef-sample/".length,
      );
      if (documentPath === "issue.md" && init.method === "PATCH") {
        issuePatches++;
        if (failBackfill)
          return Response.json({ detail: "repair failed" }, { status: 500 });
        return Response.json({
          uri: "akb://reef-sample/doc/issue.md",
          vault: "reef-sample",
          path: "issue.md",
          commit_hash: "patched",
        });
      }
      if (documentPath === "issue.md")
        return Response.json({
          uri: "akb://reef-sample/doc/issue.md",
          vault: "reef-sample",
          path: "issue.md",
          title: "REEF-001",
          type: "task",
          status: "active",
          content: "body",
          current_commit: "head",
          tags: [],
        });
      const document = core
        .akbBuildReefVaultSkillDocuments("reef-sample")
        .find((item) => item.path === documentPath);
      if (!document) throw new Error(`Unexpected document ${documentPath}`);
      return Response.json({
        uri: `akb://reef-sample/doc/${documentPath}`,
        vault: "reef-sample",
        path: documentPath,
        title: document.title,
        type: document.type,
        status: "active",
        summary: document.summary,
        tags: document.tags,
        content: document.content,
        current_commit: "head",
      });
    }
    if (url.endsWith("/apps")) {
      if (checkIntent) {
        try {
          intentSeen =
            JSON.parse(await readFile(receiptPath, "utf8"))
              .issue_relation_backfill?.targets === null;
        } catch {
          intentSeen = false;
        }
        throw new Error("registration interrupted");
      }
      return new Response(
        JSON.stringify({
          id: APP_ID,
          app_key: "reef",
          display_name: "Reef",
          description: "Reef project management workspace",
          created_at: "2026-09-04T06:00:00.000Z",
          updated_at: "2026-09-04T06:00:00.000Z",
          replayed: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith(`/apps/${APP_ID}`)) {
      return new Response(
        JSON.stringify({
          id: APP_ID,
          app_key: "reef",
          display_name: "Reef",
          description: "Reef project management workspace",
          created_at: "2026-09-04T06:00:00.000Z",
          updated_at: "2026-09-04T06:00:00.000Z",
          replayed: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/releases")) {
      const body = JSON.parse(String(init.body));
      manifestChecksum = body.manifest_checksum;
      return new Response(
        JSON.stringify({
          id: RELEASE_ID,
          app_id: APP_ID,
          version: body.version,
          manifest: body.manifest,
          manifest_checksum: manifestChecksum,
          registered_at: "2026-09-04T06:00:00.000Z",
          replayed: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/rollouts")) {
      observations = 0;
      const persisted = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(
        persisted.request_key,
        new Headers(init.headers).get("idempotency-key"),
      );
      return new Response(JSON.stringify(rolloutBody("pending")), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }
    assert.ok(url.endsWith(`/rollouts/${jobId}`));
    const status = ++observations === 1 ? "running" : "applied";
    events.push(`rollout:${status}`);
    return new Response(JSON.stringify(rolloutBody(status)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await runReleaseDeployment({
      rootDir: path.resolve("."),
      env: {
        AKB_BACKEND_URL: "https://akb.example.test",
        REEF_CONTROL_PLANE_TOKEN: TOKEN,
        REGISTRY: "registry.example",
        REEF_BUILD_ARTIFACT: buildArtifactPath,
      },
      options: {
        mode: "deploy",
        request_key: requestKey,
        receipt: receiptPath,
        rollout_deadline_ms: "1000",
        rollout_poll_ms: "1",
      },
      runCommand,
      fetchImpl,
      core,
    });

    assert.deepEqual(events, [
      "rollout:running",
      "rollout:applied",
      "kubernetes",
    ]);
    assert.equal(result.outcome, "deployed");
    assert.equal(result.rollout_status, "applied");
    assert.equal(result.deployment_status, "ready");
    assert.equal(appliedInput.includes(TOKEN), false);
    assert.equal(appliedInput.includes(IMAGE_DIGEST), true);
    assert.match(appliedInput, /REEF_RELEASE_ID/u);
    assert.deepEqual(JSON.parse(await readFile(buildArtifactPath, "utf8")), {
      kind: "reef-build-artifact",
      runtime_images: {
        web: {
          image_repository: "registry.example/reef-web",
          image_digest: IMAGE_DIGEST,
          image_reference: `registry.example/reef-web@${IMAGE_DIGEST}`,
        },
        event_processor: {
          image_repository: "registry.example/reef-event-processor",
          image_digest: IMAGE_DIGEST,
          image_reference: `registry.example/reef-event-processor@${IMAGE_DIGEST}`,
        },
      },
      source_revision: sourceRevision,
      version: PRODUCT_VERSION,
    });
    assert.deepEqual(JSON.parse(await readFile(receiptPath, "utf8")), result);
    assert.equal(
      requests.filter(({ url }) => url.includes("/rollouts")).length,
      3,
    );
    assert.equal(
      commands.filter(
        ({ command, args }) => command === "kubectl" && args[0] === "rollout",
      ).length,
      2,
    );
    assert.equal(
      commands.some(
        ({ command, args }) =>
          command === "kubectl" &&
          args[0] === "get" &&
          args[1] === "configmap/reef-web-config",
      ),
      false,
    );
    const registrationRequestCount = requests.filter(
      ({ url }) => url.endsWith("/apps") || url.endsWith("/releases"),
    ).length;
    const dockerBuildCount = commands.filter(
      ({ command }) => command === "docker",
    ).length;
    for (const { options } of commands) {
      assert.equal(options.env.REEF_CONTROL_PLANE_TOKEN, undefined);
    }
    const replayed = await runReleaseDeployment({
      rootDir: path.resolve("."),
      env: {
        AKB_BACKEND_URL: "https://akb.example.test",
        REEF_CONTROL_PLANE_TOKEN: TOKEN,
        REGISTRY: "registry.example",
        REEF_BUILD_ARTIFACT: buildArtifactPath,
      },
      options: {
        mode: "deploy",
        receipt: receiptPath,
        rollout_deadline_ms: "1000",
        rollout_poll_ms: "1",
      },
      runCommand,
      fetchImpl,
      core,
    });
    assert.deepEqual(events.slice(3), ["rollout:applied", "kubernetes"]);
    assert.equal(replayed.request_key, requestKey);
    assert.equal(
      commands.filter(({ command }) => command === "docker").length,
      dockerBuildCount,
    );
    assert.equal(
      requests.filter(
        ({ url }) => url.endsWith("/apps") || url.endsWith("/releases"),
      ).length,
      registrationRequestCount,
    );
    const rolloutRequests = requests.filter(({ url }) =>
      url.endsWith("/rollouts"),
    );
    assert.equal(
      new Headers(rolloutRequests.at(-1)?.init.headers).get("idempotency-key"),
      requestKey,
    );
    await writeFile(
      receiptPath,
      `${JSON.stringify({
        kind: "reef-release-receipt",
        app_id: result.app_id,
        release_id: result.release_id,
        app_key: result.app_key,
        version: result.version,
        source_revision: result.source_revision,
        runtime_images: result.runtime_images,
        manifest_checksum: result.manifest_checksum,
        app_replayed: result.app_replayed,
        release_replayed: result.release_replayed,
        outcome: "registered",
      })}\n`,
    );
    const registeredReceiptDeployment = await runReleaseDeployment({
      rootDir: path.resolve("."),
      env: {
        AKB_BACKEND_URL: "https://akb.example.test",
        REEF_CONTROL_PLANE_TOKEN: TOKEN,
        REGISTRY: "registry.example",
      },
      options: {
        mode: "deploy",
        receipt: receiptPath,
        rollout_deadline_ms: "1000",
        rollout_poll_ms: "1",
      },
      runCommand,
      fetchImpl,
      core,
    });
    assert.deepEqual(events.slice(5), [
      "rollout:running",
      "rollout:applied",
      "kubernetes",
    ]);
    assert.equal(registeredReceiptDeployment.release_id, result.release_id);
    assert.equal(
      registeredReceiptDeployment.runtime_images.web.image_digest,
      result.runtime_images.web.image_digest,
    );
    assert.notEqual(registeredReceiptDeployment.request_key, requestKey);
    assert.equal(
      commands.filter(({ command }) => command === "docker").length,
      dockerBuildCount,
    );
    assert.equal(
      requests.filter(
        ({ url }) => url.endsWith("/apps") || url.endsWith("/releases"),
      ).length,
      registrationRequestCount,
    );
    await rm(receiptPath);
    backfillTarget = true;
    const backfillArgs = {
      rootDir: path.resolve("."),
      env: {
        AKB_BACKEND_URL: "https://akb.example.test",
        REEF_CONTROL_PLANE_TOKEN: TOKEN,
        REGISTRY: "registry.example",
      },
      options: {
        mode: "deploy",
        receipt: receiptPath,
      },
      runCommand,
      fetchImpl,
      core,
    };
    await assert.rejects(runReleaseDeployment(backfillArgs));
    const failed = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(failed.outcome, "data_backfill_failed");
    assert.equal(failed.deployment_status, "ready");
    assert.equal(failed.issue_relation_backfill.targets[0].status, "failed");
    failBackfill = false;
    const rolloutPostsBeforeRetry = requests.filter(
      ({ url, init }) => url.endsWith("/rollouts") && init.method === "POST",
    ).length;
    const recovered = await runReleaseDeployment({
      ...backfillArgs,
      options: { mode: "deploy", receipt: receiptPath },
    });
    assert.equal(
      recovered.issue_relation_backfill.targets[0].status,
      "verified",
    );
    assert.equal(recovered.outcome, "deployed");
    assert.equal(
      requests.filter(
        ({ url, init }) => url.endsWith("/rollouts") && init.method === "POST",
      ).length,
      rolloutPostsBeforeRetry,
    );
    assert.equal(
      requests.some(({ url }) => url.includes("/resume")),
      false,
    );
    await runReleaseDeployment({
      ...backfillArgs,
      options: { mode: "deploy", receipt: receiptPath },
    });
    assert.equal(issuePatches, 2);
    await rm(receiptPath);
    checkIntent = true;
    await assert.rejects(runReleaseDeployment({ ...backfillArgs, core }));
    assert.equal(
      intentSeen,
      true,
      "required migration must be durable before the first AKB registration request",
    );
    checkIntent = false;
    const fromIntent = await runReleaseDeployment({
      ...backfillArgs,
      options: { mode: "deploy", receipt: receiptPath },
    });
    assert.equal(
      fromIntent.issue_relation_backfill.targets[0].status,
      "verified",
    );
    await rm(receiptPath);
    backfillTarget = false;
    const otherRoot = path.join(temporaryDirectory, "other-release");
    await mkdir(path.join(otherRoot, "release"), { recursive: true });
    await writeFile(
      path.join(otherRoot, "package.json"),
      JSON.stringify({ version: "0.17.8" }),
    );
    await copyFile(
      "release/reef-release-blueprint.json",
      path.join(otherRoot, "release/reef-release-blueprint.json"),
    );
    const inventoryBefore = requests.filter(({ url }) =>
      url.includes("/inventory"),
    ).length;
    const otherRelease = await runReleaseDeployment({
      ...backfillArgs,
      rootDir: otherRoot,
      runCommand: async (...args) => {
        const result = await runCommand(...args);
        return {
          ...result,
          stdout: result.stdout.replaceAll(PRODUCT_VERSION, "0.17.8"),
        };
      },
    });
    assert.equal(otherRelease.issue_relation_backfill, undefined);
    assert.equal(
      requests.filter(({ url }) => url.includes("/inventory")).length,
      inventoryBefore,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("blocked AKB rollout writes a receipt and never invokes kubectl", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-blocked-test-"),
  );
  const receiptPath = path.join(temporaryDirectory, "receipt.json");
  const commands = [];
  const requests = [];
  let manifestChecksum;
  const runCommand = async (command, args) => {
    commands.push({ command, args });
    if (command === "pnpm") return { exitCode: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "status")
      return { exitCode: 0, stdout: "", stderr: "" };
    if (command === "git" && args[0] === "rev-parse")
      return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
    if (command === "docker") {
      const metadataPath = args[args.indexOf("--metadata-file") + 1];
      await writeFile(
        metadataPath,
        JSON.stringify({ "containerimage.digest": IMAGE_DIGEST }),
      );
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected child command: ${command}`);
  };
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/apps")) {
      return new Response(
        JSON.stringify({
          id: APP_ID,
          app_key: "reef",
          display_name: "Reef",
          description: "Reef project management workspace",
          created_at: "2026-09-04T06:00:00.000Z",
          updated_at: "2026-09-04T06:00:00.000Z",
          replayed: false,
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/releases")) {
      const body = JSON.parse(String(init.body));
      manifestChecksum = body.manifest_checksum;
      return new Response(
        JSON.stringify({
          id: RELEASE_ID,
          app_id: APP_ID,
          version: body.version,
          manifest: body.manifest,
          manifest_checksum: body.manifest_checksum,
          registered_at: "2026-09-04T06:00:00.000Z",
          replayed: false,
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/rollouts")) {
      const persisted = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(
        persisted.request_key,
        new Headers(init.headers).get("idempotency-key"),
      );
      return new Response(
        JSON.stringify({
          job_id: "77777777-7777-4777-8777-777777777777",
          app_id: APP_ID,
          release_id: RELEASE_ID,
          manifest_checksum: bodyChecksum(),
          status: "pending",
          targets: [],
          replayed: false,
        }),
        { status: 202 },
      );
    }
    return new Response(
      JSON.stringify({
        job_id: "77777777-7777-4777-8777-777777777777",
        app_id: APP_ID,
        release_id: RELEASE_ID,
        manifest_checksum: bodyChecksum(),
        status: "blocked",
        blocked_reason: "target_failed",
        targets: [],
      }),
      { status: 200 },
    );
  };
  function bodyChecksum() {
    return manifestChecksum;
  }

  try {
    await assert.rejects(
      runReleaseDeployment({
        rootDir: path.resolve("."),
        env: {
          AKB_BACKEND_URL: "https://akb.example.test",
          REEF_CONTROL_PLANE_TOKEN: TOKEN,
        },
        options: {
          mode: "deploy",
          registry: "registry.example",
          receipt: receiptPath,
        },
        runCommand,
        fetchImpl,
        core,
      }),
      (error) => error?.stage === "rollout_blocked",
    );
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.outcome, "rollout_failed");
    assert.equal(receipt.deployment_status, "not_applied");
    assert.equal(receipt.rollout_status, "blocked");
    assert.equal(
      commands.some(({ command }) => command === "kubectl"),
      false,
    );
    const firstReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const firstDockerBuildCount = commands.filter(
      ({ command }) => command === "docker",
    ).length;
    const firstRegistrationRequestCount = requests.filter(
      ({ url }) => url.endsWith("/apps") || url.endsWith("/releases"),
    ).length;

    await assert.rejects(
      runReleaseDeployment({
        rootDir: path.resolve("."),
        env: {
          AKB_BACKEND_URL: "https://akb.example.test",
          REEF_CONTROL_PLANE_TOKEN: TOKEN,
        },
        options: {
          mode: "deploy",
          registry: "registry.example",
          receipt: receiptPath,
        },
        runCommand,
        fetchImpl,
        core,
      }),
      (error) => error?.stage === "rollout_blocked",
    );
    assert.equal(
      commands.filter(({ command }) => command === "docker").length,
      firstDockerBuildCount,
    );
    assert.equal(
      requests.filter(
        ({ url }) => url.endsWith("/apps") || url.endsWith("/releases"),
      ).length,
      firstRegistrationRequestCount,
    );
    assert.equal(
      requests.some(({ url }) => url.includes("/resume")),
      false,
    );
    const rolloutPosts = requests.filter(({ url }) =>
      url.endsWith("/rollouts"),
    );
    assert.equal(
      new Headers(rolloutPosts.at(-1)?.init.headers).get("idempotency-key"),
      firstReceipt.request_key,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

for (const version of [PRODUCT_VERSION, "0.14.1"]) {
  test(`resume applies the correct migration contract for ${version}`, async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "reef-resume-test-"),
    );
    const receiptPath = path.join(temporaryDirectory, "receipt.json");
    const sourceRevision = "a".repeat(40);
    const sourceJobId = "77777777-7777-4777-8777-777777777777";
    const resumedJobId = "88888888-8888-4888-8888-888888888888";
    const originalRequestKey = "66666666-6666-4666-8666-666666666666";
    const resumeRequestKey = "99999999-9999-4999-8999-999999999999";
    const payload = await core.finalizeAppReleaseManifest({
      blueprint: await core.buildReleaseBlueprint(),
      version: version,
      sourceRevision,
      imageDigest: IMAGE_DIGEST,
    });
    const registration = {
      kind: "reef-release-receipt",
      app_id: APP_ID,
      release_id: RELEASE_ID,
      app_key: "reef",
      version: payload.version,
      source_revision: sourceRevision,
      runtime_images: {
        web: {
          image_repository: "registry.example/reef-web",
          image_digest: IMAGE_DIGEST,
          image_reference: `registry.example/reef-web@${IMAGE_DIGEST}`,
        },
        event_processor: {
          image_repository: "registry.example/reef-event-processor",
          image_digest: EVENT_PROCESSOR_IMAGE_DIGEST,
          image_reference: `registry.example/reef-event-processor@${EVENT_PROCESSOR_IMAGE_DIGEST}`,
        },
      },
      manifest_checksum: payload.manifest_checksum,
      app_replayed: false,
      release_replayed: false,
      request_key: originalRequestKey,
      rollout_job_id: sourceJobId,
      rollout_status: "blocked",
      deployment_status: "not_applied",
      outcome: "rollout_failed",
    };
    await writeFile(receiptPath, `${JSON.stringify(registration)}\n`);
    const commands = [];
    let appliedInput = "";
    const runCommand = async (command, args, options) => {
      commands.push({ command, args, options });
      if (command === "pnpm") return { exitCode: 0, stdout: "", stderr: "" };
      if (command === "kubectl" && args[0] === "kustomize") {
        return {
          exitCode: 0,
          stdout: `apiVersion: v1
kind: ConfigMap
metadata:
  name: reef-web-config
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reef-web
spec:
  template:
    metadata: {}
    spec:
      containers:
        - name: reef-web
          image: reef-web:latest
${EVENT_PROCESSOR_MANIFEST}`,
          stderr: "",
        };
      }
      if (command === "kubectl" && args[0] === "apply") {
        appliedInput = options.input;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command === "kubectl" && args[0] === "rollout") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (
        command === "kubectl" &&
        args[0] === "get" &&
        args[1] === "deployment/reef-event-processor"
      ) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            processorDeploymentFixture(
              sourceRevision,
              payload.manifest_checksum,
              EVENT_PROCESSOR_IMAGE_DIGEST,
              version,
            ),
          ),
          stderr: "",
        };
      }
      if (
        command === "kubectl" &&
        args[0] === "get" &&
        args[1] === "deployment/reef-web"
      ) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            metadata: {
              annotations: {
                "kubernetes.io/change-cause": [
                  `Deploy reef v${version}`,
                  `source ${sourceRevision}`,
                  `app ${APP_ID}`,
                  `release ${RELEASE_ID}`,
                  `web-image ${IMAGE_DIGEST}`,
                  `event-processor-image ${EVENT_PROCESSOR_IMAGE_DIGEST}`,
                  `manifest ${payload.manifest_checksum}`,
                ].join("; "),
              },
            },
            spec: {
              template: {
                metadata: {
                  annotations: {
                    "kubernetes.io/change-cause": [
                      `Deploy reef v${version}`,
                      `source ${sourceRevision}`,
                      `app ${APP_ID}`,
                      `release ${RELEASE_ID}`,
                      `web-image ${IMAGE_DIGEST}`,
                      `event-processor-image ${EVENT_PROCESSOR_IMAGE_DIGEST}`,
                      `manifest ${payload.manifest_checksum}`,
                    ].join("; "),
                  },
                },
                spec: {
                  containers: [
                    {
                      name: "reef-web",
                      image: `registry.example/reef-web@${IMAGE_DIGEST}`,
                      env: [
                        { name: "REEF_APP_ID", value: APP_ID },
                        { name: "REEF_RELEASE_ID", value: RELEASE_ID },
                        { name: "REEF_RELEASE_VERSION", value: version },
                        {
                          name: "REEF_RELEASE_SOURCE_REVISION",
                          value: sourceRevision,
                        },
                        {
                          name: "REEF_RELEASE_IMAGE_DIGEST",
                          value: IMAGE_DIGEST,
                        },
                        {
                          name: "REEF_RELEASE_MANIFEST_CHECKSUM",
                          value: payload.manifest_checksum,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          }),
          stderr: "",
        };
      }
      if (
        command === "kubectl" &&
        args[0] === "get" &&
        args[1] === "configmap/reef-web-config"
      ) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: {
              REEF_APP_ID: APP_ID,
              REEF_RELEASE_ID: RELEASE_ID,
              REEF_RELEASE_VERSION: version,
              REEF_RELEASE_SOURCE_REVISION: sourceRevision,
              REEF_RELEASE_IMAGE_DIGEST: IMAGE_DIGEST,
              REEF_RELEASE_MANIFEST_CHECKSUM: payload.manifest_checksum,
            },
          }),
          stderr: "",
        };
      }
      if (command === "kubectl" && args[0] === "get" && args[1] === "pods") {
        if (args.includes("app=reef-event-processor")) {
          return {
            exitCode: 0,
            stdout: JSON.stringify(
              processorPodFixture(
                sourceRevision,
                payload.manifest_checksum,
                EVENT_PROCESSOR_IMAGE_DIGEST,
              ),
            ),
            stderr: "",
          };
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            items: [
              {
                spec: {
                  containers: [
                    {
                      name: "reef-web",
                      image: `registry.example/reef-web@${IMAGE_DIGEST}`,
                    },
                  ],
                },
                status: {
                  containerStatuses: [
                    {
                      name: "reef-web",
                      ready: true,
                      imageID: `registry.example/reef-web@${IMAGE_DIGEST}`,
                    },
                  ],
                },
              },
            ],
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected child command: ${command} ${args.join(" ")}`);
    };
    const fetchImpl = async (input, init = {}) => {
      const url = String(input);
      if (
        url.endsWith(`/rollouts/${sourceJobId}/resume`) &&
        version === "0.17.7"
      ) {
        assert.deepEqual(
          JSON.parse(await readFile(receiptPath, "utf8"))
            .issue_relation_backfill,
          { targets: null },
        );
      }
      if (new URL(url).pathname.endsWith(`/apps/${APP_ID}/inventory`)) {
        assert.equal(
          version,
          "0.17.7",
          "other releases must not run the repair",
        );
        return Response.json({ items: [], next_cursor: null });
      }
      if (url.endsWith(`/rollouts/${sourceJobId}/resume`)) {
        const sentKey = new Headers(init.headers).get("idempotency-key");
        assert.equal(sentKey, resumeRequestKey);
        assert.notEqual(sentKey, originalRequestKey);
        return new Response(
          JSON.stringify({
            job_id: resumedJobId,
            app_id: APP_ID,
            release_id: RELEASE_ID,
            manifest_checksum: payload.manifest_checksum,
            status: "pending",
            targets: [],
            source_rollout_id: sourceJobId,
            resume_outcome: "accepted",
            resume_reason: "new_attempt",
            replayed: false,
          }),
          { status: 202 },
        );
      }
      if (url.endsWith(`/rollouts/${resumedJobId}`)) {
        return new Response(
          JSON.stringify({
            job_id: resumedJobId,
            app_id: APP_ID,
            release_id: RELEASE_ID,
            manifest_checksum: payload.manifest_checksum,
            status: "applied",
            targets: [],
            source_rollout_id: sourceJobId,
          }),
          { status: 200 },
        );
      }
      assert.ok(url.endsWith(`/apps/${APP_ID}/releases/${RELEASE_ID}`));
      return new Response(
        JSON.stringify({
          id: RELEASE_ID,
          app_id: APP_ID,
          version: payload.version,
          manifest: payload.manifest,
          manifest_checksum: payload.manifest_checksum,
          registered_at: "2026-09-04T06:00:00.000Z",
          replayed: true,
        }),
        { status: 200 },
      );
    };

    try {
      const result = await runReleaseDeployment({
        rootDir: path.resolve("."),
        env: {
          AKB_BACKEND_URL: "https://akb.example.test",
          REEF_CONTROL_PLANE_TOKEN: TOKEN,
          REGISTRY: "registry.example",
        },
        options: {
          mode: "resume",
          receipt: receiptPath,
          source_rollout_id: sourceJobId,
          request_key: resumeRequestKey,
        },
        runCommand,
        fetchImpl,
        core,
      });
      assert.equal(result.resume_request_key, resumeRequestKey);
      assert.equal(result.source_rollout_id, sourceJobId);
      assert.equal(result.rollout_job_id, resumedJobId);
      assert.equal(result.outcome, "deployed");
      assert.deepEqual(
        result.issue_relation_backfill,
        version === "0.17.7" ? { targets: [] } : undefined,
      );
      await assert.rejects(
        runReleaseDeployment({
          rootDir: path.resolve("."),
          env: {
            AKB_BACKEND_URL: "https://akb.example.test",
            REEF_CONTROL_PLANE_TOKEN: TOKEN,
            REGISTRY: "registry.example",
          },
          options: { mode: "resume", receipt: receiptPath },
          runCommand,
          fetchImpl,
          core,
        }),
        (error) =>
          error?.stage === "input_validation" &&
          error.message.includes("use deploy"),
      );
      assert.equal(appliedInput.includes(IMAGE_DIGEST), true);
      assert.equal(
        commands.some(({ command }) => command === "docker"),
        false,
      );
      for (const { options } of commands) {
        assert.equal(options.env.REEF_CONTROL_PLANE_TOKEN, undefined);
      }
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
}

test("rollout observation times out without converting pending into success", async () => {
  let clock = 0;
  await assert.rejects(
    observeRollout({
      rollout: { jobId: "77777777-7777-4777-8777-777777777777" },
      appId: APP_ID,
      expectedReleaseId: RELEASE_ID,
      expectedManifestChecksum: "c".repeat(64),
      rolloutAdapter: {
        getRollout: async () => ({
          jobId: "77777777-7777-4777-8777-777777777777",
          releaseId: RELEASE_ID,
          manifestChecksum: "c".repeat(64),
          status: "running",
        }),
      },
      deadlineMs: 1,
      pollMs: 1,
      now: () => {
        clock += 1;
        return clock;
      },
      sleep: async () => undefined,
    }),
    (error) => error?.stage === "rollout_timeout",
  );
});

test("rollout observation rejects a changed release identity before applied", async () => {
  await assert.rejects(
    observeRollout({
      rollout: { jobId: "77777777-7777-4777-8777-777777777777" },
      appId: APP_ID,
      expectedReleaseId: RELEASE_ID,
      expectedManifestChecksum: "c".repeat(64),
      rolloutAdapter: {
        getRollout: async () => ({
          jobId: "77777777-7777-4777-8777-777777777777",
          releaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          manifestChecksum: "c".repeat(64),
          status: "applied",
        }),
      },
      deadlineMs: 1_000,
      pollMs: 1,
      now: () => 0,
      sleep: async () => undefined,
    }),
    (error) => error?.stage === "rollout_observation",
  );
});

test("sequential Kubernetes renders keep each release identity on its own PodTemplate", () => {
  const renderedBase = `apiVersion: v1
kind: ConfigMap
metadata:
  name: reef-web-config
data:
  AKB_BACKEND_URL: https://akb.example.test
  ENVIRONMENT: example
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reef-web
spec:
  template:
    metadata:
      labels:
        app: reef-web
    spec:
      containers:
        - name: reef-web
          image: reef-web:latest
          env:
            - name: STATIC_SETTING
              value: keep
            - name: REEF_RELEASE_ID
              value: stale
${EVENT_PROCESSOR_MANIFEST}
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: reef-web
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
`;
  const registrationA = {
    appId: APP_ID,
    releaseId: RELEASE_ID,
    appKey: "reef",
    version: "0.14.1",
    sourceRevision: "a".repeat(40),
    imageDigest: IMAGE_DIGEST,
    eventProcessorImageDigest: IMAGE_DIGEST,
    manifestChecksum: "d".repeat(64),
  };
  const registrationB = {
    ...registrationA,
    releaseId: "33333333-3333-4333-8333-333333333333",
    version: "0.14.2",
    sourceRevision: "c".repeat(40),
    imageDigest: `sha256:${"e".repeat(64)}`,
    eventProcessorImageDigest: `sha256:${"e".repeat(64)}`,
    manifestChecksum: "f".repeat(64),
  };
  const getResources = (yaml) =>
    parseAllDocuments(yaml, { version: "1.1" })
      .filter((document) => document.toString().trim().length > 0)
      .map((document) => document.toJS());
  const getDeployment = (resources) =>
    resources.find(
      (resource) =>
        resource.kind === "Deployment" && resource.metadata.name === "reef-web",
    );
  const getConfigMap = (resources) =>
    resources.find(
      (resource) =>
        resource.kind === "ConfigMap" &&
        resource.metadata.name === "reef-web-config",
    );
  const getContainerEnv = (deployment) =>
    Object.fromEntries(
      deployment.spec.template.spec.containers
        .find((container) => container.name === "reef-web")
        .env.map(({ name, value }) => [name, value]),
    );

  const renderedA = renderKubernetesManifest(renderedBase, {
    registration: registrationA,
    imageRepository: "registry.example/reef-web",
    eventProcessorImageRepository: "registry.example/reef-event-processor",
  });
  const renderedB = renderKubernetesManifest(renderedBase, {
    registration: registrationB,
    imageRepository: "registry.example/reef-web",
    eventProcessorImageRepository: "registry.example/reef-event-processor",
  });
  const resourcesA = getResources(renderedA);
  const resourcesB = getResources(renderedB);
  const envA = getContainerEnv(getDeployment(resourcesA));
  const envB = getContainerEnv(getDeployment(resourcesB));

  for (const resources of [resourcesA, resourcesB]) {
    const ingress = resources.find((resource) => resource.kind === "Ingress");
    assert.equal(
      ingress.metadata.annotations[
        "nginx.ingress.kubernetes.io/proxy-buffering"
      ],
      "off",
    );
    assert.equal(
      ingress.metadata.annotations[
        "nginx.ingress.kubernetes.io/proxy-read-timeout"
      ],
      "600",
    );
  }

  assert.equal(envA.REEF_RELEASE_ID, registrationA.releaseId);
  assert.equal(envB.REEF_RELEASE_ID, registrationB.releaseId);
  assert.equal(envA.REEF_RELEASE_VERSION, registrationA.version);
  assert.equal(envB.REEF_RELEASE_VERSION, registrationB.version);
  assert.equal(envA.STATIC_SETTING, "keep");
  assert.equal(envB.STATIC_SETTING, "keep");
  assert.equal(getConfigMap(resourcesA).data.REEF_RELEASE_ID, undefined);
  assert.equal(getConfigMap(resourcesB).data.REEF_RELEASE_ID, undefined);
  assert.deepEqual(getConfigMap(resourcesA).data, {
    AKB_BACKEND_URL: "https://akb.example.test",
    ENVIRONMENT: "example",
  });
  assert.deepEqual(getConfigMap(resourcesB).data, {
    AKB_BACKEND_URL: "https://akb.example.test",
    ENVIRONMENT: "example",
  });
  assert.equal(
    getContainerEnv(getDeployment(getResources(renderedA))).REEF_RELEASE_ID,
    registrationA.releaseId,
  );
});

test("Kubernetes readback ignores terminating pods but rejects live identity mismatches", () => {
  const registration = {
    appId: APP_ID,
    releaseId: RELEASE_ID,
    appKey: "reef",
    version: "0.14.1",
    sourceRevision: "a".repeat(40),
    imageDigest: IMAGE_DIGEST,
    eventProcessorImageDigest: IMAGE_DIGEST,
    manifestChecksum: "c".repeat(64),
  };
  const image = `registry.example/reef-web@${IMAGE_DIGEST}`;
  const provenance = [
    "Deploy reef v0.14.1",
    `source ${registration.sourceRevision}`,
    `app ${APP_ID}`,
    `release ${RELEASE_ID}`,
    `web-image ${IMAGE_DIGEST}`,
    `event-processor-image ${IMAGE_DIGEST}`,
    `manifest ${registration.manifestChecksum}`,
  ].join("; ");
  const releaseEnv = [
    { name: "REEF_APP_ID", value: APP_ID },
    { name: "REEF_RELEASE_ID", value: RELEASE_ID },
    { name: "REEF_RELEASE_VERSION", value: "0.14.1" },
    {
      name: "REEF_RELEASE_SOURCE_REVISION",
      value: registration.sourceRevision,
    },
    { name: "REEF_RELEASE_IMAGE_DIGEST", value: IMAGE_DIGEST },
    {
      name: "REEF_RELEASE_MANIFEST_CHECKSUM",
      value: registration.manifestChecksum,
    },
  ];
  const deployment = {
    metadata: { annotations: { "kubernetes.io/change-cause": provenance } },
    spec: {
      template: {
        metadata: { annotations: { "kubernetes.io/change-cause": provenance } },
        spec: { containers: [{ name: "reef-web", image, env: releaseEnv }] },
      },
    },
  };
  const livePod = {
    metadata: { name: "reef-web-current" },
    spec: { containers: [{ name: "reef-web", image }] },
    status: {
      containerStatuses: [
        {
          name: "reef-web",
          ready: true,
          imageID: `containerd://sha256:${"d".repeat(64)}`,
        },
      ],
    },
  };
  const terminatingPod = {
    metadata: {
      name: "reef-web-old",
      deletionTimestamp: "2026-09-14T06:00:00Z",
    },
    spec: {
      containers: [
        { name: "reef-web", image: "registry.example/reef-web@sha256:bad" },
      ],
    },
    status: { containerStatuses: [{ name: "reef-web", ready: false }] },
  };
  const eventProcessorDeployment = processorDeploymentFixture(
    registration.sourceRevision,
    registration.manifestChecksum,
    IMAGE_DIGEST,
    registration.version,
  );
  const eventProcessorPods = processorPodFixture(
    registration.sourceRevision,
    registration.manifestChecksum,
  );

  assert.doesNotThrow(() =>
    assertKubernetesReadback({
      deployment,
      pods: { items: [livePod, terminatingPod] },
      registration,
      imageRepository: "registry.example/reef-web",
      eventProcessorImageRepository: "registry.example/reef-event-processor",
      eventProcessorDeployment,
      eventProcessorPods,
    }),
  );
  assert.throws(
    () =>
      assertKubernetesReadback({
        deployment,
        pods: { items: [livePod] },
        registration,
        imageRepository: "registry.example/reef-web",
        eventProcessorImageRepository: "registry.example/reef-event-processor",
      }),
    (error) => error?.stage === "runtime_identity_mismatch",
  );
  const wrongImagePod = structuredClone(livePod);
  wrongImagePod.spec.containers[0].image =
    "registry.example/reef-web@sha256:bad";
  const notReadyPod = structuredClone(livePod);
  notReadyPod.status.containerStatuses[0].ready = false;
  for (const invalidPod of [wrongImagePod, notReadyPod]) {
    assert.throws(
      () =>
        assertKubernetesReadback({
          deployment,
          pods: { items: [invalidPod] },
          registration,
          imageRepository: "registry.example/reef-web",
          eventProcessorImageRepository:
            "registry.example/reef-event-processor",
          eventProcessorDeployment,
          eventProcessorPods,
        }),
      (error) => error?.stage === "runtime_identity_mismatch",
    );
  }
  const mismatchedProcessorDeployment = structuredClone(
    eventProcessorDeployment,
  );
  mismatchedProcessorDeployment.spec.template.spec.containers[0].image =
    "registry.example/reef-event-processor@sha256:bad";
  assert.throws(
    () =>
      assertKubernetesReadback({
        deployment,
        pods: { items: [livePod] },
        registration,
        imageRepository: "registry.example/reef-web",
        eventProcessorImageRepository: "registry.example/reef-event-processor",
        eventProcessorDeployment: mismatchedProcessorDeployment,
        eventProcessorPods,
      }),
    (error) => error?.stage === "runtime_identity_mismatch",
  );
});

test("Kubernetes readiness failure is non-zero and stops before identity readback", async () => {
  const commands = [];
  const registration = {
    appId: APP_ID,
    releaseId: RELEASE_ID,
    appKey: "reef",
    version: "0.14.1",
    sourceRevision: "a".repeat(40),
    imageDigest: IMAGE_DIGEST,
    eventProcessorImageDigest: IMAGE_DIGEST,
    manifestChecksum: "c".repeat(64),
  };
  const rendered = `apiVersion: v1
kind: ConfigMap
metadata:
  name: reef-web-config
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reef-web
spec:
  template:
    spec:
      containers:
        - name: reef-web
          image: reef-web@sha256:${"0".repeat(64)}
`;
  await assert.rejects(
    applyKubernetesRelease({
      rootDir: path.resolve("."),
      namespace: "reef",
      kustomizeDir: path.resolve("deploy/k8s/overlays/example"),
      registration,
      imageRepository: "registry.example/reef-web",
      eventProcessorImageRepository: "registry.example/reef-event-processor",
      token: TOKEN,
      env: { REEF_CONTROL_PLANE_TOKEN: TOKEN },
      runCommand: async (command, args) => {
        commands.push({ command, args });
        if (args[0] === "kustomize")
          return {
            exitCode: 0,
            stdout: `${rendered}${EVENT_PROCESSOR_MANIFEST}`,
            stderr: "",
          };
        if (args[0] === "apply") return { exitCode: 0, stdout: "", stderr: "" };
        if (args[0] === "rollout")
          return { exitCode: 1, stdout: "", stderr: "not ready" };
        throw new Error("identity readback must not run");
      },
      kubernetesTimeoutMs: 1_000,
    }),
    (error) => error?.stage === "runtime_readiness",
  );
  assert.equal(
    commands.some(({ args }) => args[0] === "get"),
    false,
  );
});

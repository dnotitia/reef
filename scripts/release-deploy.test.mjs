import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as core from "../packages/core/dist/index.js";
import { parseAllDocuments } from "yaml";
import {
  applyKubernetesRelease,
  observeRollout,
  renderKubernetesManifest,
  runReleaseDeployment,
} from "./release-deploy.mjs";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const IMAGE_DIGEST = `sha256:${"b".repeat(64)}`;
const TOKEN = "system-admin-secret";

test("build-only creates a verifiable build artifact without AKB or Kubernetes calls", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-build-test-"),
  );
  const artifactPath = path.join(temporaryDirectory, "build.json");
  const sourceRevision = "a".repeat(40);
  const secondImageDigest = `sha256:${"c".repeat(64)}`;
  const existingRegistryTags = new Set([
    `registry.example/reef-web:v0.14.1`,
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
      image_repository: "registry.example/reef-web",
      image_digest: IMAGE_DIGEST,
      image_reference: `registry.example/reef-web@${IMAGE_DIGEST}`,
      source_revision: sourceRevision,
      version: "0.14.1",
    });
    assert.deepEqual(JSON.parse(await readFile(artifactPath, "utf8")), result);
    assert.equal(
      commands.some(({ command }) => command === "kubectl"),
      false,
    );
    const dockerArgs =
      commands.find(({ command }) => command === "docker")?.args ?? [];
    assert.ok(dockerArgs.includes(`REEF_VERSION=0.14.1`));
    assert.ok(dockerArgs.includes(`REEF_SOURCE_REVISION=${sourceRevision}`));
    const dockerTags = dockerArgs
      .flatMap((argument, index) =>
        argument === "--tag" ? [dockerArgs[index + 1]] : [],
      )
      .filter(Boolean);
    assert.equal(
      dockerTags.some((tag) => tag.endsWith(":v0.14.1")),
      false,
    );
    assert.equal(
      dockerTags.some((tag) => tag.endsWith(`:${sourceRevision}`)),
      false,
    );
    assert.match(
      dockerTags[0],
      new RegExp(
        `^registry\\.example/reef-web:build-0\\.14\\.1-${sourceRevision}-[0-9a-f-]{36}$`,
        "u",
      ),
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
    assert.equal(rebuilt.image_digest, secondImageDigest);
    assert.notEqual(rebuilt.image_digest, result.image_digest);
    assert.deepEqual(JSON.parse(await readFile(artifactPath, "utf8")), rebuilt);
    assert.equal(
      existingRegistryTags.has(`registry.example/reef-web:v0.14.1`),
      true,
    );
    assert.equal(
      existingRegistryTags.has(`registry.example/reef-web:${sourceRevision}`),
      true,
    );
    assert.equal(
      commands.filter(({ command }) => command === "docker").length,
      2,
    );
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
        image_repository: "registry.example/reef-web",
        image_digest: IMAGE_DIGEST,
        image_reference: `registry.example/reef-web@${IMAGE_DIGEST}`,
        source_revision: "a".repeat(40),
        version: "0.14.1",
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

test("register-only rejects a mutable image reference before any child or AKB call", async () => {
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
        image_repository: "registry.example/reef-web",
        image_digest: "reef-web:latest",
        image_reference: "registry.example/reef-web@reef-web:latest",
        source_revision: "a".repeat(40),
        version: "0.14.1",
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
    assert.equal(commands.at(-1)?.command, "git");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("register-only rejects a build artifact from another source revision or product version", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-register-stale-test-"),
  );
  const buildArtifactPath = path.join(temporaryDirectory, "build.json");
  const commands = [];
  try {
    await writeFile(
      buildArtifactPath,
      `${JSON.stringify({
        kind: "reef-build-artifact",
        image_repository: "registry.example/reef-web",
        image_digest: IMAGE_DIGEST,
        image_reference: `registry.example/reef-web@${IMAGE_DIGEST}`,
        source_revision: "b".repeat(40),
        version: "0.14.0",
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
          throw new Error("network must not be reached");
        },
        core,
      }),
      /does not match the current source and version/u,
    );
    assert.equal(
      commands.some(({ command }) => command === "docker"),
      false,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("deploy observes AKB applied before applying the immutable Kubernetes revision", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "reef-deploy-test-"),
  );
  const receiptPath = path.join(temporaryDirectory, "receipt.json");
  const buildArtifactPath = path.join(temporaryDirectory, "build.json");
  const commands = [];
  const requests = [];
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
    targets: [],
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
      return { exitCode: 0, stdout: kustomizeOutput, stderr: "" };
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
                "Deploy reef-web v0.14.1",
                `source ${sourceRevision}`,
                `app ${APP_ID}`,
                `release ${RELEASE_ID}`,
                `image ${IMAGE_DIGEST}`,
                `manifest ${manifestChecksum}`,
              ].join("; "),
            },
          },
          spec: {
            template: {
              metadata: {
                annotations: {
                  "kubernetes.io/change-cause": [
                    "Deploy reef-web v0.14.1",
                    `source ${sourceRevision}`,
                    `app ${APP_ID}`,
                    `release ${RELEASE_ID}`,
                    `image ${IMAGE_DIGEST}`,
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
                      { name: "REEF_RELEASE_VERSION", value: "0.14.1" },
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
      args[1] === "configmap/reef-web-config"
    ) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            REEF_APP_ID: APP_ID,
            REEF_RELEASE_ID: RELEASE_ID,
            REEF_RELEASE_VERSION: "0.14.1",
            REEF_RELEASE_SOURCE_REVISION: sourceRevision,
            REEF_RELEASE_IMAGE_DIGEST: IMAGE_DIGEST,
            REEF_RELEASE_MANIFEST_CHECKSUM: manifestChecksum,
          },
        }),
        stderr: "",
      };
    }
    if (command === "kubectl" && args[0] === "get" && args[1] === "pods") {
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
                      { name: "REEF_RELEASE_VERSION", value: "0.14.1" },
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
      return new Response(JSON.stringify(rolloutBody("pending")), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }
    assert.ok(url.endsWith(`/rollouts/${jobId}`));
    return new Response(JSON.stringify(rolloutBody("applied")), {
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

    assert.equal(result.outcome, "deployed");
    assert.equal(result.rollout_status, "applied");
    assert.equal(result.deployment_status, "ready");
    assert.equal(appliedInput.includes(TOKEN), false);
    assert.equal(appliedInput.includes(IMAGE_DIGEST), true);
    assert.match(appliedInput, /REEF_RELEASE_ID/u);
    assert.deepEqual(JSON.parse(await readFile(buildArtifactPath, "utf8")), {
      kind: "reef-build-artifact",
      image_repository: "registry.example/reef-web",
      image_digest: IMAGE_DIGEST,
      image_reference: `registry.example/reef-web@${IMAGE_DIGEST}`,
      source_revision: sourceRevision,
      version: "0.14.1",
    });
    assert.deepEqual(JSON.parse(await readFile(receiptPath, "utf8")), result);
    assert.equal(
      requests.filter(({ url }) => url.includes("/rollouts")).length,
      2,
    );
    assert.equal(
      commands.filter(
        ({ command, args }) => command === "kubectl" && args[0] === "rollout",
      ).length,
      1,
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
    assert.equal(replayed.request_key, requestKey);
    const rolloutRequests = requests.filter(({ url }) =>
      url.endsWith("/rollouts"),
    );
    assert.equal(
      new Headers(rolloutRequests.at(-1)?.init.headers).get("idempotency-key"),
      requestKey,
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
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("resume uses a new key for the blocked source and then deploys the resumed release", async () => {
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
    version: "0.14.1",
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
    image_digest: IMAGE_DIGEST,
    image_repository: "registry.example/reef-web",
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
`,
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
      args[1] === "deployment/reef-web"
    ) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          metadata: {
            annotations: {
              "kubernetes.io/change-cause": [
                "Deploy reef-web v0.14.1",
                `source ${sourceRevision}`,
                `app ${APP_ID}`,
                `release ${RELEASE_ID}`,
                `image ${IMAGE_DIGEST}`,
                `manifest ${payload.manifest_checksum}`,
              ].join("; "),
            },
          },
          spec: {
            template: {
              metadata: {
                annotations: {
                  "kubernetes.io/change-cause": [
                    "Deploy reef-web v0.14.1",
                    `source ${sourceRevision}`,
                    `app ${APP_ID}`,
                    `release ${RELEASE_ID}`,
                    `image ${IMAGE_DIGEST}`,
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
                      { name: "REEF_RELEASE_VERSION", value: "0.14.1" },
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
            REEF_RELEASE_VERSION: "0.14.1",
            REEF_RELEASE_SOURCE_REVISION: sourceRevision,
            REEF_RELEASE_IMAGE_DIGEST: IMAGE_DIGEST,
            REEF_RELEASE_MANIFEST_CHECKSUM: payload.manifest_checksum,
          },
        }),
        stderr: "",
      };
    }
    if (command === "kubectl" && args[0] === "get" && args[1] === "pods") {
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
    if (url.endsWith(`/rollouts/${sourceJobId}/resume`)) {
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
`;
  const registrationA = {
    appId: APP_ID,
    releaseId: RELEASE_ID,
    appKey: "reef",
    version: "0.14.1",
    sourceRevision: "a".repeat(40),
    imageDigest: IMAGE_DIGEST,
    manifestChecksum: "d".repeat(64),
  };
  const registrationB = {
    ...registrationA,
    releaseId: "33333333-3333-4333-8333-333333333333",
    version: "0.14.2",
    sourceRevision: "c".repeat(40),
    imageDigest: `sha256:${"e".repeat(64)}`,
    manifestChecksum: "f".repeat(64),
  };
  const getResources = (yaml) =>
    parseAllDocuments(yaml)
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
  });
  const renderedB = renderKubernetesManifest(renderedBase, {
    registration: registrationB,
    imageRepository: "registry.example/reef-web",
  });
  const resourcesA = getResources(renderedA);
  const resourcesB = getResources(renderedB);
  const envA = getContainerEnv(getDeployment(resourcesA));
  const envB = getContainerEnv(getDeployment(resourcesB));

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

test("Kubernetes readiness failure is non-zero and stops before identity readback", async () => {
  const commands = [];
  const registration = {
    appId: APP_ID,
    releaseId: RELEASE_ID,
    appKey: "reef",
    version: "0.14.1",
    sourceRevision: "a".repeat(40),
    imageDigest: IMAGE_DIGEST,
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
      token: TOKEN,
      env: { REEF_CONTROL_PLANE_TOKEN: TOKEN },
      runCommand: async (command, args) => {
        commands.push({ command, args });
        if (args[0] === "kustomize")
          return { exitCode: 0, stdout: rendered, stderr: "" };
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

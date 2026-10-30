import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as core from "../packages/core/dist/index.js";
import {
  prepareRelationBackfill,
  finishRelationBackfill,
} from "./release-relations.mjs";

function target(index) {
  return {
    installation_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    vault_id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    vault: `reef-${index}`,
    status: "pending",
    count: null,
  };
}
function entry(vault, id = "REEF-001") {
  return {
    reef_id: id,
    document_uri: `akb://${vault}/coll/issues/doc/${id.toLowerCase()}.md`,
    document_commit: `commit-${id}`,
    depends_on: [],
    related_to: [],
  };
}
async function harness(count = 2) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reef-repair-")),
    receiptPath = path.join(directory, "receipt.json"),
    targets = Array.from({ length: count }, (_, i) => target(i + 1)),
    events = [],
    applyInputs = [];
  const receipt = {
    app_id: "11111111-1111-4111-8111-111111111111",
    issue_relation_backfill: { targets },
  };
  const testCore = {
    ...core,
    akbListAdminActiveInstallations: async () =>
      targets.map((t) => ({
        installationId: t.installation_id,
        vaultId: t.vault_id,
        vaultName: t.vault,
        lifecycle: "active",
      })),
    akbPreflightIssueRelationUris: async ({ vault }) => {
      events.push(`preflight:${vault}`);
      return { count: 1 };
    },
    akbInstallReefVaultSkill: async ({ vault }) => {
      events.push(`instructions:${vault}`);
    },
    akbApplyIssueRelationUris: async (params) => {
      events.push(`write:${params.vault}`);
      applyInputs.push({
        vault: params.vault,
        checkpoints: params.checkpoints,
      });
      await params.onCheckpoint(entry(params.vault));
      return { count: 1, checkpoints: [entry(params.vault)] };
    },
    akbVerifyIssueRelationUris: async ({ vault }) => {
      events.push(`verify:${vault}`);
      return { count: 1 };
    },
  };
  const context = {
    core: testCore,
    env: {
      AKB_BACKEND_URL: "https://akb.example",
      REEF_CONTROL_PLANE_TOKEN: "private-control-token",
    },
    fetchImpl: async () => {
      throw Error("Unexpected I/O");
    },
    receipt,
    receiptPath,
    onProgress: () => {},
  };
  return {
    context,
    directory,
    targets,
    events,
    applyInputs,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
test("preflight collects every vault failure in a private receipt", async () => {
  const h = await harness(3);
  try {
    h.context.core.akbPreflightIssueRelationUris = async ({ vault }) => {
      h.events.push(vault);
      throw new core.IssueRelationBackfillError({
        vault,
        phase: "preflight",
        code: "invalid_relations",
        problems: [
          {
            reef_id: "REEF-001",
            field: "depends_on",
            reason: "missing_target",
            target_index: 0,
          },
        ],
      });
    };
    await assert.rejects(
      prepareRelationBackfill(h.context),
      /preflight failed/,
    );
    const persisted = JSON.parse(await readFile(h.context.receiptPath, "utf8"));
    assert.equal(h.events.length, 3);
    assert(
      persisted.issue_relation_backfill.targets.every(
        (t) => t.status === "failed" && t.failure.code === "invalid_relations",
      ),
    );
    assert.equal((await stat(h.context.receiptPath)).mode & 0o777, 0o600);
  } finally {
    await h.cleanup();
  }
});
test("all writes finish before graph polling and a failed vault does not lose successful vaults", async () => {
  const h = await harness(3);
  let fail = true;
  try {
    h.context.core.akbVerifyIssueRelationUris = async ({ vault }) => {
      h.events.push(`verify:${vault}`);
      if (vault === "reef-1" && fail)
        throw new core.IssueRelationBackfillError({
          vault,
          phase: "verify",
          code: "projection_pending",
          problems: [
            {
              reef_id: "REEF-001",
              reason: "projection_pending",
              field: "depends_on",
              missing_count: 1,
            },
          ],
        });
      return { count: 1 };
    };
    await prepareRelationBackfill(h.context);
    await assert.rejects(finishRelationBackfill(h.context), /incomplete/);
    assert(
      h.events.findIndex((e) => e.startsWith("verify:")) >
        h.events.findLastIndex((e) => e.startsWith("write:")),
    );
    const persisted = JSON.parse(await readFile(h.context.receiptPath, "utf8"));
    assert.deepEqual(
      persisted.issue_relation_backfill.targets.map((t) => t.status),
      ["failed", "verified", "verified"],
    );
    const vaultDirectory = `${h.context.receiptPath}.relations/${h.targets[0].vault_id}`,
      files = await readdir(vaultDirectory);
    assert.equal(files.length, 1);
    assert.equal(
      (await stat(path.join(vaultDirectory, files[0]))).mode & 0o777,
      0o600,
    );
    fail = false;
    h.events.length = 0;
    await finishRelationBackfill(h.context);
    assert.deepEqual(h.events, [
      "instructions:reef-1",
      "write:reef-1",
      "verify:reef-1",
    ]);
    assert.deepEqual(h.applyInputs.at(-1).checkpoints, [entry("reef-1")]);
    assert(h.targets.every((t) => t.status === "verified"));
  } finally {
    await h.cleanup();
  }
});
test("missing acknowledged checkpoints stop before another document write", async () => {
  const h = await harness(1);
  try {
    h.context.core.akbVerifyIssueRelationUris = async () => {
      throw new Error("private upstream response must not be recorded");
    };
    await assert.rejects(finishRelationBackfill(h.context));
    await rm(`${h.context.receiptPath}.relations`, { recursive: true });
    h.events.length = 0;
    await assert.rejects(prepareRelationBackfill(h.context), /preflight/);
    const persisted = JSON.parse(await readFile(h.context.receiptPath, "utf8"));
    assert.equal(
      persisted.issue_relation_backfill.targets[0].failure.code,
      "checkpoint_error",
    );
    assert.deepEqual(h.events, []);
    assert(!JSON.stringify(persisted).includes("private upstream"));
    assert(!JSON.stringify(persisted).includes("private-control-token"));
  } finally {
    await h.cleanup();
  }
});
test("checkpoint storage failure stops queued vaults and keeps its failure report", {
  timeout: 5000,
}, async () => {
  const h = await harness(4);
  let signalFailure, releaseSibling;
  const failed = new Promise((resolve) => {
    signalFailure = resolve;
  });
  const held = new Promise((resolve) => {
    releaseSibling = resolve;
  });
  try {
    const journal = `${h.context.receiptPath}.relations`;
    h.context.core.akbApplyIssueRelationUris = async ({
      vault,
      onCheckpoint,
    }) => {
      h.events.push(`write:${vault}`);
      if (vault === "reef-1") {
        await mkdir(journal);
        await writeFile(
          path.join(journal, h.targets[0].vault_id),
          "unavailable",
        );
      } else await held;
      try {
        await onCheckpoint(entry(vault));
      } catch (error) {
        signalFailure();
        throw error;
      }
      return { count: 1 };
    };
    const outcome = finishRelationBackfill(h.context).catch((error) => error);
    await failed;
    await new Promise(setImmediate);
    releaseSibling();
    assert.equal((await outcome).code, "checkpoint_error");
    assert.deepEqual(
      h.events.filter((event) => event.startsWith("write:")),
      ["write:reef-1", "write:reef-2"],
    );
    assert.equal(h.targets[0].failure.code, "checkpoint_error");
  } finally {
    releaseSibling();
    await h.cleanup();
  }
});
test("parallel vault work stays within two active requests", async () => {
  const h = await harness(4);
  let active = 0,
    peak = 0;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  try {
    h.context.core.akbApplyIssueRelationUris = async ({
      vault,
      onCheckpoint,
    }) => {
      active++;
      peak = Math.max(peak, active);
      if (peak === 2) release();
      await held;
      await onCheckpoint(entry(vault));
      active--;
      return { count: 1 };
    };
    await finishRelationBackfill(h.context);
    assert.equal(peak, 2);
    assert(h.targets.every((t) => t.status === "verified"));
  } finally {
    await h.cleanup();
  }
});
test("an issue created after preflight refreshes the guarded write snapshot and count", async () => {
  const h = await harness(1);
  let reads = 0,
    writes = 0;
  try {
    h.context.core.akbApplyIssueRelationUris = async (params) => {
      writes++;
      h.applyInputs.push(params.checkpoints);
      await params.onCheckpoint(entry(params.vault));
      if (writes > 1)
        await params.onCheckpoint(entry(params.vault, "REEF-002"));
      return { count: writes };
    };
    h.context.core.akbVerifyIssueRelationUris = async () => {
      if (reads++ === 0)
        throw new core.ConflictError({ path: "issue relation backfill" });
      return { count: 2 };
    };
    await prepareRelationBackfill(h.context);
    await finishRelationBackfill(h.context);
    assert.equal(h.targets[0].count, 2);
    assert.equal(h.targets[0].checkpoint_count, 2);
    assert.deepEqual(h.applyInputs[1], [entry("reef-1")]);
  } finally {
    await h.cleanup();
  }
});
test("invalid verification budgets fail before instructions or data writes", async () => {
  const h = await harness(1);
  try {
    h.context.env.REEF_RELATION_VERIFY_TIMEOUT_MS = "invalid";
    await assert.rejects(finishRelationBackfill(h.context));
    assert.deepEqual(h.events, []);
  } finally {
    await h.cleanup();
  }
});
test("recovery continues after a transient read without retrying a semantic failure", async () => {
  const h = await harness(2);
  let attempts = 0;
  try {
    h.context.core.akbPreflightIssueRelationUris = async ({ vault }) => {
      if (vault === "reef-1" && attempts++ === 0)
        throw new core.AkbApiError({
          status: 503,
          message: "private response",
        });
      if (vault === "reef-2")
        throw new core.IssueRelationBackfillError({
          vault,
          phase: "preflight",
          code: "invalid_relations",
          problems: [],
        });
      return { count: 1 };
    };
    await assert.rejects(prepareRelationBackfill(h.context));
    assert.equal(attempts, 2);
    assert.equal(h.targets[0].status, "pending");
    assert.equal(h.targets[1].failure.code, "invalid_relations");
  } finally {
    await h.cleanup();
  }
});

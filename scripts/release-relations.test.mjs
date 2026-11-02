import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as core from "../packages/core/dist/index.js";
import { runOperatorMigrations } from "./release-migrations.mjs";

const ID = "issue-relation-uris";
const entry = (vault, id = "REEF-001") => ({
  reef_id: id,
  document_uri: `akb://${vault}/coll/issues/doc/${id.toLowerCase()}.md`,
  document_commit: `commit-${id}`,
  depends_on: [],
  related_to: [],
});
async function harness(count = 2) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reef-migrations-"));
  const targets = Array.from({ length: count }, (_, index) => ({
    installation_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    vault_id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    vault: `reef-${index + 1}`,
  }));
  const events = [],
    applyInputs = [],
    required = new Set(targets.map((target) => target.vault));
  const context = {
    env: {
      AKB_BACKEND_URL: "https://akb.example",
      REEF_CONTROL_PLANE_TOKEN: "private-control-token",
    },
    receipt: {
      app_id: "11111111-1111-4111-8111-111111111111",
      release_id: "22222222-2222-4222-8222-222222222222",
      source_revision: "a".repeat(40),
    },
    rollout: {
      jobId: "33333333-3333-4333-8333-333333333333",
      status: "applied",
      targets: targets.map((target) => ({
        installationId: target.installation_id,
        vaultId: target.vault_id,
      })),
    },
    statePath: path.join(directory, "migrations.json"),
    migrationId: ID,
    execute: true,
    onProgress: () => {},
    fetchImpl: async () => {
      throw new Error("Unexpected I/O");
    },
    core: {
      ...core,
      akbListAdminActiveInstallations: async () =>
        targets.map((t) => ({
          installationId: t.installation_id,
          vaultId: t.vault_id,
          vaultName: t.vault,
          lifecycle: "active",
        })),
      akbInspectIssueRelationUris: async ({ vault }) => {
        events.push(`inspect:${vault}`);
        return {
          count: 1,
          pending_count: required.has(vault) ? 1 : 0,
          checkpoints: required.has(vault) ? [] : [entry(vault)],
        };
      },
      akbGetVaultSkillStatus: async () => ({ up_to_date: true }),
      akbHasReefVaultSkillDocuments: async () => true,
      akbInstallReefVaultSkill: async ({ vault }) => {
        events.push(`instructions:${vault}`);
      },
      akbApplyIssueRelationUris: async (params) => {
        events.push(`write:${params.vault}`);
        applyInputs.push(params);
        const state = JSON.parse(await readFile(context.statePath, "utf8"));
        assert.equal(
          state.migrations[0].attempts.at(-1).status,
          "running",
          "intent must be durable before writes",
        );
        await params.onCheckpoint(entry(params.vault));
        return { count: 1, checkpoints: [entry(params.vault)] };
      },
      akbVerifyIssueRelationUris: async ({ vault }) => {
        events.push(`verify:${vault}`);
        required.delete(vault);
        return { count: 1 };
      },
    },
  };
  return {
    context,
    directory,
    targets,
    events,
    required,
    applyInputs,
    read: async () => JSON.parse(await readFile(context.statePath, "utf8")),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("status assesses actual need without creating state or mutating data", async () => {
  const h = await harness();
  try {
    h.required.delete("reef-2");
    const result = await runOperatorMigrations({
      ...h.context,
      execute: false,
    });
    assert.deepEqual(
      result.migrations[0].targets.map((target) => target.status),
      ["required", "not_required"],
    );
    assert.deepEqual(result.migrations[0].attempts, []);
    assert.equal(result.ready, false);
    assert.equal(result.schema.status, "applied");
    await assert.rejects(readFile(h.context.statePath), { code: "ENOENT" });
    assert(h.events.every((event) => event.startsWith("inspect:")));
  } finally {
    await h.cleanup();
  }
});

test("all preflight failures are recorded before any migration writes", async () => {
  const h = await harness(3);
  try {
    h.context.core.akbInspectIssueRelationUris = async ({ vault }) => {
      h.events.push(`inspect:${vault}`);
      throw new core.IssueRelationBackfillError({
        vault,
        phase: "preflight",
        code: "invalid_relations",
        problems: [
          {
            reef_id: "REEF-001",
            field: "depends_on",
            target_index: 0,
            reason: "missing_target",
          },
        ],
      });
    };
    await assert.rejects(runOperatorMigrations(h.context), /assessment failed/);
    const state = await h.read();
    const attempt = state.migrations[0].attempts[0];
    assert.equal(attempt.status, "failed");
    assert(
      attempt.targets.every(
        (target) => target.failure.code === "invalid_relations",
      ),
    );
    assert.equal(h.events.length, 3);
    assert.equal((await stat(h.context.statePath)).mode & 0o777, 0o600);
    assert(!JSON.stringify(state).includes("private-control-token"));
  } finally {
    await h.cleanup();
  }
});

test("failed work resumes across release receipts and preserves completed history", async () => {
  const h = await harness(3);
  let fail = true;
  try {
    const verify = h.context.core.akbVerifyIssueRelationUris;
    h.context.core.akbVerifyIssueRelationUris = async (params) => {
      if (params.vault === "reef-1" && fail)
        throw new Error("private upstream response");
      return verify(params);
    };
    await assert.rejects(runOperatorMigrations(h.context), /incomplete/);
    const before = await h.read();
    assert.deepEqual(
      before.migrations[0].attempts[0].targets.map((target) => target.status),
      ["failed", "completed", "completed"],
    );
    assert(
      h.events.indexOf("verify:reef-2") > h.events.lastIndexOf("write:reef-3"),
    );
    fail = false;
    h.events.length = 0;
    h.context.receipt = {
      ...h.context.receipt,
      release_id: "44444444-4444-4444-8444-444444444444",
      source_revision: "b".repeat(40),
    };
    await runOperatorMigrations(h.context);
    const state = await h.read(),
      attempts = state.migrations[0].attempts;
    assert.equal(attempts.length, 2);
    assert.deepEqual(
      attempts.map((attempt) => attempt.status),
      ["failed", "completed"],
    );
    assert.equal(
      attempts[0].release_id,
      "22222222-2222-4222-8222-222222222222",
    );
    assert.equal(attempts[1].release_id, h.context.receipt.release_id);
    assert.deepEqual(
      h.events.filter((event) => event.startsWith("write:")),
      ["write:reef-1"],
    );
    assert.deepEqual(h.applyInputs.at(-1).checkpoints, [entry("reef-1")]);
    assert(!JSON.stringify(state).includes("private upstream"));
    const status = await runOperatorMigrations({
      ...h.context,
      execute: false,
    });
    assert(
      status.migrations[0].targets.every(
        (target) => target.status === "completed",
      ),
    );
    assert.deepEqual(status.migrations[0].attempts, attempts);
    assert.equal(status.ready, true);
  } finally {
    await h.cleanup();
  }
});

test("completed history does not hide drift and an interrupted attempt resumes checkpoints", async () => {
  const h = await harness(1);
  try {
    await runOperatorMigrations(h.context);
    h.required.add("reef-1");
    const status = await runOperatorMigrations({
      ...h.context,
      execute: false,
    });
    assert.equal(status.migrations[0].targets[0].status, "required");
    const state = await h.read();
    state.migrations[0].attempts.push({
      ...state.migrations[0].attempts[0],
      attempt_id: "44444444-4444-4444-8444-444444444444",
      status: "running",
      finished_at: null,
      targets: [{ ...h.targets[0], status: "running", count: 1 }],
    });
    await writeFile(h.context.statePath, JSON.stringify(state));
    await runOperatorMigrations(h.context);
    const attempts = (await h.read()).migrations[0].attempts;
    assert.deepEqual(
      attempts.map((attempt) => attempt.status),
      ["completed", "interrupted", "completed"],
    );
    assert.deepEqual(h.applyInputs.at(-1).checkpoints, [entry("reef-1")]);
  } finally {
    await h.cleanup();
  }
});

test("missing acknowledged checkpoints block all further document writes", async () => {
  const h = await harness(1);
  try {
    h.context.core.akbVerifyIssueRelationUris = async () => {
      throw new Error("private upstream");
    };
    await assert.rejects(runOperatorMigrations(h.context));
    await rm(`${h.context.statePath}.checkpoints`, { recursive: true });
    h.events.length = 0;
    await assert.rejects(runOperatorMigrations(h.context), /assessment failed/);
    const attempt = (await h.read()).migrations[0].attempts.at(-1);
    assert.equal(attempt.targets[0].failure.code, "checkpoint_error");
    assert.deepEqual(h.events, []);
  } finally {
    await h.cleanup();
  }
});

test("foreign and malformed state fail closed before AKB inventory or writes", async () => {
  const h = await harness();
  try {
    await runOperatorMigrations(h.context);
    const original = await h.read();
    for (const state of [
      { ...original, app_id: "44444444-4444-4444-8444-444444444444" },
      { ...original, backend_url: "https://other.example" },
      {
        ...original,
        migrations: [original.migrations[0], original.migrations[0]],
      },
    ]) {
      await writeFile(h.context.statePath, JSON.stringify(state));
      h.events.length = 0;
      await assert.rejects(
        runOperatorMigrations(h.context),
        (error) => error.code === "state_invalid",
      );
      assert.deepEqual(h.events, []);
    }
  } finally {
    await h.cleanup();
  }
});

test("concurrent operators cannot write the same migration state", async () => {
  const h = await harness(1);
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const apply = h.context.core.akbApplyIssueRelationUris;
    h.context.core.akbApplyIssueRelationUris = async (params) => {
      entered();
      await held;
      return apply(params);
    };
    const first = runOperatorMigrations(h.context);
    await started;
    await assert.rejects(
      runOperatorMigrations(h.context),
      (error) => error.code === "state_locked",
    );
    release();
    await first;
    assert.equal((await h.read()).migrations[0].attempts.length, 1);
  } finally {
    release();
    await h.cleanup();
  }
});

test("writes remain bounded to two vaults and finish before graph polling", async () => {
  const h = await harness(4);
  let active = 0,
    peak = 0,
    release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const apply = h.context.core.akbApplyIssueRelationUris;
    h.context.core.akbApplyIssueRelationUris = async (params) => {
      active++;
      peak = Math.max(peak, active);
      if (peak === 2) release();
      await held;
      const result = await apply(params);
      active--;
      return result;
    };
    await runOperatorMigrations(h.context);
    assert.equal(peak, 2);
    assert(
      h.events.indexOf("verify:reef-1") > h.events.lastIndexOf("write:reef-4"),
    );
  } finally {
    release();
    await h.cleanup();
  }
});

test("invalid verification budgets stop before inspection or writes", async () => {
  const h = await harness();
  try {
    h.context.env.REEF_RELATION_VERIFY_TIMEOUT_MS = "invalid";
    await assert.rejects(runOperatorMigrations(h.context));
    assert.deepEqual(h.events, []);
  } finally {
    await h.cleanup();
  }
});

test("transient assessment is retried while semantic failures remain recorded", async () => {
  const h = await harness(2);
  let tries = 0;
  try {
    const inspect = h.context.core.akbInspectIssueRelationUris;
    h.context.core.akbInspectIssueRelationUris = async (params) => {
      if (params.vault === "reef-1" && tries++ === 0)
        throw new core.AkbApiError({
          status: 503,
          message: "private response",
        });
      if (params.vault === "reef-2")
        throw new core.IssueRelationBackfillError({
          vault: params.vault,
          phase: "preflight",
          code: "invalid_relations",
          problems: [],
        });
      return inspect(params);
    };
    await assert.rejects(runOperatorMigrations(h.context));
    assert.equal(tries, 2);
    assert.equal(
      (await h.read()).migrations[0].attempts[0].targets[1].failure.code,
      "invalid_relations",
    );
    assert(h.events.every((event) => !event.startsWith("write:")));
  } finally {
    await h.cleanup();
  }
});

test("checkpoint storage failure stops queued vaults", async () => {
  const h = await harness(4);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  try {
    h.context.core.akbApplyIssueRelationUris = async ({
      vault,
      onCheckpoint,
    }) => {
      h.events.push(`write:${vault}`);
      if (vault === "reef-1") {
        await mkdir(`${h.context.statePath}.checkpoints/${ID}`, {
          recursive: true,
        });
        await writeFile(
          `${h.context.statePath}.checkpoints/${ID}/${h.targets[0].installation_id}`,
          "unavailable",
        );
      } else await held;
      try {
        await onCheckpoint(entry(vault));
      } finally {
        release();
      }
      return { count: 1 };
    };
    await assert.rejects(
      runOperatorMigrations(h.context),
      (error) => error.code === "checkpoint_error",
    );
    assert.deepEqual(
      h.events.filter((event) => event.startsWith("write:")),
      ["write:reef-1", "write:reef-2"],
    );
    assert.equal(
      (await h.read()).migrations[0].attempts[0].failure_code,
      "checkpoint_error",
    );
  } finally {
    release();
    await h.cleanup();
  }
});

test("a new installation in the same vault gets its own progress and completion history", async () => {
  const h = await harness(1);
  try {
    await runOperatorMigrations(h.context);
    h.targets[0].installation_id = "99999999-9999-4999-8999-999999999999";
    h.context.rollout.targets[0].installationId = h.targets[0].installation_id;
    h.required.add("reef-1");
    await runOperatorMigrations(h.context);
    assert.deepEqual(h.applyInputs.at(-1).checkpoints, []);
    const record = (await h.read()).migrations[0];
    assert.equal(record.checkpoints.length, 2);
    assert.notEqual(
      record.attempts[0].targets[0].installation_id,
      record.attempts[1].targets[0].installation_id,
    );
  } finally {
    await h.cleanup();
  }
});

test("inventory changes cannot record a completed migration attempt", async () => {
  const h = await harness(1);
  try {
    const verify = h.context.core.akbVerifyIssueRelationUris;
    h.context.core.akbVerifyIssueRelationUris = async (params) => {
      const result = await verify(params);
      h.context.rollout.targets = [];
      return result;
    };
    await assert.rejects(
      runOperatorMigrations(h.context),
      (error) => error.code === "inventory_changed",
    );
    assert.equal((await h.read()).migrations[0].attempts[0].status, "failed");
    assert.equal(
      (await h.read()).migrations[0].attempts[0].failure_code,
      "inventory_changed",
    );
  } finally {
    await h.cleanup();
  }
});

test("a new issue during verification refreshes the checkpoint snapshot and final count", async () => {
  const h = await harness(1);
  let reads = 0,
    writes = 0;
  try {
    const apply = h.context.core.akbApplyIssueRelationUris;
    h.context.core.akbApplyIssueRelationUris = async (params) => {
      writes++;
      await apply(params);
      if (writes > 1)
        await params.onCheckpoint(entry(params.vault, "REEF-002"));
      return { count: writes };
    };
    h.context.core.akbVerifyIssueRelationUris = async () => {
      if (reads++ === 0)
        throw new core.ConflictError({ path: "issue relation backfill" });
      h.required.clear();
      return { count: 2 };
    };
    await runOperatorMigrations(h.context);
    const record = (await h.read()).migrations[0];
    assert.equal(record.attempts[0].targets[0].count, 2);
    assert.equal(record.checkpoints[0].checkpoint_count, 2);
    assert.deepEqual(h.applyInputs.at(-1).checkpoints, [entry("reef-1")]);
  } finally {
    await h.cleanup();
  }
});

test("an empty inventory reports no target completion, while instructions alone can require repair", async () => {
  const h = await harness(0);
  try {
    const status = await runOperatorMigrations({
      ...h.context,
      execute: false,
    });
    assert.deepEqual(status.migrations[0].targets, []);
    assert.deepEqual(status.migrations[0].attempts, []);
  } finally {
    await h.cleanup();
  }
  const instructions = await harness(1);
  try {
    instructions.required.clear();
    instructions.context.core.akbGetVaultSkillStatus = async () => ({
      up_to_date: false,
    });
    const status = await runOperatorMigrations({
      ...instructions.context,
      execute: false,
    });
    assert.equal(status.migrations[0].targets[0].status, "required");
    await runOperatorMigrations(instructions.context);
    assert(instructions.events.includes("instructions:reef-1"));
    assert.deepEqual(instructions.applyInputs[0].checkpoints, [
      entry("reef-1"),
    ]);
  } finally {
    await instructions.cleanup();
  }
});

test("a lost state file with existing checkpoints is never reset as a fresh migration", async () => {
  const h = await harness(1);
  try {
    await runOperatorMigrations(h.context);
    await rm(h.context.statePath);
    h.events.length = 0;
    await assert.rejects(
      runOperatorMigrations(h.context),
      (error) => error.code === "state_invalid",
    );
    assert.deepEqual(h.events, []);
  } finally {
    await h.cleanup();
  }
});

test("a retry after all writes landed records completion even when the last process stopped before verification", async () => {
  const h = await harness(1);
  try {
    await runOperatorMigrations(h.context);
    const state = await h.read();
    const previous = state.migrations[0].attempts[0];
    previous.status = "running";
    previous.finished_at = null;
    previous.targets[0].status = "running";
    await writeFile(h.context.statePath, JSON.stringify(state));
    h.events.length = 0;
    await runOperatorMigrations(h.context);
    const completed = (await h.read()).migrations[0].attempts;
    assert.deepEqual(
      completed.map((attempt) => attempt.status),
      ["interrupted", "completed"],
    );
    assert.equal(completed[1].targets[0].status, "completed");
    assert(h.events.every((event) => event.startsWith("inspect:")));
  } finally {
    await h.cleanup();
  }
});

test("unacknowledged extra files cannot hide a missing acknowledged document checkpoint", async () => {
  const h = await harness(1);
  try {
    await runOperatorMigrations(h.context);
    const directory = `${h.context.statePath}.checkpoints/${ID}/${h.targets[0].installation_id}`;
    const filename = (id) =>
      `${createHash("sha256").update(id).digest("hex")}.json`;
    await rm(path.join(directory, filename("REEF-001")));
    await writeFile(
      path.join(directory, filename("REEF-002")),
      JSON.stringify(entry("reef-1", "REEF-002")),
    );
    h.events.length = 0;
    await assert.rejects(runOperatorMigrations(h.context), /assessment failed/);
    assert.equal(
      (await h.read()).migrations[0].attempts.at(-1).targets[0].failure.code,
      "checkpoint_error",
    );
    assert.deepEqual(h.events, []);
  } finally {
    await h.cleanup();
  }
});

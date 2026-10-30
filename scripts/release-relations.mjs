import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writePrivateJson } from "./release-receipt.mjs";

export class RelationRepairError extends Error {
  constructor(message, code = "unexpected_error") {
    super(message);
    this.name = "RelationRepairError";
    this.stage = "data_backfill";
    this.code = code;
  }
}
const checkpointName = (id) =>
  `${createHash("sha256").update(id).digest("hex")}.json`;
const journalDir = (core, receiptPath, target) =>
  path.join(
    `${path.resolve(receiptPath)}.relations`,
    core.ControlPlaneIdSchema.parse(target.vault_id),
  );
async function readCheckpoints(core, receiptPath, target) {
  const directory = journalDir(core, receiptPath, target),
    entries = new Map();
  let files;
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new RelationRepairError(
        "Cannot read relation checkpoints; preserve the receipt and its .relations directory",
        "checkpoint_error",
      );
    files = [];
  }
  try {
    for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
      const entry = core.IssueRelationCheckpointSchema.parse(
        JSON.parse(await readFile(path.join(directory, file), "utf8")),
      );
      if (file !== checkpointName(entry.reef_id))
        throw Error("Checkpoint identity mismatch");
      entries.set(entry.reef_id, entry);
    }
  } catch {
    throw new RelationRepairError(
      "Cannot read relation checkpoints; preserve the receipt and its .relations directory",
      "checkpoint_error",
    );
  }
  if (entries.size < (target.checkpoint_count ?? 0))
    throw new RelationRepairError(
      "Relation checkpoints are missing; restore the receipt's .relations directory",
      "checkpoint_error",
    );
  return entries;
}
function serializeSave(receiptPath, receipt) {
  let pending = Promise.resolve();
  return () => {
    pending = pending.then(() => writePrivateJson(receiptPath, receipt));
    return pending;
  };
}
async function runTargets(targets, work) {
  let next = 0,
    stop = false;
  const outcomes = await Promise.allSettled(
    Array.from({ length: 2 }, async () => {
      while (!stop && next < targets.length) {
        const target = targets[next++];
        try {
          await work(target);
        } catch (error) {
          stop = true;
          throw error;
        }
      }
    }),
  );
  if (outcomes.some((result) => result.status === "rejected"))
    throw new RelationRepairError(
      "Cannot persist repair progress; restore operator storage and retry the same receipt",
      "checkpoint_error",
    );
}
function reportFailure(core, vault, phase, error) {
  const report = core.IssueRelationBackfillReportSchema.safeParse(
    error?.report,
  );
  if (report.success) return { ...report.data, vault, phase };
  return {
    vault,
    phase,
    code:
      error instanceof RelationRepairError
        ? error.code
        : error instanceof core.ConflictError
          ? "source_changed"
          : error instanceof core.AkbApiError || error instanceof core.AuthError
            ? "upstream_error"
            : "unexpected_error",
    problems: [],
    ...(Number.isSafeInteger(error?.context?.status) &&
    error.context.status >= 0
      ? { status: error.context.status }
      : {}),
  };
}
async function retryTransient(core, work) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof core.AkbApiError) ||
        ![0, 429, 502, 503, 504].includes(error.context.status)
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}
async function inventory({ core, env, fetchImpl, receipt }) {
  const adapter = core.createAkbAdapter({
    baseUrl: env.AKB_BACKEND_URL,
    credential: env.REEF_CONTROL_PLANE_TOKEN,
    fetch: fetchImpl,
    requestPolicy: { timeoutMs: 20_000, maxJsonResponseBytes: 8 * 1024 * 1024 },
  });
  return core.akbListAdminActiveInstallations({
    adapter,
    appId: receipt.app_id,
  });
}
const identities = (targets) =>
  targets.map((t) => `${t.installation_id}:${t.vault_id}:${t.vault}`).sort();
export function assertRelationBackfillTargets(receipt, rollout) {
  if (!receipt.issue_relation_backfill) return;
  const expected = receipt.issue_relation_backfill.targets
    .map((t) => `${t.installation_id}:${t.vault_id}`)
    .sort();
  const actual = rollout.targets
    .map((t) => `${t.installationId}:${t.vaultId}`)
    .sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new RelationRepairError(
      "Active installation inventory differs from rollout targets",
    );
}
function progressLogger(vault, onProgress) {
  let lastAt = 0,
    lastPhase,
    lastCompleted = -1,
    lastPending = -1;
  return (event) => {
    const now = Date.now();
    if (
      event.phase === lastPhase &&
      event.completed === lastCompleted &&
      event.pending === lastPending &&
      now - lastAt < 30_000
    )
      return;
    if (
      event.phase !== lastPhase ||
      event.completed === event.total ||
      event.completed - lastCompleted >= 100 ||
      (event.pending !== lastPending &&
        event.phase === "verify" &&
        now - lastAt >= 5_000) ||
      now - lastAt >= 30_000
    ) {
      const value = { vault, ...event };
      if (onProgress) onProgress(value);
      else process.stderr.write(`${JSON.stringify(value)}\n`);
      lastAt = now;
      lastPhase = event.phase;
      lastCompleted = event.completed;
      lastPending = event.pending;
    }
  };
}
export async function prepareRelationBackfill(context) {
  const { core, env, fetchImpl, receipt, receiptPath } = context;
  if (!receipt.issue_relation_backfill) return;
  core.IssueRelationVerificationTimeoutSchema.parse(
    env.REEF_RELATION_VERIFY_TIMEOUT_MS === undefined
      ? 30 * 60_000
      : Number(env.REEF_RELATION_VERIFY_TIMEOUT_MS),
  );
  const targets = (await inventory(context))
    .map(({ installationId, vaultId, vaultName }) => ({
      installation_id: installationId,
      vault_id: vaultId,
      vault: vaultName,
    }))
    .sort((a, b) => a.vault_id.localeCompare(b.vault_id));
  const existing = receipt.issue_relation_backfill.targets;
  if (
    existing &&
    JSON.stringify(identities(existing)) !== JSON.stringify(identities(targets))
  )
    throw new RelationRepairError(
      "Active installation inventory changed since the receipt was created",
    );
  receipt.issue_relation_backfill.targets =
    existing ??
    targets.map((target) => ({ ...target, status: "pending", count: null }));
  const save = serializeSave(receiptPath, receipt);
  await save();
  await runTargets(
    receipt.issue_relation_backfill.targets.filter(
      (t) => t.status !== "verified",
    ),
    async (target) => {
      try {
        await readCheckpoints(core, receiptPath, target);
        await retryTransient(core, () =>
          core.akbPreflightIssueRelationUris({
            baseUrl: env.AKB_BACKEND_URL,
            credential: env.REEF_CONTROL_PLANE_TOKEN,
            fetch: fetchImpl,
            vault: target.vault,
          }),
        );
        target.status = "pending";
        delete target.failure;
      } catch (error) {
        target.status = "failed";
        target.failure = reportFailure(core, target.vault, "preflight", error);
      }
      await save();
    },
  );
  if (
    receipt.issue_relation_backfill.targets.some((t) => t.status === "failed")
  )
    throw new RelationRepairError(
      "Relation preflight failed; inspect target.failure in the receipt before retrying",
    );
}
export async function finishRelationBackfill(context) {
  const { core, env, fetchImpl, receipt, receiptPath, onProgress } = context;
  if (!receipt.issue_relation_backfill) return;
  core.IssueRelationVerificationTimeoutSchema.parse(
    env.REEF_RELATION_VERIFY_TIMEOUT_MS === undefined
      ? 30 * 60_000
      : Number(env.REEF_RELATION_VERIFY_TIMEOUT_MS),
  );
  const targets = receipt.issue_relation_backfill.targets.filter(
      (t) => t.status !== "verified",
    ),
    save = serializeSave(receiptPath, receipt);
  const entries = new Map(),
    written = new Set();
  for (const target of targets)
    entries.set(
      target.vault_id,
      await readCheckpoints(core, receiptPath, target),
    );
  const adapter = core.createAkbAdapter({
    baseUrl: env.AKB_BACKEND_URL,
    credential: env.REEF_CONTROL_PLANE_TOKEN,
    fetch: fetchImpl,
    requestPolicy: { timeoutMs: 20_000, maxJsonResponseBytes: 8 * 1024 * 1024 },
  });
  const recordFailure = async (target, phase, error) => {
    target.status = "failed";
    target.failure = reportFailure(core, target.vault, phase, error);
    if (
      error instanceof RelationRepairError &&
      error.code === "checkpoint_error"
    )
      throw error;
    await save();
  };
  await runTargets(targets, async (target) => {
    try {
      await retryTransient(core, () =>
        core.akbInstallReefVaultSkill({ adapter, vault: target.vault }),
      );
      target.status = "pending";
      delete target.failure;
      await save();
    } catch (error) {
      await recordFailure(target, "instructions", error);
    }
  });
  const apply = async (target) => {
    const checkpoints = entries.get(target.vault_id);
    return core.akbApplyIssueRelationUris({
      baseUrl: env.AKB_BACKEND_URL,
      credential: env.REEF_CONTROL_PLANE_TOKEN,
      fetch: fetchImpl,
      vault: target.vault,
      checkpoints: [...checkpoints.values()],
      onProgress: progressLogger(target.vault, onProgress),
      onCheckpoint: async (entry) => {
        try {
          await writePrivateJson(
            path.join(
              journalDir(core, receiptPath, target),
              checkpointName(entry.reef_id),
            ),
            entry,
          );
        } catch {
          throw new RelationRepairError(
            "Cannot save relation checkpoint; restore operator storage before retrying",
            "checkpoint_error",
          );
        }
        checkpoints.set(entry.reef_id, entry);
        target.checkpoint_count = checkpoints.size;
        await save();
      },
    });
  };
  await runTargets(
    targets.filter((t) => t.status !== "failed"),
    async (target) => {
      try {
        await retryTransient(core, () => apply(target));
        written.add(target.vault_id);
      } catch (error) {
        await recordFailure(target, "write", error);
      }
    },
  );
  const timeout = core.IssueRelationVerificationTimeoutSchema.parse(
    env.REEF_RELATION_VERIFY_TIMEOUT_MS === undefined
      ? 30 * 60_000
      : Number(env.REEF_RELATION_VERIFY_TIMEOUT_MS),
  );
  await runTargets(
    targets.filter((t) => written.has(t.vault_id)),
    async (target) => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await retryTransient(core, () =>
              core.akbVerifyIssueRelationUris({
                baseUrl: env.AKB_BACKEND_URL,
                credential: env.REEF_CONTROL_PLANE_TOKEN,
                fetch: fetchImpl,
                vault: target.vault,
                checkpoints: [...entries.get(target.vault_id).values()],
                verificationTimeoutMs: timeout,
                onProgress: progressLogger(target.vault, onProgress),
              }),
            );
            target.status = "verified";
            target.count = result.count;
            delete target.failure;
            await save();
            return;
          } catch (error) {
            if (!(error instanceof core.ConflictError) || attempt === 2)
              throw error;
            await retryTransient(core, () => apply(target));
          }
        }
      } catch (error) {
        await recordFailure(target, "verify", error);
      }
    },
  );
  const current = (await inventory(context)).map(
    ({ installationId, vaultId, vaultName }) => ({
      installation_id: installationId,
      vault_id: vaultId,
      vault: vaultName,
    }),
  );
  if (
    JSON.stringify(identities(current)) !==
    JSON.stringify(identities(receipt.issue_relation_backfill.targets))
  )
    throw new RelationRepairError(
      "Active installation inventory changed during backfill",
    );
  if (targets.some((t) => t.status !== "verified"))
    throw new RelationRepairError(
      "Relation repair is incomplete; retry repair with the same receipt and .relations directory",
    );
}

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { issueRelationMigration } from "./release-relations.mjs";
import { writePrivateJson } from "./release-receipt.mjs";

const migrations = [issueRelationMigration];
export class MigrationError extends Error {
  constructor(message, code = "migration_incomplete") {
    super(message);
    this.name = "MigrationError";
    this.stage = "data_migration";
    this.code = code;
  }
}
const checkpointName = (id) =>
  `${createHash("sha256").update(id).digest("hex")}.json`;
const identities = (targets) =>
  targets.map((t) => `${t.installation_id}:${t.vault_id}:${t.vault}`).sort();
const checkpointDirectory = (statePath, migration, target) =>
  path.join(`${statePath}.checkpoints`, migration.id, target.installation_id);
const timestamp = () => new Date().toISOString();

function backendIdentity(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new MigrationError(
      "Migration state requires an HTTPS backend URL without credentials or query parameters",
      "state_invalid",
    );
  return url.toString().replace(/\/+$/u, "");
}
async function readState(core, statePath, env, receipt) {
  const identity = {
    backend_url: backendIdentity(env.AKB_BACKEND_URL),
    app_id: receipt.app_id,
  };
  let state;
  try {
    state = core.OperatorMigrationStateSchema.parse(
      JSON.parse(await readFile(statePath, "utf8")),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        await access(`${statePath}.checkpoints`);
      } catch (checkpointError) {
        if (checkpointError.code === "ENOENT")
          return {
            kind: "reef-operator-migrations",
            ...identity,
            migrations: [],
          };
      }
    }
    throw new MigrationError(
      "Cannot read migration state; restore the state file before retrying",
      "state_invalid",
    );
  }
  if (
    state.backend_url !== identity.backend_url ||
    state.app_id !== identity.app_id
  )
    throw new MigrationError(
      "Migration state belongs to a different AKB backend or App",
      "state_invalid",
    );
  return state;
}
async function readCheckpoints(core, statePath, migration, target, progress) {
  const entries = new Map();
  try {
    let files;
    try {
      files = await readdir(checkpointDirectory(statePath, migration, target));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files = [];
    }
    for (const file of files
      .filter((name) => name.endsWith(".json") && name !== "index.json")
      .sort()) {
      const entry = core.IssueRelationCheckpointSchema.parse(
        JSON.parse(
          await readFile(
            path.join(checkpointDirectory(statePath, migration, target), file),
            "utf8",
          ),
        ),
      );
      if (file !== checkpointName(entry.reef_id))
        throw new Error("Checkpoint identity mismatch");
      entries.set(entry.reef_id, entry);
    }
    let acknowledged;
    try {
      acknowledged = core.OperatorMigrationCheckpointIndexSchema.parse(
        JSON.parse(
          await readFile(
            path.join(
              checkpointDirectory(statePath, migration, target),
              "index.json",
            ),
            "utf8",
          ),
        ),
      );
    } catch (error) {
      if (error.code !== "ENOENT" || (progress?.checkpoint_count ?? 0) > 0)
        throw error;
      acknowledged = [];
    }
    if (
      acknowledged.length < (progress?.checkpoint_count ?? 0) ||
      acknowledged.some((id) => !entries.has(id))
    )
      throw new Error("Missing acknowledged checkpoints");
  } catch {
    throw new MigrationError(
      "Cannot read acknowledged migration checkpoints; restore the state file and its .checkpoints directory",
      "checkpoint_error",
    );
  }
  return entries;
}
async function batch(targets, work) {
  let next = 0,
    stop = false;
  const results = await Promise.allSettled(
    Array.from({ length: 2 }, async () => {
      while (!stop && next < targets.length) {
        try {
          await work(targets[next++]);
        } catch (error) {
          stop = true;
          throw error;
        }
      }
    }),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}
async function retry(core, work) {
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
function failureReport(core, vault, phase, error) {
  const report = core.IssueRelationBackfillReportSchema.safeParse(
    error?.report,
  );
  if (report.success) return { ...report.data, vault, phase };
  return {
    vault,
    phase,
    code:
      error instanceof MigrationError && error.code === "checkpoint_error"
        ? "checkpoint_error"
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
function progressLogger(vault, onProgress) {
  let lastAt = 0,
    lastPhase,
    lastCompleted = -1;
  return (event) => {
    const now = Date.now();
    if (
      event.phase !== lastPhase ||
      event.completed === event.total ||
      event.completed - lastCompleted >= 100 ||
      now - lastAt >= 5000
    ) {
      const value = { vault, ...event };
      if (onProgress) onProgress(value);
      else process.stderr.write(`${JSON.stringify(value)}\n`);
      lastAt = now;
      lastPhase = event.phase;
      lastCompleted = event.completed;
    }
  };
}
async function inventory(core, adapter, receipt, rollout) {
  const targets = (
    await core.akbListAdminActiveInstallations({
      adapter,
      appId: receipt.app_id,
    })
  )
    .map(({ installationId, vaultId, vaultName }) => ({
      installation_id: installationId,
      vault_id: vaultId,
      vault: vaultName,
    }))
    .sort((a, b) => a.installation_id.localeCompare(b.installation_id));
  const expected = rollout.targets
    .map((t) => `${t.installationId}:${t.vaultId}`)
    .sort();
  if (
    JSON.stringify(
      targets.map((t) => `${t.installation_id}:${t.vault_id}`).sort(),
    ) !== JSON.stringify(expected)
  )
    throw new MigrationError(
      "Active installations differ from the applied rollout targets; use a current deployment receipt",
      "inventory_changed",
    );
  return targets;
}

async function manageMigrations({
  core,
  env,
  fetchImpl,
  receipt,
  rollout,
  statePath,
  migrationId,
  execute,
  onProgress,
}) {
  const verificationTimeoutMs =
    core.IssueRelationVerificationTimeoutSchema.parse(
      env.REEF_RELATION_VERIFY_TIMEOUT_MS === undefined
        ? 30 * 60_000
        : Number(env.REEF_RELATION_VERIFY_TIMEOUT_MS),
    );
  const state = await readState(core, statePath, env, receipt);
  const selected = migrationId
    ? migrations.filter((migration) => migration.id === migrationId)
    : migrations;
  if (!selected.length || (execute && !migrationId))
    throw new MigrationError(
      "repair requires --migration issue-relation-uris",
      "input_validation",
    );
  const adapter = core.createAkbAdapter({
    baseUrl: env.AKB_BACKEND_URL,
    credential: env.REEF_CONTROL_PLANE_TOKEN,
    fetch: fetchImpl,
    requestPolicy: { timeoutMs: 20_000, maxJsonResponseBytes: 8 * 1024 * 1024 },
  });
  const targets = await inventory(core, adapter, receipt, rollout);
  let pending = Promise.resolve();
  const save = () => {
    pending = pending.then(() =>
      writePrivateJson(
        statePath,
        core.OperatorMigrationStateSchema.parse(state),
      ),
    );
    return pending;
  };
  const reports = [];
  for (const migration of selected) {
    const record = state.migrations.find(
      (entry) => entry.id === migration.id,
    ) ?? { id: migration.id, checkpoints: [], attempts: [] };
    if (!state.migrations.includes(record)) state.migrations.push(record);
    const inputs = [];
    await batch(targets, async (target) => {
      const input = {
        target,
        result: { ...target, status: "not_required", count: null },
      };
      inputs.push(input);
      try {
        const progress = record.checkpoints.find(
          (entry) => entry.installation_id === target.installation_id,
        );
        if (
          progress &&
          (progress.vault_id !== target.vault_id ||
            progress.vault !== target.vault)
        )
          throw new MigrationError(
            "Installation identity differs from migration progress",
            "checkpoint_error",
          );
        input.checkpoints = await readCheckpoints(
          core,
          statePath,
          migration,
          target,
          progress,
        );
        input.params = {
          baseUrl: env.AKB_BACKEND_URL,
          credential: env.REEF_CONTROL_PLANE_TOKEN,
          fetch: fetchImpl,
          vault: target.vault,
        };
        input.assessment = await retry(core, () =>
          migration.inspect({
            core,
            adapter,
            params: input.params,
            checkpoints: [...input.checkpoints.values()],
          }),
        );
        input.result.count = input.assessment.count;
        input.result.status = input.assessment.required
          ? "required"
          : record.attempts.some((attempt) =>
                attempt.targets.some(
                  (previous) =>
                    previous.installation_id === target.installation_id &&
                    previous.status === "completed",
                ),
              )
            ? "completed"
            : "not_required";
      } catch (error) {
        input.result.status = "failed";
        input.result.failure = failureReport(
          core,
          target.vault,
          "preflight",
          error,
        );
      }
    });
    inputs.sort((a, b) =>
      a.target.installation_id.localeCompare(b.target.installation_id),
    );
    if (!execute) {
      reports.push({
        id: migration.id,
        targets: inputs.map((input) => input.result),
        attempts: record.attempts,
      });
      continue;
    }
    for (const previous of record.attempts.filter(
      (attempt) => attempt.status === "running",
    )) {
      previous.status = "interrupted";
      previous.finished_at = timestamp();
    }
    const attempt = {
      attempt_id: randomUUID(),
      release_id: receipt.release_id,
      source_revision: receipt.source_revision,
      started_at: timestamp(),
      finished_at: null,
      status: "running",
      targets: inputs.map((input) => input.result),
    };
    record.attempts.push(attempt);
    await save();
    try {
      if (inputs.some((input) => input.result.status === "failed"))
        throw new MigrationError(
          "Migration assessment failed; inspect the attempt's target failures before retrying",
          "assessment_failed",
        );
      const work = inputs.filter((input) => input.assessment.required);
      const persistIndex = async (input) => {
        try {
          await writePrivateJson(
            path.join(
              checkpointDirectory(statePath, migration, input.target),
              "index.json",
            ),
            [...input.checkpoints.keys()].sort(),
          );
          let progress = record.checkpoints.find(
            (target) => target.installation_id === input.target.installation_id,
          );
          if (!progress) {
            progress = { ...input.target, checkpoint_count: 0 };
            record.checkpoints.push(progress);
          }
          progress.checkpoint_count = input.checkpoints.size;
          await save();
        } catch {
          throw new MigrationError(
            "Cannot save migration checkpoints; restore operator storage before retrying",
            "checkpoint_error",
          );
        }
      };
      const persistCheckpoint = async (input, entry) => {
        try {
          await writePrivateJson(
            path.join(
              checkpointDirectory(statePath, migration, input.target),
              checkpointName(entry.reef_id),
            ),
            entry,
          );
          input.checkpoints.set(entry.reef_id, entry);
          await persistIndex(input);
        } catch {
          throw new MigrationError(
            "Cannot save migration checkpoints; restore operator storage before retrying",
            "checkpoint_error",
          );
        }
      };
      for (const input of inputs)
        if (input.checkpoints.size > 0) await persistIndex(input);
      const fail = async (input, phase, error) => {
        input.result.status = "failed";
        input.result.failure = failureReport(
          core,
          input.target.vault,
          phase,
          error,
        );
        if (
          error instanceof MigrationError &&
          error.code === "checkpoint_error"
        )
          throw error;
        await save();
      };
      const apply = (input) =>
        retry(core, () =>
          migration.apply({
            core,
            adapter,
            params: input.params,
            assessment: input.assessment,
            checkpoints: [...input.checkpoints.values()],
            onCheckpoint: (entry) => persistCheckpoint(input, entry),
            onProgress: progressLogger(input.target.vault, onProgress),
          }),
        );
      await batch(work, async (input) => {
        input.result.status = "running";
        await save();
        try {
          await apply(input);
        } catch (error) {
          await fail(input, "write", error);
        }
      });
      await batch(
        work.filter((input) => input.result.status !== "failed"),
        async (input) => {
          try {
            for (let retryIndex = 0; ; retryIndex++) {
              try {
                const verified = await retry(core, () =>
                  migration.verify({
                    core,
                    params: input.params,
                    checkpoints: [...input.checkpoints.values()],
                    verificationTimeoutMs,
                    onProgress: progressLogger(input.target.vault, onProgress),
                  }),
                );
                input.result.count = verified.count;
                input.result.status = "completed";
                await save();
                break;
              } catch (error) {
                if (!(error instanceof core.ConflictError) || retryIndex >= 2)
                  throw error;
                await apply(input);
              }
            }
          } catch (error) {
            await fail(input, "verify", error);
          }
        },
      );
      if (
        JSON.stringify(
          identities(await inventory(core, adapter, receipt, rollout)),
        ) !== JSON.stringify(identities(targets))
      )
        throw new MigrationError(
          "Active installation inventory changed during migration",
          "inventory_changed",
        );
      if (attempt.targets.some((target) => target.status === "failed"))
        throw new MigrationError(
          "Migration is incomplete; retry the explicit repair with the same migration state and checkpoints",
        );
      for (const target of attempt.targets)
        if (target.status === "not_required") target.status = "completed";
      attempt.status = "completed";
      attempt.finished_at = timestamp();
      await save();
    } catch (error) {
      attempt.status = "failed";
      attempt.finished_at = timestamp();
      attempt.failure_code =
        error instanceof MigrationError ? error.code : "migration_incomplete";
      await save();
      throw error;
    }
    reports.push({
      id: migration.id,
      targets: attempt.targets,
      attempts: record.attempts,
    });
  }
  return {
    kind: "reef-migration-status",
    ready: reports.every((report) =>
      report.targets.every((target) =>
        ["completed", "not_required"].includes(target.status),
      ),
    ),
    app_id: receipt.app_id,
    schema: {
      owner: "akb",
      status: rollout.status,
      rollout_job_id: rollout.jobId,
    },
    migrations: reports,
  };
}

export async function runOperatorMigrations(context) {
  const statePath = path.resolve(context.statePath);
  if (!context.execute) return manageMigrations({ ...context, statePath });
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  let release;
  try {
    release = await lockfile.lock(statePath, { realpath: false, retries: 0 });
  } catch {
    throw new MigrationError(
      "Migration state is locked by another operator; retry after that process finishes or its lock becomes stale",
      "state_locked",
    );
  }
  try {
    return await manageMigrations({ ...context, statePath });
  } finally {
    await release();
  }
}

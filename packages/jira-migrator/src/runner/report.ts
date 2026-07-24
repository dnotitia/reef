import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, parse as parsePath, resolve, sep } from "node:path";
import { lock } from "proper-lockfile";
import { z } from "zod";
import { canonicalizeJson } from "../archive/canonicalJson.js";
import { JiraMigrationActionSchema } from "../ledger.js";
import { finalizeJiraCleanup } from "./cleanup.js";

const iso = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const TerminalClassificationSchema = z
  .object({
    phase: z.enum([
      "planning",
      "issues",
      "related",
      "changelog",
      "reconciliation",
    ]),
    source_key: z.string().min(1),
    action: JiraMigrationActionSchema,
    retryable: z.boolean().optional(),
  })
  .strict();

export const JiraRunnerReportSchema = z
  .object({
    schema_version: z.literal(1),
    run: z
      .object({
        run_id: z.string().min(1),
        mode: z.enum(["dry-run", "apply"]),
        source: z
          .object({
            jira_cloud_id: z.string().min(1),
            project_keys: z.array(z.string().min(1)).min(1),
            board_ids: z.array(z.string().min(1)),
          })
          .strict(),
        target: z
          .object({
            vault: z.string().min(1),
            actor: z.string().min(1),
          })
          .strict(),
        started_at: iso,
        ended_at: iso,
        status: z.enum(["completed", "partial_failed", "blocked"]),
      })
      .strict(),
    plan_sha256: sha256,
    approval: z
      .object({
        dry_run_plan_sha256: sha256,
        dry_run_completed_at: iso,
      })
      .strict(),
    sections: z
      .object({
        planning: z.array(z.unknown()),
        issues: z.array(z.unknown()),
        related: z.array(z.unknown()),
        changelog: z.array(z.unknown()),
        reconciliation: z.array(z.unknown()),
        raw_archive: z.array(z.unknown()),
      })
      .strict(),
    terminal_classifications: z.array(TerminalClassificationSchema),
    totals: z
      .object({
        created: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        conflict: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        retryable: z.number().int().nonnegative(),
      })
      .strict(),
    conservation: z
      .object({
        input_count: z.number().int().nonnegative(),
        terminal_count: z.number().int().nonnegative(),
        balanced: z.literal(true),
      })
      .strict(),
    redaction: z
      .object({
        raw_payloads_omitted: z.literal(true),
        secrets_checked: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type JiraRunnerReport = z.infer<typeof JiraRunnerReportSchema>;

export type JiraMigrationReportErrorCode =
  | "report_schema_invalid"
  | "report_conservation_failed"
  | "report_io_failed"
  | "permission_violation"
  | "symlink_not_allowed"
  | "lock_conflict"
  | "stale_report"
  | "secret_material_detected";

export class JiraMigrationReportError extends Error {
  constructor(readonly code: JiraMigrationReportErrorCode) {
    super(code);
    this.name = "JiraMigrationReportError";
  }
}

const fail = (code: JiraMigrationReportErrorCode): never => {
  throw new JiraMigrationReportError(code);
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    return fail("report_io_failed");
  }
};

const assertNoSymlinkPathComponents = async (path: string): Promise<void> => {
  const absolute = resolve(path);
  const root = parsePath(absolute).root;
  let current = root;
  for (const segment of absolute
    .slice(root.length)
    .split(sep)
    .filter(Boolean)) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) fail("symlink_not_allowed");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      if (
        error instanceof JiraMigrationReportError &&
        error.code === "symlink_not_allowed"
      ) {
        throw error;
      }
      fail("report_io_failed");
    }
  }
};

const assertPrivate = async (
  path: string,
  kind: "file" | "directory",
): Promise<void> => {
  if (process.platform === "win32") {
    fail("permission_violation");
  }
  await assertNoSymlinkPathComponents(path);
  const stat = await lstat(path).catch(() => fail("report_io_failed"));
  if (stat.isSymbolicLink()) fail("symlink_not_allowed");
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
    fail("report_io_failed");
  }
  if ((stat.mode & 0o777) !== (kind === "file" ? 0o600 : 0o700)) {
    fail("permission_violation");
  }
};

const ensureDirectory = async (path: string): Promise<void> => {
  await assertNoSymlinkPathComponents(path);
  if (!(await exists(path))) {
    await mkdir(path, { recursive: true, mode: 0o700 }).catch(() =>
      fail("report_io_failed"),
    );
    await chmod(path, 0o700);
  }
  await assertPrivate(path, "directory");
};

const containsSecret = (
  value: unknown,
  secrets: readonly string[],
): boolean => {
  const forbidden = secrets.filter((secret) => secret.length > 0);
  if (forbidden.length === 0) return false;
  if (typeof value === "string") {
    return forbidden.some((secret) => value.includes(secret));
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSecret(item, forbidden));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) =>
        containsSecret(key, forbidden) || containsSecret(item, forbidden),
    );
  }
  return false;
};

export function buildJiraRunnerReport(input: {
  runId: string;
  mode: "dry-run" | "apply";
  source: JiraRunnerReport["run"]["source"];
  target: JiraRunnerReport["run"]["target"];
  planSha256: string;
  startedAt: string;
  endedAt: string;
  status: JiraRunnerReport["run"]["status"];
  sections: JiraRunnerReport["sections"];
  terminalClassifications: JiraRunnerReport["terminal_classifications"];
  inputCount: number;
  approvedDryRun?: {
    planSha256: string;
    completedAt: string;
  };
}): JiraRunnerReport {
  const keys = input.terminalClassifications.map(
    (classification) => `${classification.phase}:${classification.source_key}`,
  );
  if (
    keys.length !== input.inputCount ||
    new Set(keys).size !== input.inputCount
  ) {
    fail("report_conservation_failed");
  }
  const totals = {
    created: 0,
    updated: 0,
    skipped: 0,
    conflict: 0,
    failed: 0,
    retryable: 0,
  };
  for (const classification of input.terminalClassifications) {
    if (classification.action === "create") totals.created += 1;
    if (classification.action === "update") totals.updated += 1;
    if (classification.action === "skip") totals.skipped += 1;
    if (classification.action === "conflict") totals.conflict += 1;
    if (classification.action === "failed") totals.failed += 1;
    if (
      classification.action === "retry" ||
      classification.retryable === true
    ) {
      totals.retryable += 1;
    }
  }
  const parsed = JiraRunnerReportSchema.safeParse({
    schema_version: 1,
    run: {
      run_id: input.runId,
      mode: input.mode,
      source: input.source,
      target: input.target,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      status: input.status,
    },
    plan_sha256: input.planSha256,
    approval: {
      dry_run_plan_sha256: input.approvedDryRun?.planSha256 ?? input.planSha256,
      dry_run_completed_at: input.approvedDryRun?.completedAt ?? input.endedAt,
    },
    sections: input.sections,
    terminal_classifications: input.terminalClassifications,
    totals,
    conservation: {
      input_count: input.inputCount,
      terminal_count: keys.length,
      balanced: true,
    },
    redaction: { raw_payloads_omitted: true, secrets_checked: true },
  });
  return parsed.success ? parsed.data : fail("report_schema_invalid");
}

export async function loadJiraRunnerReport(
  path: string,
): Promise<JiraRunnerReport> {
  const absolute = resolve(path);
  await assertNoSymlinkPathComponents(absolute);
  const release = await acquireReportLock(absolute);
  try {
    await assertPrivate(dirname(absolute), "directory");
    await assertPrivate(absolute, "file");
    return await loadReportAllowLock(absolute);
  } finally {
    await release();
  }
}

const writeExclusive = async (path: string, value: string): Promise<void> => {
  const handle = await open(path, "wx", 0o600).catch((error) => {
    if (isNodeError(error) && error.code === "EEXIST") fail("lock_conflict");
    return fail("report_io_failed");
  });
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export async function writeJiraRunnerReport(input: {
  path: string;
  report: JiraRunnerReport;
  expectedReport?: JiraRunnerReport;
  forbiddenSecretValues?: readonly string[];
}): Promise<void> {
  const parsed = JiraRunnerReportSchema.safeParse(input.report);
  if (!parsed.success) fail("report_schema_invalid");
  if (containsSecret(parsed.data, input.forbiddenSecretValues ?? [])) {
    fail("secret_material_detected");
  }
  const absolute = resolve(input.path);
  await assertNoSymlinkPathComponents(absolute);
  await ensureDirectory(dirname(absolute));
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  const release = await acquireReportLock(absolute);
  let primaryError: unknown;
  try {
    if (await exists(absolute)) {
      if (!input.expectedReport) fail("stale_report");
      const current = await loadReportAllowLock(absolute);
      if (
        canonicalizeJson(current) !== canonicalizeJson(input.expectedReport)
      ) {
        fail("stale_report");
      }
    }
    await writeExclusive(temporary, canonicalizeJson(parsed.data));
    await rename(temporary, absolute);
    await assertPrivate(absolute, "file");
    const readback = await loadReportAllowLock(absolute);
    if (canonicalizeJson(readback) !== canonicalizeJson(parsed.data)) {
      fail("report_io_failed");
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await finalizeJiraCleanup({
      steps: [() => rm(temporary, { force: true }), release],
      ...(primaryError === undefined ? {} : { primaryError }),
    });
  }
}

const acquireReportLock = async (
  path: string,
): Promise<() => Promise<void>> => {
  try {
    return await lock(path, {
      realpath: false,
      stale: 10_000,
      update: 2_000,
      retries: 0,
    });
  } catch {
    return fail("lock_conflict");
  }
};

const loadReportAllowLock = async (path: string): Promise<JiraRunnerReport> => {
  const raw = await readFile(path, "utf8").catch(() =>
    fail("report_io_failed"),
  );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail("report_schema_invalid");
  }
  const parsed = JiraRunnerReportSchema.safeParse(value);
  return parsed.success ? parsed.data : fail("report_schema_invalid");
};

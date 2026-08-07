import { type ChildProcess, spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  MAX_VALIDATION_TIMEOUT_MS,
  ProviderError,
  type ProviderRequestContext,
  VALIDATION_CAPABILITIES,
  type ValidationCheck,
  type ValidationCheckResult,
  type ValidationLogExcerpt,
  type ValidationProof,
  type ValidationProvider,
  type ValidationRequest,
  ValidationRequestSchema,
  executeProviderOperation,
} from "@reef/orchestrator";

export const LOCAL_VALIDATION_PROVIDER_ID = "local-validation" as const;
export const LOCAL_VALIDATION_PROVIDER_VERSION = "0.1.0" as const;

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TERMINATION_TIMEOUT_MS = 1_000;
const MAX_TERMINATION_TIMEOUT_MS = 30_000;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENVIRONMENT_KEY_LENGTH = 128;
const MAX_ENVIRONMENT_VALUE_LENGTH = 16 * 1024;
const MAX_REDACTION_VALUES = 128;
const MAX_REDACTION_VALUE_LENGTH = 16 * 1024;
const GIT_OUTPUT_BYTES = 64 * 1024;
const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin";

export type LocalValidationSpawn = typeof spawn;

export interface LocalValidationProviderOptions {
  readonly repositoryRoot: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly maxOutputBytes?: number;
  readonly terminationTimeoutMs?: number;
  readonly redactionValues?: readonly string[];
  readonly clock?: () => number;
  readonly spawnProcess?: LocalValidationSpawn;
}

export interface LocalValidationProvider extends ValidationProvider {
  validate(
    input: ValidationRequest,
    context: ProviderRequestContext,
  ): Promise<ValidationProof>;
}

interface NormalizedOptions {
  readonly repositoryRoot: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly maxOutputBytes: number;
  readonly captureOutputBytes: number;
  readonly terminationTimeoutMs: number;
  readonly redactionValues: readonly string[];
  readonly clock: () => number;
  readonly spawnProcess: LocalValidationSpawn;
}

interface RepositoryIdentity {
  readonly rootPath: string;
  readonly commonGitPath: string;
}

interface RepositoryInspection {
  readonly identity: RepositoryIdentity;
  readonly head: string;
}

interface BufferSnapshot {
  readonly value: string;
  readonly truncated: boolean;
}

class BoundedBuffer {
  private readonly chunks: Buffer[] = [];
  private length = 0;
  private truncated = false;

  constructor(private readonly maximumBytes: number) {}

  append(value: Buffer | string): void {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.byteLength === 0) return;

    const remaining = this.maximumBytes - this.length;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }

    if (chunk.byteLength > remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.length = this.maximumBytes;
      this.truncated = true;
      return;
    }

    this.chunks.push(chunk);
    this.length += chunk.byteLength;
  }

  snapshot(): BufferSnapshot {
    return {
      value: Buffer.concat(this.chunks).toString("utf8"),
      truncated: this.truncated,
    };
  }
}

interface ChildResult {
  readonly exitCode: number | null;
  readonly stdout: BufferSnapshot;
  readonly stderr: BufferSnapshot;
  readonly spawnFailed: boolean;
}

interface ChildHandle {
  readonly closed: Promise<ChildResult>;
  readonly isSettled: () => boolean;
  readonly terminate: () => Promise<boolean>;
}

interface CommandOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: boolean;
  readonly detached: boolean;
  readonly maximumOutputBytes: number;
  readonly terminationTimeoutMs: number;
  readonly spawnProcess: LocalValidationSpawn;
  readonly signal?: AbortSignal;
}

class InvalidRequest extends Error {
  constructor() {
    super("local_validation_request_invalid");
    this.name = "InvalidRequest";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const metadataFor = (operation: string) => ({
  kind: "validation" as const,
  providerId: LOCAL_VALIDATION_PROVIDER_ID,
  operation,
});

const requestFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "request", false);

const spawnFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "spawn", false);

const protocolFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "protocol", false);

const cancelledFailure = (operation: string): ProviderError =>
  ProviderError.cancelled(metadataFor(operation));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const positiveInteger = (
  value: number | undefined,
  fallback: number,
  maximum: number,
): number => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result <= 0 || result > maximum) {
    throw new InvalidRequest();
  }
  return result;
};

const absolutePath = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\u0000") ||
    !isAbsolute(value)
  ) {
    throw new InvalidRequest();
  }
  return resolve(value);
};

const normalizeEnvironment = (
  value: unknown,
): Readonly<Record<string, string>> => {
  if (!isRecord(value)) throw new InvalidRequest();
  const entries = Object.entries(value);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) throw new InvalidRequest();

  const environment: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (
      key.length === 0 ||
      key.length > MAX_ENVIRONMENT_KEY_LENGTH ||
      !ENVIRONMENT_KEY.test(key) ||
      typeof entry !== "string" ||
      entry.includes("\u0000") ||
      entry.length > MAX_ENVIRONMENT_VALUE_LENGTH
    ) {
      throw new InvalidRequest();
    }
    environment[key] = entry;
  }
  return Object.freeze(environment);
};

const normalizeRedactionValues = (
  value: unknown,
  environment: Readonly<Record<string, string>>,
  repositoryRoot: string,
): readonly string[] => {
  if (value !== undefined && !Array.isArray(value)) throw new InvalidRequest();
  const configured = value ?? [];
  if (configured.length > MAX_REDACTION_VALUES) throw new InvalidRequest();

  const values = new Set<string>([repositoryRoot]);
  for (const environmentValue of Object.values(environment)) {
    if (environmentValue.length > 0) values.add(environmentValue);
  }
  for (const redaction of configured) {
    if (
      typeof redaction !== "string" ||
      redaction.length === 0 ||
      redaction.length > MAX_REDACTION_VALUE_LENGTH ||
      redaction.includes("\u0000")
    ) {
      throw new InvalidRequest();
    }
    values.add(redaction);
  }

  return Object.freeze(
    [...values].sort((left, right) => right.length - left.length),
  );
};

const normalizeOptions = (
  options: LocalValidationProviderOptions,
): NormalizedOptions => {
  try {
    if (!isRecord(options)) throw new InvalidRequest();
    const repositoryRoot = absolutePath(options.repositoryRoot);
    const environment = normalizeEnvironment(options.environment);
    const clock = options.clock ?? (() => performance.now());
    const spawnProcess = options.spawnProcess ?? spawn;
    if (typeof clock !== "function" || typeof spawnProcess !== "function") {
      throw new InvalidRequest();
    }

    const maxOutputBytes = positiveInteger(
      options.maxOutputBytes,
      DEFAULT_MAX_OUTPUT_BYTES,
      MAX_OUTPUT_BYTES,
    );
    const redactionValues = normalizeRedactionValues(
      options.redactionValues,
      environment,
      repositoryRoot,
    );
    const longestRedactionBytes = redactionValues.reduce(
      (longest, value) => Math.max(longest, Buffer.byteLength(value)),
      0,
    );

    return Object.freeze({
      repositoryRoot,
      environment,
      maxOutputBytes,
      captureOutputBytes: maxOutputBytes + longestRedactionBytes,
      terminationTimeoutMs: positiveInteger(
        options.terminationTimeoutMs,
        DEFAULT_TERMINATION_TIMEOUT_MS,
        MAX_TERMINATION_TIMEOUT_MS,
      ),
      redactionValues,
      clock,
      spawnProcess,
    });
  } catch (error) {
    if (error instanceof InvalidRequest) {
      throw ProviderError.classified(
        metadataFor("create"),
        "configuration",
        false,
      );
    }
    throw ProviderError.classified(
      metadataFor("create"),
      "configuration",
      false,
    );
  }
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });

const processGroupAlive = (pid: number): boolean => {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === "EPERM";
  }
};

const waitForExit = async (
  closed: Promise<ChildResult>,
  isSettled: () => boolean,
  pid: number | undefined,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (isSettled() && (pid === undefined || !processGroupAlive(pid))) {
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await Promise.race([closed, wait(Math.min(10, remaining))]);
  }
};

const startChild = (input: {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: boolean;
  readonly detached: boolean;
  readonly maximumOutputBytes: number;
  readonly terminationTimeoutMs: number;
  readonly spawnProcess: LocalValidationSpawn;
}): ChildHandle => {
  const stdout = new BoundedBuffer(input.maximumOutputBytes);
  const stderr = new BoundedBuffer(input.maximumOutputBytes);
  let child: ChildProcess;
  try {
    child = input.spawnProcess(input.command, [...(input.args ?? [])], {
      cwd: input.cwd,
      detached: input.detached,
      env: { ...input.environment },
      shell: input.shell,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("spawn_failed");
  }

  if (child.stdout === null || child.stderr === null) {
    child.kill("SIGKILL");
    throw new Error("child_stdio_unavailable");
  }
  child.stdout.on("data", (value: Buffer | string) => stdout.append(value));
  child.stderr.on("data", (value: Buffer | string) => stderr.append(value));

  let settled = false;
  let spawnFailed = false;
  const closed = new Promise<ChildResult>((resolvePromise) => {
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (exitCode) => {
      settled = true;
      resolvePromise({
        exitCode,
        stdout: stdout.snapshot(),
        stderr: stderr.snapshot(),
        spawnFailed,
      });
    });
  });

  let termination: Promise<boolean> | undefined;
  const processGroupPid =
    input.detached &&
    process.platform !== "win32" &&
    typeof child.pid === "number"
      ? child.pid
      : undefined;
  const sendSignal = (signal: NodeJS.Signals): void => {
    const pid = child.pid;
    if (
      input.detached &&
      process.platform !== "win32" &&
      typeof pid === "number" &&
      pid > 0
    ) {
      try {
        process.kill(-pid, signal);
        return;
      } catch {
        // The group may have exited between inspection and signalling.
      }
    }
    if (!settled) {
      try {
        child.kill(signal);
      } catch {
        // The child may have exited between inspection and signalling.
      }
    }
  };

  const terminate = async (): Promise<boolean> => {
    if (termination !== undefined) return termination;
    termination = (async () => {
      sendSignal("SIGTERM");
      if (
        await waitForExit(
          closed,
          () => settled,
          processGroupPid,
          input.terminationTimeoutMs,
        )
      ) {
        return true;
      }

      sendSignal("SIGKILL");
      return waitForExit(
        closed,
        () => settled,
        processGroupPid,
        input.terminationTimeoutMs,
      );
    })();
    return termination;
  };

  return { closed, isSettled: () => settled, terminate };
};

const runChild = async (input: CommandOptions): Promise<ChildResult> => {
  if (input.signal?.aborted) throw cancelledFailure("validate");
  let handle: ChildHandle;
  try {
    handle = startChild(input);
  } catch {
    throw spawnFailure("validate");
  }

  let resolveAbort: ((value: boolean) => void) | undefined;
  const abortCompleted = new Promise<boolean>((resolvePromise) => {
    resolveAbort = resolvePromise;
  });
  const onAbort = (): void => {
    void handle.terminate().then((value) => resolveAbort?.(value));
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) onAbort();

  const result = await Promise.race([
    handle.closed.then((value) => ({ kind: "closed" as const, value })),
    abortCompleted.then((value) => ({ kind: "aborted" as const, value })),
  ]);
  input.signal?.removeEventListener("abort", onAbort);

  if (result.kind === "aborted") {
    if (!result.value) throw protocolFailure("validate");
    await handle.closed;
    throw cancelledFailure("validate");
  }
  if (input.signal?.aborted) {
    await handle.terminate();
    throw cancelledFailure("validate");
  }
  return result.value;
};

const gitEnvironment = (
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> =>
  Object.freeze({
    PATH: environment.PATH ?? DEFAULT_PATH,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  });

const runGit = async (
  options: NormalizedOptions,
  cwd: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
): Promise<string> => {
  const result = await runChild({
    command: "git",
    args,
    cwd,
    environment: gitEnvironment(options.environment),
    shell: false,
    detached: false,
    maximumOutputBytes: GIT_OUTPUT_BYTES,
    terminationTimeoutMs: options.terminationTimeoutMs,
    spawnProcess: options.spawnProcess,
    signal,
  });
  if (result.spawnFailed) throw spawnFailure("validate");
  if (result.exitCode !== 0) throw requestFailure("validate");
  return result.stdout.value.trim();
};

const inspectRepository = async (
  options: NormalizedOptions,
  candidateRevision: string,
  signal: AbortSignal | undefined,
): Promise<RepositoryInspection> => {
  if (signal?.aborted) throw cancelledFailure("validate");

  let rootPath: string;
  try {
    const entry = await lstat(options.repositoryRoot);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("invalid_repository_root");
    }
    rootPath = await realpath(options.repositoryRoot);
  } catch {
    throw requestFailure("validate");
  }
  const topLevel = await runGit(
    options,
    rootPath,
    ["rev-parse", "--show-toplevel"],
    signal,
  );
  let topLevelPath: string;
  try {
    topLevelPath = await realpath(topLevel);
  } catch {
    throw requestFailure("validate");
  }
  if (topLevelPath !== rootPath) throw requestFailure("validate");

  const bare = await runGit(
    options,
    rootPath,
    ["rev-parse", "--is-bare-repository"],
    signal,
  );
  if (bare !== "false") throw requestFailure("validate");

  const commonGit = await runGit(
    options,
    rootPath,
    ["rev-parse", "--git-common-dir"],
    signal,
  );
  let commonGitPath: string;
  try {
    commonGitPath = await realpath(resolve(rootPath, commonGit));
  } catch {
    throw requestFailure("validate");
  }

  const head = await runGit(
    options,
    rootPath,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    signal,
  );
  if (!FULL_COMMIT.test(candidateRevision) || head !== candidateRevision) {
    throw requestFailure("validate");
  }

  const status = await runGit(
    options,
    rootPath,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    signal,
  );
  if (status.length > 0) throw requestFailure("validate");

  return {
    identity: { rootPath, commonGitPath },
    head,
  };
};

const snapshotRequest = (input: ValidationRequest): ValidationRequest =>
  Object.freeze({
    candidateRevision: input.candidateRevision,
    contractRevision: input.contractRevision,
    checks: Object.freeze(
      input.checks.map((check) => Object.freeze({ ...check })),
    ),
  });

const truncate = (
  value: string,
  maximumBytes: number,
): { readonly value: string; readonly truncated: boolean } => {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maximumBytes) {
    return { value, truncated: false };
  }
  return {
    value: bytes.subarray(0, maximumBytes).toString("utf8"),
    truncated: true,
  };
};

const redact = (
  value: string,
  values: readonly string[],
  maximumBytes: number,
): { readonly value: string; readonly truncated: boolean } => {
  const redacted = redactText(value, values);
  return truncate(redacted, maximumBytes);
};

const redactText = (value: string, values: readonly string[]): string => {
  let redacted = value;
  for (const secret of values)
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted;
};

const redactionValuesFor = (
  options: NormalizedOptions,
  identity: RepositoryIdentity,
): readonly string[] => [
  ...options.redactionValues,
  identity.rootPath,
  identity.commonGitPath,
];

const excerptFrom = (
  result: ChildResult,
  options: NormalizedOptions,
  identity: RepositoryIdentity,
): ValidationLogExcerpt => {
  const redactionValues = redactionValuesFor(options, identity);
  const stdout = redact(
    result.stdout.value,
    redactionValues,
    options.maxOutputBytes,
  );
  const stderr = redact(
    result.stderr.value,
    redactionValues,
    options.maxOutputBytes,
  );
  return {
    stdout: stdout.value,
    stderr: stderr.value,
    stdoutTruncated: result.stdout.truncated || stdout.truncated,
    stderrTruncated: result.stderr.truncated || stderr.truncated,
  };
};

const elapsed = (options: NormalizedOptions, startedAt: number): number => {
  const current = options.clock();
  if (!Number.isFinite(current) || !Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.round(current - startedAt));
};

const emptyExcerpt = (): ValidationLogExcerpt => ({
  stdout: "",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const runValidationCheck = async (
  check: ValidationCheck,
  options: NormalizedOptions,
  identity: RepositoryIdentity,
  signal: AbortSignal | undefined,
): Promise<ValidationCheckResult> => {
  if (signal?.aborted) throw cancelledFailure("validate");
  const startedAt = options.clock();
  const displayName = redactText(
    check.name,
    redactionValuesFor(options, identity),
  );
  let handle: ChildHandle;
  try {
    handle = startChild({
      command: check.command,
      cwd: identity.rootPath,
      environment: options.environment,
      shell: true,
      detached: process.platform !== "win32",
      maximumOutputBytes: options.captureOutputBytes,
      terminationTimeoutMs: options.terminationTimeoutMs,
      spawnProcess: options.spawnProcess,
    });
  } catch {
    throw spawnFailure("validate");
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let resolveTimeout: (() => void) | undefined;
  const timedOut = new Promise<void>((resolvePromise) => {
    resolveTimeout = resolvePromise;
    timeoutHandle = setTimeout(resolvePromise, check.timeoutMs);
  });
  let resolveAbort: (() => void) | undefined;
  const aborted = new Promise<void>((resolvePromise) => {
    resolveAbort = resolvePromise;
  });
  const onAbort = (): void => resolveAbort?.();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  const outcome = await Promise.race([
    handle.closed.then((value) => ({ kind: "closed" as const, value })),
    timedOut.then(() => ({ kind: "timed_out" as const })),
    aborted.then(() => ({ kind: "cancelled" as const })),
  ]);
  signal?.removeEventListener("abort", onAbort);
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  resolveTimeout?.();

  if (outcome.kind === "cancelled") {
    const terminated = await handle.terminate();
    if (!terminated) throw protocolFailure("validate");
    await handle.closed;
    throw cancelledFailure("validate");
  }

  if (outcome.kind === "timed_out") {
    const terminated = await handle.terminate();
    if (!terminated) throw protocolFailure("validate");
    const result = await handle.closed;
    if (result.spawnFailed) throw spawnFailure("validate");
    return {
      name: displayName,
      status: "timed_out",
      durationMs: elapsed(options, startedAt),
      exitCode: result.exitCode,
      summary: "validation command timed out",
      excerpt: excerptFrom(result, options, identity),
    };
  }

  const result = outcome.value;
  if (result.spawnFailed) throw spawnFailure("validate");
  const excerpt = excerptFrom(result, options, identity);
  const passed = result.exitCode === 0;
  return {
    name: displayName,
    status: passed ? "passed" : "failed",
    durationMs: elapsed(options, startedAt),
    exitCode: result.exitCode,
    summary: passed
      ? "validation command passed"
      : result.exitCode === null
        ? "validation command terminated without an exit code"
        : `validation command exited with code ${result.exitCode}`,
    excerpt,
  };
};

const skippedResult = (
  check: ValidationCheck,
  options: NormalizedOptions,
  identity: RepositoryIdentity,
): ValidationCheckResult => ({
  name: redactText(check.name, redactionValuesFor(options, identity)),
  status: "skipped",
  durationMs: 0,
  exitCode: null,
  summary: "skipped after a previous validation failure",
  excerpt: emptyExcerpt(),
});

export function createLocalValidationProvider(
  options: LocalValidationProviderOptions,
): LocalValidationProvider {
  const normalized = normalizeOptions(options);
  const identity = Object.freeze({
    kind: "validation" as const,
    id: LOCAL_VALIDATION_PROVIDER_ID,
    version: LOCAL_VALIDATION_PROVIDER_VERSION,
    capabilities: Object.freeze([...VALIDATION_CAPABILITIES]),
  });
  let boundRepository: RepositoryIdentity | undefined;
  let active = false;

  const validate = async (
    input: ValidationRequest,
    context: ProviderRequestContext,
  ): Promise<ValidationProof> =>
    executeProviderOperation(
      identity,
      "validate",
      "validate",
      async ({ signal }) => {
        if (active) throw requestFailure("validate");
        active = true;
        try {
          const parsed = ValidationRequestSchema.safeParse(input);
          if (!parsed.success) throw new InvalidRequest();
          const request = snapshotRequest(parsed.data);
          if (!FULL_COMMIT.test(request.candidateRevision)) {
            throw new InvalidRequest();
          }
          if (
            request.checks.some(
              (check) => check.timeoutMs > MAX_VALIDATION_TIMEOUT_MS,
            )
          ) {
            throw new InvalidRequest();
          }

          const inspection = await inspectRepository(
            normalized,
            request.candidateRevision,
            signal,
          );
          if (boundRepository === undefined) {
            boundRepository = inspection.identity;
          } else if (
            boundRepository.rootPath !== inspection.identity.rootPath ||
            boundRepository.commonGitPath !== inspection.identity.commonGitPath
          ) {
            throw requestFailure("validate");
          }

          const startedAt = normalized.clock();
          const results: ValidationCheckResult[] = [];
          let failed = false;
          for (const check of request.checks) {
            if (signal?.aborted) throw cancelledFailure("validate");
            if (failed) {
              results.push(
                skippedResult(check, normalized, inspection.identity),
              );
              continue;
            }
            const result = await runValidationCheck(
              check,
              normalized,
              inspection.identity,
              signal,
            );
            results.push(result);
            failed = result.status !== "passed";
          }

          return {
            candidateRevision: request.candidateRevision,
            contractRevision: request.contractRevision,
            status: failed ? "failed" : "passed",
            totalDurationMs: elapsed(normalized, startedAt),
            checks: results,
            artifacts: [],
          };
        } catch (error) {
          if (error instanceof InvalidRequest) {
            throw requestFailure("validate");
          }
          throw error;
        } finally {
          active = false;
        }
      },
      context,
    );

  return Object.freeze({
    ...identity,
    validate,
  });
}

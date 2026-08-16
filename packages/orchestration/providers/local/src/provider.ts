import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  INFRASTRUCTURE_CAPABILITIES,
  type InfrastructureOperationMap,
  type InfrastructureProvider,
  type ProviderArtifact,
  ProviderError,
  type ProviderReference,
  type ProviderRequestContext,
  executeProviderOperation,
} from "@reef/orchestrator";

export const LOCAL_INFRASTRUCTURE_PROVIDER_ID = "local" as const;
export const LOCAL_INFRASTRUCTURE_PROVIDER_VERSION = "0.1.0" as const;

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TERMINATION_TIMEOUT_MS = 1_000;
const MAX_TERMINATION_TIMEOUT_MS = 30_000;
const MAX_COMMAND_LENGTH = 64 * 1024;
const MAX_TARGET_LENGTH = 256;
const MAX_REVISION_LENGTH = 4_096;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENVIRONMENT_VALUE_LENGTH = 8_192;
const GIT_OUTPUT_BYTES = 64 * 1024;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;

const gitEnvironment = Object.freeze({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
});

export interface LocalBootstrapContext {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type LocalBootstrapHook = (
  context: LocalBootstrapContext,
) => Promise<void> | void;

export interface LocalInfrastructureProviderOptions {
  /** The target string accepted by provision. */
  readonly target: string;
  /** The user's primary checkout. */
  readonly repositoryRoot: string;
  /** A provider-owned directory outside the primary checkout. */
  readonly managedWorkRoot: string;
  /** A revision expected to resolve to a local commit during provision. */
  readonly baseRevision: string;
  /** The complete environment passed to caller commands. */
  readonly environment: Readonly<Record<string, string>>;
  /** Optional one-shot hydration performed inside each new worktree. */
  readonly bootstrap?: LocalBootstrapHook;
  /** Maximum bytes retained independently for stdout and stderr. */
  readonly maxOutputBytes?: number;
  /** Grace period for SIGTERM before SIGKILL during cancellation/cleanup. */
  readonly terminationTimeoutMs?: number;
}

export interface LocalCommandOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export type LocalExecResult = InfrastructureOperationMap["exec"]["result"] &
  LocalCommandOutput;

export type LocalCollectResult =
  InfrastructureOperationMap["collect"]["result"] & LocalCommandOutput;

/** Private composition data for callers that already own the resource. */
export interface LocalWorkspaceDescriptor {
  readonly cwd: string;
  readonly revision: string;
  readonly clean: boolean;
}

export interface LocalInfrastructureProvider extends InfrastructureProvider {
  exec(
    input: InfrastructureOperationMap["exec"]["input"],
    context: ProviderRequestContext,
  ): Promise<LocalExecResult>;
  collect(
    input: InfrastructureOperationMap["collect"]["input"],
    context: ProviderRequestContext,
  ): Promise<LocalCollectResult>;
  describe(
    input: { readonly resource: ProviderReference },
    context: ProviderRequestContext,
  ): Promise<LocalWorkspaceDescriptor>;
}

interface NormalizedOptions {
  readonly target: string;
  readonly repositoryRoot: string;
  readonly managedWorkRoot: string;
  readonly baseRevision: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly bootstrap?: LocalBootstrapHook;
  readonly maxOutputBytes: number;
  readonly terminationTimeoutMs: number;
}

interface RepositoryIdentity {
  readonly rootPath: string;
  readonly commonGitPath: string;
}

interface ManagedRootInspection {
  readonly configuredPath: string;
  readonly realPath?: string;
  readonly exists: boolean;
  readonly created: boolean;
}

interface BoundedBufferSnapshot {
  readonly value: string;
  readonly truncated: boolean;
}

class BoundedBuffer {
  private readonly chunks: Buffer[] = [];
  private length = 0;
  private wasTruncated = false;

  constructor(private readonly maximumBytes: number) {}

  append(value: Buffer | string): void {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.byteLength === 0) return;
    const remaining = this.maximumBytes - this.length;
    if (remaining <= 0) {
      this.wasTruncated = true;
      return;
    }
    if (chunk.byteLength > remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.length = this.maximumBytes;
      this.wasTruncated = true;
      return;
    }
    this.chunks.push(chunk);
    this.length += chunk.byteLength;
  }

  snapshot(): BoundedBufferSnapshot {
    return {
      value: Buffer.concat(this.chunks).toString("utf8"),
      truncated: this.wasTruncated,
    };
  }
}

interface ChildResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnFailed: boolean;
  readonly stdout: BoundedBufferSnapshot;
  readonly stderr: BoundedBufferSnapshot;
}

interface ChildHandle {
  readonly child: ChildProcess;
  readonly stdout: BoundedBuffer;
  readonly stderr: BoundedBuffer;
  readonly closed: Promise<ChildResult>;
  readonly isSettled: () => boolean;
  readonly terminate: () => Promise<boolean>;
}

interface ActiveCommand {
  readonly handle: ChildHandle;
  finished: Promise<ChildResult>;
  cancelled: boolean;
  termination: Promise<boolean> | undefined;
}

interface LastExecution extends LocalCommandOutput {
  readonly exitCode: number;
}

type ResourcePhase = "idle" | "cancelled" | "cleanup_pending" | "cleaned";

interface ResourceState {
  readonly name: string;
  readonly repository: RepositoryIdentity;
  readonly managedRootPath: string;
  readonly managedRootRealPath: string;
  readonly managedRootCreated: boolean;
  readonly worktreePath: string;
  readonly worktreeRealPath: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly terminationTimeoutMs: number;
  currentRevision: string;
  phase: ResourcePhase;
  activeCommand: ActiveCommand | undefined;
  lastExecution: LastExecution | undefined;
}

class RejectedOperation extends Error {
  constructor() {
    super("local_infrastructure_operation_rejected");
    this.name = "RejectedOperation";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMissing = (error: unknown): boolean =>
  isRecord(error) && error.code === "ENOENT";

const isWithin = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." &&
      !path.startsWith(`..${sep}`) &&
      !isAbsolute(path) &&
      !WINDOWS_ABSOLUTE_PATH.test(path))
  );
};

const isAbsoluteInput = (value: string): boolean =>
  isAbsolute(value) ||
  WINDOWS_ABSOLUTE_PATH.test(value) ||
  value.startsWith("\\\\");

const metadataFor = (operation: string) => ({
  kind: "infrastructure" as const,
  providerId: LOCAL_INFRASTRUCTURE_PROVIDER_ID,
  operation,
});

const requestFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "request", false);

const protocolFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "protocol", false);

const spawnFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "spawn", false);

const cancelledFailure = (operation: string): ProviderError =>
  ProviderError.cancelled(metadataFor(operation));

const rejectOperation = (): never => {
  throw new RejectedOperation();
};

const assertActive = (
  signal: AbortSignal | undefined,
  operation: string,
): void => {
  if (signal?.aborted) throw cancelledFailure(operation);
};

const positiveInteger = (
  value: unknown,
  fallback: number,
  maximum: number,
): number => {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new Error("invalid_positive_integer");
  }
  return value;
};

const normalizeAbsolutePath = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\u0000") ||
    !isAbsoluteInput(value)
  ) {
    throw new Error("invalid_absolute_path");
  }
  return resolve(value);
};

const normalizeToken = (value: unknown, maximum: number): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /\s/u.test(value) ||
    value.includes("\u0000")
  ) {
    throw new Error("invalid_token");
  }
  return value;
};

const normalizeRevision = (value: unknown): string =>
  normalizeToken(value, MAX_REVISION_LENGTH);

const normalizeEnvironment = (
  value: unknown,
): Readonly<Record<string, string>> => {
  if (!isRecord(value)) throw new Error("invalid_environment");
  const entries = Object.entries(value);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw new Error("invalid_environment");
  }
  const environment: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ||
      key.includes("\u0000") ||
      typeof entry !== "string" ||
      entry.includes("\u0000") ||
      entry.length > MAX_ENVIRONMENT_VALUE_LENGTH
    ) {
      throw new Error("invalid_environment");
    }
    environment[key] = entry;
  }
  return Object.freeze(environment);
};

const normalizeOptions = (
  options: LocalInfrastructureProviderOptions,
): NormalizedOptions => {
  try {
    if (!isRecord(options)) throw new Error("invalid_options");
    const bootstrap = options.bootstrap;
    if (bootstrap !== undefined && typeof bootstrap !== "function") {
      throw new Error("invalid_bootstrap");
    }
    return Object.freeze({
      target: normalizeToken(options.target, MAX_TARGET_LENGTH),
      repositoryRoot: normalizeAbsolutePath(options.repositoryRoot),
      managedWorkRoot: normalizeAbsolutePath(options.managedWorkRoot),
      baseRevision: normalizeRevision(options.baseRevision),
      environment: normalizeEnvironment(options.environment),
      ...(bootstrap === undefined ? {} : { bootstrap }),
      maxOutputBytes: positiveInteger(
        options.maxOutputBytes,
        DEFAULT_MAX_OUTPUT_BYTES,
        MAX_OUTPUT_BYTES,
      ),
      terminationTimeoutMs: positiveInteger(
        options.terminationTimeoutMs,
        DEFAULT_TERMINATION_TIMEOUT_MS,
        MAX_TERMINATION_TIMEOUT_MS,
      ),
    });
  } catch {
    throw ProviderError.classified(
      metadataFor("create"),
      "configuration",
      false,
    );
  }
};

const waitForSettled = async (
  closed: Promise<ChildResult>,
  isSettled: () => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  if (isSettled()) return true;
  await Promise.race([
    closed,
    new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, timeoutMs);
    }),
  ]);
  return isSettled();
};

const startChild = (input: {
  readonly file: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: boolean;
  readonly detached: boolean;
  readonly maximumOutputBytes: number;
  readonly terminationTimeoutMs: number;
}): ChildHandle => {
  const stdout = new BoundedBuffer(input.maximumOutputBytes);
  const stderr = new BoundedBuffer(input.maximumOutputBytes);
  const child = spawn(input.file, [...(input.args ?? [])], {
    cwd: input.cwd,
    detached: input.detached,
    env: { ...input.environment },
    shell: input.shell,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout === null || child.stderr === null) {
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
    child.once("close", (exitCode, signal) => {
      settled = true;
      resolvePromise({
        exitCode,
        signal,
        spawnFailed,
        stdout: stdout.snapshot(),
        stderr: stderr.snapshot(),
      });
    });
  });

  let termination: Promise<boolean> | undefined;
  const sendSignal = (signal: NodeJS.Signals): void => {
    if (settled) return;
    try {
      if (
        input.detached &&
        process.platform !== "win32" &&
        typeof child.pid === "number" &&
        child.pid > 0
      ) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // The child can exit between the settled check and the signal call.
    }
  };
  const terminate = async (): Promise<boolean> => {
    if (termination !== undefined) return termination;
    termination = (async () => {
      if (settled) return true;
      sendSignal("SIGTERM");
      if (
        await waitForSettled(closed, () => settled, input.terminationTimeoutMs)
      ) {
        return true;
      }
      sendSignal("SIGKILL");
      return waitForSettled(closed, () => settled, input.terminationTimeoutMs);
    })();
    return termination;
  };

  return {
    child,
    stdout,
    stderr,
    closed,
    isSettled: () => settled,
    terminate,
  };
};

const runChild = async (input: {
  readonly file: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: boolean;
  readonly detached: boolean;
  readonly maximumOutputBytes: number;
  readonly terminationTimeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly operation: string;
}): Promise<ChildResult> => {
  assertActive(input.signal, input.operation);
  let handle: ChildHandle;
  try {
    handle = startChild(input);
  } catch {
    throw spawnFailure(input.operation);
  }

  let abortTermination: Promise<boolean> | undefined;
  let resolveAbort: ((value: boolean) => void) | undefined;
  const abortCompleted = new Promise<boolean>((resolvePromise) => {
    resolveAbort = resolvePromise;
  });
  const onAbort = (): void => {
    abortTermination = handle.terminate();
    void abortTermination.then((value) => resolveAbort?.(value));
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) onAbort();

  const result = await Promise.race([
    handle.closed.then((value) => ({ kind: "closed" as const, value })),
    abortCompleted.then((value) => ({ kind: "terminated" as const, value })),
  ]);
  input.signal?.removeEventListener("abort", onAbort);

  if (result.kind === "terminated") {
    if (!result.value) throw protocolFailure(input.operation);
    await handle.closed;
  } else if (input.signal?.aborted) {
    throw cancelledFailure(input.operation);
  }
  if (input.signal?.aborted) throw cancelledFailure(input.operation);
  return result.kind === "closed" ? result.value : await handle.closed;
};

const runGit = async (input: {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly operation: string;
  readonly signal: AbortSignal | undefined;
  readonly failure: "request" | "protocol";
}): Promise<string> => {
  const result = await runChild({
    file: "git",
    args: input.args,
    cwd: input.cwd,
    environment: gitEnvironment,
    shell: false,
    detached: false,
    maximumOutputBytes: GIT_OUTPUT_BYTES,
    terminationTimeoutMs: DEFAULT_TERMINATION_TIMEOUT_MS,
    signal: input.signal,
    operation: input.operation,
  });
  if (result.spawnFailed) throw spawnFailure(input.operation);
  if (result.exitCode !== 0) {
    if (input.failure === "request") throw requestFailure(input.operation);
    throw protocolFailure(input.operation);
  }
  return result.stdout.value;
};

const canonicalPathFromGit = async (
  cwd: string,
  value: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string> => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes("\u0000")) {
    throw requestFailure(operation);
  }
  try {
    return await realpath(
      isAbsoluteInput(trimmed) ? trimmed : resolve(cwd, trimmed),
    );
  } catch {
    throw requestFailure(operation);
  }
};

const inspectRepository = async (
  repositoryRoot: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<RepositoryIdentity> => {
  assertActive(signal, operation);
  let rootPath: string;
  try {
    const entry = await lstat(repositoryRoot);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("invalid_repository_root");
    }
    rootPath = await realpath(repositoryRoot);
  } catch {
    throw requestFailure(operation);
  }

  const topLevel = await runGit({
    cwd: rootPath,
    args: ["rev-parse", "--show-toplevel"],
    operation,
    signal,
    failure: "request",
  });
  const topLevelPath = await canonicalPathFromGit(
    rootPath,
    topLevel,
    operation,
    signal,
  );
  if (topLevelPath !== rootPath) throw requestFailure(operation);

  const bare = (
    await runGit({
      cwd: rootPath,
      args: ["rev-parse", "--is-bare-repository"],
      operation,
      signal,
      failure: "request",
    })
  ).trim();
  if (bare !== "false") throw requestFailure(operation);

  const commonGit = await runGit({
    cwd: rootPath,
    args: ["rev-parse", "--git-common-dir"],
    operation,
    signal,
    failure: "request",
  });
  const commonGitPath = await canonicalPathFromGit(
    rootPath,
    commonGit,
    operation,
    signal,
  );
  return { rootPath, commonGitPath };
};

const findExistingAncestor = async (
  candidate: string,
  operation: string,
): Promise<{ readonly path: string; readonly realPath: string }> => {
  let current = candidate;
  while (true) {
    try {
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw requestFailure(operation);
      }
      const realPath = await realpath(current);
      return { path: current, realPath };
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw requestFailure(operation);
      current = parent;
    }
  }
};

const inspectManagedRoot = async (
  configuredPath: string,
  repository: RepositoryIdentity,
  operation: string,
  signal: AbortSignal | undefined,
  allowMissing: boolean,
): Promise<ManagedRootInspection> => {
  assertActive(signal, operation);
  const absolutePath = resolve(configuredPath);
  if (isWithin(repository.rootPath, absolutePath)) {
    throw requestFailure(operation);
  }

  try {
    const entry = await lstat(absolutePath);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw requestFailure(operation);
    }
    const realPath = await realpath(absolutePath);
    if (isWithin(repository.rootPath, realPath)) {
      throw requestFailure(operation);
    }
    return {
      configuredPath: absolutePath,
      realPath,
      exists: true,
      created: false,
    };
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  if (!allowMissing) throw requestFailure(operation);
  const ancestor = await findExistingAncestor(absolutePath, operation);
  if (
    isWithin(repository.rootPath, ancestor.path) ||
    isWithin(repository.rootPath, ancestor.realPath)
  ) {
    throw requestFailure(operation);
  }
  return {
    configuredPath: absolutePath,
    exists: false,
    created: false,
  };
};

const createManagedRoot = async (
  inspection: ManagedRootInspection,
  repository: RepositoryIdentity,
  operation: string,
): Promise<ManagedRootInspection> => {
  if (inspection.exists) return inspection;
  try {
    await mkdir(inspection.configuredPath, { recursive: true });
    const entry = await lstat(inspection.configuredPath);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("invalid_managed_root");
    }
    const realPath = await realpath(inspection.configuredPath);
    if (isWithin(repository.rootPath, realPath)) {
      throw new Error("invalid_managed_root");
    }
    return {
      configuredPath: inspection.configuredPath,
      realPath,
      exists: true,
      created: true,
    };
  } catch {
    throw protocolFailure(operation);
  }
};

const resolveCommit = async (
  repository: RepositoryIdentity,
  revision: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string> => {
  const output = await runGit({
    cwd: repository.rootPath,
    args: ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
    operation,
    signal,
    failure: "request",
  });
  const commit = output.trim();
  if (!/^[0-9a-f]{40,64}$/u.test(commit)) throw requestFailure(operation);
  return commit;
};

const worktreePathFromList = (output: string): string[] =>
  output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

const listWorktrees = async (
  repository: RepositoryIdentity,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string[]> => {
  const output = await runGit({
    cwd: repository.rootPath,
    args: ["worktree", "list", "--porcelain"],
    operation,
    signal,
    failure: "protocol",
  });
  return worktreePathFromList(output);
};

const readWorktreeState = async (
  state: ResourceState,
  operation: string,
  signal: AbortSignal | undefined,
  requireDetached: boolean,
): Promise<{ readonly head: string; readonly exists: boolean }> => {
  const root = await inspectManagedRoot(
    state.managedRootPath,
    state.repository,
    operation,
    signal,
    true,
  );
  if (!root.exists || root.realPath !== state.managedRootRealPath) {
    throw requestFailure(operation);
  }
  if (!isWithin(root.realPath, state.worktreePath)) {
    throw requestFailure(operation);
  }

  let actualPath: string;
  try {
    actualPath = await realpath(state.worktreePath);
    const entry = await stat(actualPath);
    if (!entry.isDirectory()) throw new Error("invalid_worktree_path");
  } catch {
    throw requestFailure(operation);
  }
  if (actualPath !== state.worktreeRealPath) throw requestFailure(operation);

  const topLevel = await runGit({
    cwd: actualPath,
    args: ["rev-parse", "--show-toplevel"],
    operation,
    signal,
    failure: "request",
  });
  const topLevelPath = await canonicalPathFromGit(
    actualPath,
    topLevel,
    operation,
    signal,
  );
  if (topLevelPath !== state.worktreeRealPath) throw requestFailure(operation);

  const commonGit = await runGit({
    cwd: actualPath,
    args: ["rev-parse", "--git-common-dir"],
    operation,
    signal,
    failure: "request",
  });
  const commonGitPath = await canonicalPathFromGit(
    actualPath,
    commonGit,
    operation,
    signal,
  );
  if (commonGitPath !== state.repository.commonGitPath) {
    throw requestFailure(operation);
  }

  if (requireDetached) {
    const branch = (
      await runGit({
        cwd: actualPath,
        args: ["rev-parse", "--abbrev-ref", "HEAD"],
        operation,
        signal,
        failure: "request",
      })
    ).trim();
    if (branch !== "HEAD") throw requestFailure(operation);
  }

  const head = (
    await runGit({
      cwd: actualPath,
      args: ["rev-parse", "--verify", "HEAD^{commit}"],
      operation,
      signal,
      failure: "request",
    })
  ).trim();
  if (!/^[0-9a-f]{40,64}$/u.test(head)) throw requestFailure(operation);
  return { head, exists: true };
};

const assertRepositoryUnchanged = async (
  options: NormalizedOptions,
  expected: RepositoryIdentity,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<void> => {
  const actual = await inspectRepository(
    options.repositoryRoot,
    operation,
    signal,
  );
  if (
    actual.rootPath !== expected.rootPath ||
    actual.commonGitPath !== expected.commonGitPath
  ) {
    throw requestFailure(operation);
  }
};

const validateReference = (
  resources: Map<string, ResourceState>,
  resource: ProviderReference,
  operation: string,
  allowCleaned: boolean,
): ResourceState => {
  if (
    !isRecord(resource) ||
    typeof resource.name !== "string" ||
    typeof resource.revision !== "string" ||
    resource.uri !== undefined
  ) {
    throw requestFailure(operation);
  }
  const state = resources.get(resource.name);
  if (
    state === undefined ||
    resource.revision !== state.currentRevision ||
    (state.phase === "cleaned" && !allowCleaned)
  ) {
    throw requestFailure(operation);
  }
  return state;
};

const referenceFor = (state: ResourceState): ProviderReference => ({
  name: state.name,
  revision: state.currentRevision,
});

const assertReady = async (
  options: NormalizedOptions,
  state: ResourceState,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<void> => {
  assertActive(signal, operation);
  if (state.phase !== "idle" || state.activeCommand !== undefined) {
    throw requestFailure(operation);
  }
  await assertRepositoryUnchanged(options, state.repository, operation, signal);
  const worktree = await readWorktreeState(state, operation, signal, true);
  if (worktree.head !== state.currentRevision) throw requestFailure(operation);
};

const removeOwnedWorktree = async (
  state: ResourceState,
  operation: string,
  removeUnregisteredPath = true,
): Promise<void> => {
  try {
    const repository = await inspectRepository(
      state.repository.rootPath,
      operation,
      undefined,
    );
    if (
      repository.rootPath !== state.repository.rootPath ||
      repository.commonGitPath !== state.repository.commonGitPath
    ) {
      throw requestFailure(operation);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw protocolFailure(operation);
  }

  try {
    const entry = await lstat(state.worktreePath);
    if (entry.isSymbolicLink()) throw requestFailure(operation);
    const actualPath = await realpath(state.worktreePath);
    if (
      actualPath !== state.worktreeRealPath ||
      !isWithin(state.managedRootRealPath, actualPath)
    ) {
      throw requestFailure(operation);
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  let registered = false;
  try {
    const worktrees = await listWorktrees(
      state.repository,
      operation,
      undefined,
    );
    registered = worktrees.some((candidate) => {
      try {
        return resolve(candidate) === state.worktreePath;
      } catch {
        return false;
      }
    });
  } catch {
    throw protocolFailure(operation);
  }

  if (registered) {
    try {
      await runGit({
        cwd: state.repository.rootPath,
        args: ["worktree", "remove", "--force", "--", state.worktreePath],
        operation,
        signal: undefined,
        failure: "protocol",
      });
    } catch {
      throw protocolFailure(operation);
    }
  }

  if (registered || removeUnregisteredPath) {
    try {
      const entry = await lstat(state.worktreePath);
      if (entry.isSymbolicLink()) throw new Error("worktree_path_symlink");
      const actualPath = await realpath(state.worktreePath);
      if (
        actualPath !== state.worktreeRealPath ||
        !isWithin(state.managedRootRealPath, actualPath)
      ) {
        throw new Error("worktree_path_drift");
      }
      await rm(state.worktreePath, { force: true, recursive: true });
    } catch (error) {
      if (!isMissing(error)) throw protocolFailure(operation);
    }
  }

  try {
    await lstat(state.worktreePath);
    throw protocolFailure(operation);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  try {
    const worktrees = await listWorktrees(
      state.repository,
      operation,
      undefined,
    );
    if (
      worktrees.some((candidate) => {
        try {
          return resolve(candidate) === state.worktreePath;
        } catch {
          return false;
        }
      })
    ) {
      throw protocolFailure(operation);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw protocolFailure(operation);
  }
};

const removeCreatedRootIfEmpty = async (
  root: ManagedRootInspection,
  repository: RepositoryIdentity,
): Promise<void> => {
  if (!root.created || root.realPath === undefined) return;
  if (isWithin(repository.rootPath, root.realPath)) return;
  try {
    const entries = await readdir(root.realPath);
    if (entries.length === 0)
      await rm(root.realPath, { recursive: false, force: true });
  } catch {
    // Cleanup is best effort after a failed provision. The main failure remains
    // normalized and does not expose filesystem details.
  }
};

const removeCreatedManagedRoot = async (
  state: ResourceState,
  operation: string,
): Promise<void> => {
  if (!state.managedRootCreated) return;
  try {
    const entry = await lstat(state.managedRootPath);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw requestFailure(operation);
    }
    const actualPath = await realpath(state.managedRootPath);
    if (actualPath !== state.managedRootRealPath) {
      throw requestFailure(operation);
    }
    if ((await readdir(actualPath)).length === 0) {
      await rm(actualPath, { recursive: false, force: true });
    }
  } catch (error) {
    if (isMissing(error)) return;
    if (error instanceof ProviderError) throw error;
    throw protocolFailure(operation);
  }
};

const outputFromResult = (result: ChildResult): LocalCommandOutput => ({
  stdout: result.stdout.value,
  stderr: result.stderr.value,
  stdoutTruncated: result.stdout.truncated,
  stderrTruncated: result.stderr.truncated,
});

export function createLocalInfrastructureProvider(
  options: LocalInfrastructureProviderOptions,
): LocalInfrastructureProvider {
  const normalized = normalizeOptions(options);
  const identity = Object.freeze({
    kind: "infrastructure" as const,
    id: LOCAL_INFRASTRUCTURE_PROVIDER_ID,
    version: LOCAL_INFRASTRUCTURE_PROVIDER_VERSION,
    capabilities: INFRASTRUCTURE_CAPABILITIES,
  });
  const resources = new Map<string, ResourceState>();

  const run = <Result>(
    operation: string,
    context: ProviderRequestContext,
    action: (signal: AbortSignal | undefined) => Promise<Result>,
    capability = operation,
  ): Promise<Result> =>
    executeProviderOperation(
      identity,
      capability,
      operation,
      async ({ signal }) => {
        try {
          return await action(signal);
        } catch (error) {
          if (error instanceof RejectedOperation)
            throw requestFailure(operation);
          if (error instanceof ProviderError) throw error;
          throw protocolFailure(operation);
        }
      },
      context,
    );

  const provision = (
    input: InfrastructureOperationMap["provision"]["input"],
    context: ProviderRequestContext,
  ): Promise<{ readonly resource: ProviderReference }> =>
    run("provision", context, async (signal) => {
      assertActive(signal, "provision");
      if (input.target !== normalized.target) rejectOperation();

      const repository = await inspectRepository(
        normalized.repositoryRoot,
        "provision",
        signal,
      );
      const rootInspection = await inspectManagedRoot(
        normalized.managedWorkRoot,
        repository,
        "provision",
        signal,
        true,
      );
      const baseCommit = await resolveCommit(
        repository,
        normalized.baseRevision,
        "provision",
        signal,
      );
      assertActive(signal, "provision");
      const managedRoot = await createManagedRoot(
        rootInspection,
        repository,
        "provision",
      );
      const worktreePath = join(
        managedRoot.realPath ?? managedRoot.configuredPath,
        `.local-${randomUUID()}`,
      );
      if (
        !isWithin(
          managedRoot.realPath ?? managedRoot.configuredPath,
          worktreePath,
        )
      ) {
        throw protocolFailure("provision");
      }

      let worktreeWasCreated = false;
      try {
        try {
          await lstat(worktreePath);
          throw requestFailure("provision");
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        await runGit({
          cwd: repository.rootPath,
          args: ["worktree", "add", "--detach", worktreePath, baseCommit],
          operation: "provision",
          signal,
          failure: "protocol",
        });
        worktreeWasCreated = true;
        const worktreeRealPath = await realpath(worktreePath);
        if (worktreeRealPath !== worktreePath)
          throw new Error("worktree_symlink");
        const provisional: ResourceState = {
          name: `local-${randomUUID()}`,
          repository,
          managedRootPath: managedRoot.realPath ?? managedRoot.configuredPath,
          managedRootRealPath:
            managedRoot.realPath ?? managedRoot.configuredPath,
          managedRootCreated: managedRoot.created,
          worktreePath,
          worktreeRealPath,
          environment: normalized.environment,
          terminationTimeoutMs: normalized.terminationTimeoutMs,
          currentRevision: baseCommit,
          phase: "idle",
          activeCommand: undefined,
          lastExecution: undefined,
        };
        const initialWorktree = await readWorktreeState(
          provisional,
          "provision",
          signal,
          true,
        );
        if (initialWorktree.head !== baseCommit) {
          throw new Error("unexpected_base_revision");
        }
        resources.set(provisional.name, provisional);

        if (normalized.bootstrap !== undefined) {
          const bootstrapSignal = signal ?? new AbortController().signal;
          assertActive(signal, "provision");
          try {
            await normalized.bootstrap({
              cwd: worktreeRealPath,
              environment: normalized.environment,
              signal: bootstrapSignal,
            });
          } catch (error) {
            provisional.phase = signal?.aborted
              ? "cancelled"
              : "cleanup_pending";
            throw error;
          }
          assertActive(signal, "provision");
          const afterBootstrap = await readWorktreeState(
            provisional,
            "provision",
            signal,
            true,
          );
          if (afterBootstrap.head !== baseCommit) {
            provisional.phase = "cleanup_pending";
            throw new Error("bootstrap_changed_revision");
          }
        }
        return { resource: referenceFor(provisional) };
      } catch (error) {
        const state = [...resources.values()].find(
          (candidate) => candidate.worktreePath === worktreePath,
        );
        if (state !== undefined) resources.delete(state.name);
        try {
          const cleanupState: ResourceState = state ?? {
            name: `cleanup-${randomUUID()}`,
            repository,
            managedRootPath: managedRoot.realPath ?? managedRoot.configuredPath,
            managedRootRealPath:
              managedRoot.realPath ?? managedRoot.configuredPath,
            managedRootCreated: managedRoot.created,
            worktreePath,
            worktreeRealPath: worktreePath,
            environment: normalized.environment,
            terminationTimeoutMs: normalized.terminationTimeoutMs,
            currentRevision: baseCommit,
            phase: "cleanup_pending",
            activeCommand: undefined,
            lastExecution: undefined,
          };
          await removeOwnedWorktree(
            cleanupState,
            "provision",
            worktreeWasCreated,
          );
        } catch {
          // The original normalized provider failure is still the public result.
        }
        await removeCreatedRootIfEmpty(managedRoot, repository);
        if (error instanceof ProviderError) throw error;
        if (signal?.aborted) throw cancelledFailure("provision");
        throw protocolFailure("provision");
      }
    });

  const exec = (
    input: InfrastructureOperationMap["exec"]["input"],
    context: ProviderRequestContext,
  ): Promise<LocalExecResult> =>
    run("exec", context, async (signal) => {
      assertActive(signal, "exec");
      if (
        typeof input.command !== "string" ||
        input.command.length === 0 ||
        input.command.length > MAX_COMMAND_LENGTH ||
        input.command.includes("\u0000")
      ) {
        rejectOperation();
      }
      const state = validateReference(resources, input.resource, "exec", false);
      await assertReady(normalized, state, "exec", signal);

      let cwd = state.worktreeRealPath;
      if (input.cwd !== undefined) {
        if (
          typeof input.cwd !== "string" ||
          input.cwd.length === 0 ||
          input.cwd.includes("\u0000") ||
          isAbsoluteInput(input.cwd) ||
          input.cwd.split(/[\\/]/u).some((part) => part === "..")
        ) {
          rejectOperation();
        }
        const lexicalCwd = resolve(state.worktreeRealPath, input.cwd);
        if (!isWithin(state.worktreeRealPath, lexicalCwd)) rejectOperation();
        try {
          const realCwd = await realpath(lexicalCwd);
          const entry = await stat(realCwd);
          if (
            !entry.isDirectory() ||
            !isWithin(state.worktreeRealPath, realCwd)
          ) {
            rejectOperation();
          }
          cwd = realCwd;
        } catch {
          rejectOperation();
        }
      }
      assertActive(signal, "exec");

      let handle: ChildHandle;
      try {
        handle = startChild({
          file: input.command,
          cwd,
          environment: state.environment,
          shell: true,
          detached: process.platform !== "win32",
          maximumOutputBytes: normalized.maxOutputBytes,
          terminationTimeoutMs: state.terminationTimeoutMs,
        });
      } catch {
        throw spawnFailure("exec");
      }
      const active: ActiveCommand = {
        handle,
        finished: handle.closed,
        cancelled: false,
        termination: undefined,
      };
      state.activeCommand = active;
      let abortTermination: Promise<boolean> | undefined;
      let resolveAbort: ((value: boolean) => void) | undefined;
      const abortCompleted = new Promise<boolean>((resolvePromise) => {
        resolveAbort = resolvePromise;
      });
      const terminate = (): Promise<boolean> => {
        active.cancelled = true;
        if (active.termination === undefined) {
          active.termination = active.handle.terminate();
        }
        return active.termination;
      };
      const onAbort = (): void => {
        abortTermination = terminate();
        void abortTermination.then((value) => resolveAbort?.(value));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();

      try {
        const result = await Promise.race([
          active.finished.then((value) => ({
            kind: "finished" as const,
            value,
          })),
          abortCompleted.then((value) => ({
            kind: "terminated" as const,
            value,
          })),
        ]);
        if (result.kind === "terminated") {
          if (!result.value) throw protocolFailure("exec");
          await active.finished;
        }
        if (active.cancelled || signal?.aborted) {
          state.phase = "cancelled";
          throw cancelledFailure("exec");
        }
        const output = outputFromResult(
          result.kind === "finished" ? result.value : await active.finished,
        );
        if (result.kind === "finished" && result.value.spawnFailed) {
          throw spawnFailure("exec");
        }
        const exitCode =
          (result.kind === "finished"
            ? result.value.exitCode
            : (await active.finished).exitCode) ?? -1;
        const execution: LastExecution = { exitCode, ...output };
        state.lastExecution = execution;
        return execution;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (state.activeCommand === active) state.activeCommand = undefined;
      }
    });

  const sync = (
    input: InfrastructureOperationMap["sync"]["input"],
    context: ProviderRequestContext,
  ): Promise<{
    readonly resource: ProviderReference;
    readonly revision: string;
  }> =>
    run("sync", context, async (signal) => {
      assertActive(signal, "sync");
      const state = validateReference(resources, input.resource, "sync", false);
      await assertReady(normalized, state, "sync", signal);
      const targetRevision = (() => {
        try {
          return normalizeRevision(input.revision);
        } catch {
          return rejectOperation();
        }
      })();
      const targetCommit = await resolveCommit(
        state.repository,
        targetRevision,
        "sync",
        signal,
      );
      assertActive(signal, "sync");
      await runGit({
        cwd: state.worktreeRealPath,
        args: ["reset", "--hard", targetCommit],
        operation: "sync",
        signal,
        failure: "protocol",
      });
      const synced = await readWorktreeState(state, "sync", signal, true);
      if (synced.head !== targetCommit) throw protocolFailure("sync");
      state.currentRevision = targetCommit;
      state.lastExecution = undefined;
      return { resource: referenceFor(state), revision: targetCommit };
    });

  const collect = (
    input: InfrastructureOperationMap["collect"]["input"],
    context: ProviderRequestContext,
  ): Promise<LocalCollectResult> =>
    run("collect", context, async (signal) => {
      const state = validateReference(
        resources,
        input.resource,
        "collect",
        false,
      );
      await assertReady(normalized, state, "collect", signal);
      const lastExecution = state.lastExecution;
      return {
        artifacts: [] as readonly ProviderArtifact[],
        stdout: lastExecution?.stdout ?? "",
        stderr: lastExecution?.stderr ?? "",
        stdoutTruncated: lastExecution?.stdoutTruncated ?? false,
        stderrTruncated: lastExecution?.stderrTruncated ?? false,
      };
    });

  const describe = (
    input: { readonly resource: ProviderReference },
    context: ProviderRequestContext,
  ): Promise<LocalWorkspaceDescriptor> =>
    run(
      "describe",
      context,
      async (signal) => {
        assertActive(signal, "describe");
        const state = validateReference(
          resources,
          input.resource,
          "describe",
          false,
        );
        if (state.phase !== "idle" || state.activeCommand !== undefined) {
          throw requestFailure("describe");
        }
        await assertRepositoryUnchanged(
          normalized,
          state.repository,
          "describe",
          signal,
        );
        const worktree = await readWorktreeState(
          state,
          "describe",
          signal,
          false,
        );
        const status = await runGit({
          cwd: state.worktreeRealPath,
          args: ["status", "--porcelain=v1", "--untracked-files=all"],
          operation: "describe",
          signal,
          failure: "request",
        });
        return Object.freeze({
          cwd: state.worktreeRealPath,
          revision: worktree.head,
          clean: status.trim().length === 0,
        });
      },
      "collect",
    );

  const cleanup = (
    input: InfrastructureOperationMap["cleanup"]["input"],
    context: ProviderRequestContext,
  ): Promise<{ readonly cleaned: boolean }> =>
    run("cleanup", context, async (signal) => {
      assertActive(signal, "cleanup");
      const state = validateReference(
        resources,
        input.resource,
        "cleanup",
        true,
      );
      if (state.phase === "cleaned") return { cleaned: true };
      await assertRepositoryUnchanged(
        normalized,
        state.repository,
        "cleanup",
        signal,
      );

      const active = state.activeCommand;
      if (active !== undefined) {
        state.phase = "cancelled";
        active.cancelled = true;
        if (active.termination === undefined) {
          active.termination = active.handle.terminate();
        }
        const terminated = await active.termination;
        if (!terminated) {
          state.phase = "cleanup_pending";
          throw protocolFailure("cleanup");
        }
        try {
          await active.finished;
        } catch {
          // The active command's public result is superseded by cleanup.
        }
      }

      try {
        const root = await inspectManagedRoot(
          state.managedRootPath,
          state.repository,
          "cleanup",
          signal,
          true,
        );
        if (root.exists && root.realPath !== state.managedRootRealPath) {
          throw requestFailure("cleanup");
        }
        if (root.exists) {
          let pathExists = true;
          try {
            await lstat(state.worktreePath);
          } catch (error) {
            if (isMissing(error)) pathExists = false;
            else throw error;
          }
          if (pathExists) {
            await readWorktreeState(state, "cleanup", signal, false);
          }
        } else {
          try {
            await lstat(state.worktreePath);
            throw requestFailure("cleanup");
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw protocolFailure("cleanup");
      }

      try {
        await removeOwnedWorktree(state, "cleanup");
        await removeCreatedManagedRoot(state, "cleanup");
      } catch {
        state.phase = "cleanup_pending";
        throw protocolFailure("cleanup");
      }
      state.phase = "cleaned";
      state.activeCommand = undefined;
      return { cleaned: true };
    });

  return {
    ...identity,
    provision,
    exec,
    sync,
    collect,
    describe,
    cleanup,
  };
}

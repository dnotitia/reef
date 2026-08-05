import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { type Interface, createInterface } from "node:readline";
import {
  HARNESS_CAPABILITIES,
  type HarnessExecutionPolicy,
  type HarnessInput,
  type HarnessObservation,
  type HarnessObservationEvent,
  type HarnessProvider,
  type HarnessStartInput,
  type HarnessState,
  type HarnessTerminalOutcome,
  ProviderError,
  type ProviderErrorJson,
  type ProviderReference,
  type ProviderRequestContext,
  normalizeProviderError,
} from "@reef/orchestrator";
import {
  type CodexMessage,
  type FinalOutput,
  type JsonRpcId,
  type JsonRpcResponse,
  approvalRequestParamsSchema,
  deltaParamsSchema,
  errorNotificationParamsSchema,
  finalOutputFromItems,
  itemLifecycleParamsSchema,
  parseJsonLine,
  protocolValue,
  responseEnvelopeSchema,
  threadResultSchema,
  threadStatusChangedParamsSchema,
  turnCompletedParamsSchema,
  turnResultSchema,
  turnStartedParamsSchema,
  userInputRequestParamsSchema,
} from "./protocol.js";

export const CODEX_HARNESS_PROVIDER_ID = "codex" as const;
export const CODEX_HARNESS_PROVIDER_VERSION = "0.1.0" as const;

const APP_SERVER_ARGUMENTS = ["app-server", "--listen", "stdio://"] as const;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_EVENTS = 64;
const MAX_INSTRUCTION_LENGTH = 64_000;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENVIRONMENT_VALUE_LENGTH = 8_192;
const MAX_ANSWER_LENGTH = 4_096;

const finalOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: ["completed", "validation_requested", "blocked", "failed"],
    },
    summary: { type: "string", minLength: 1, maxLength: 512 },
  },
  required: ["intent", "summary"],
} as const;

export interface CodexHarnessProviderOptions {
  readonly executable: string;
  readonly model?: string;
  readonly handshakeTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly maxEvents?: number;
}

interface NormalizedOptions {
  readonly executable: string;
  readonly model?: string;
  readonly handshakeTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly maxEvents: number;
}

interface ValidatedContext {
  readonly executable: string;
  readonly repositoryCwd: string;
  readonly gitRoot: string;
  readonly executionPolicy: HarnessExecutionPolicy;
}

type RequestPhase = "handshake" | "request";

interface PendingRpc {
  readonly key: string;
  readonly phase: RequestPhase;
  readonly operation: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: ProviderError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

type ServerRequestKind =
  | "user_input"
  | "command"
  | "file"
  | "network"
  | "permission"
  | "unsupported";

type ApprovalKind = Exclude<ServerRequestKind, "user_input">;

interface PendingServerRequest {
  readonly id: JsonRpcId;
  readonly kind: ServerRequestKind;
  readonly questionIds?: readonly string[];
}

interface Session {
  readonly child: ChildProcessWithoutNullStreams;
  readonly reader: Interface;
  readonly closed: Promise<void>;
  readonly context: ValidatedContext;
  readonly maxEvents: number;
  readonly pendingRpc: Map<string, PendingRpc>;
  readonly pendingServerRequests: Map<string, PendingServerRequest>;
  readonly completedTurnIds: Set<string>;
  readonly events: HarnessObservationEvent[];
  transition: Promise<void>;
  threadId: string | null;
  activeTurnId: string | null;
  nextRequestId: number;
  revision: number;
  state: HarnessState;
  finalOutput: FinalOutput | null;
  terminalEmitted: boolean;
  stopping: boolean;
  processExited: boolean;
  failure: ProviderError | null;
}

const metadataFor = (operation: string) => ({
  kind: "harness" as const,
  providerId: CODEX_HARNESS_PROVIDER_ID,
  operation,
});

const classified = (
  operation: string,
  code:
    | "configuration"
    | "spawn"
    | "handshake"
    | "protocol"
    | "timeout"
    | "session"
    | "request"
    | "unexpected-exit",
  retryable = false,
): ProviderError =>
  ProviderError.classified(metadataFor(operation), code, retryable);

const cancelled = (operation: string): ProviderError =>
  ProviderError.cancelled(metadataFor(operation));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const optionNumber = (
  value: number | undefined,
  fallback: number,
  maximum: number,
): number => {
  if (value === undefined) return fallback;
  if (!isPositiveInteger(value) || value > maximum) {
    throw classified("create", "configuration");
  }
  return value;
};

const normalizeOptions = (
  options: CodexHarnessProviderOptions,
): NormalizedOptions => {
  if (!isObject(options) || typeof options.executable !== "string") {
    throw classified("create", "configuration");
  }
  const executable = options.executable.trim();
  if (executable.length === 0 || executable.includes("\u0000")) {
    throw classified("create", "configuration");
  }
  if (
    options.model !== undefined &&
    (options.model.trim().length === 0 || /\s/.test(options.model))
  ) {
    throw classified("create", "configuration");
  }
  return {
    executable,
    ...(options.model ? { model: options.model } : {}),
    handshakeTimeoutMs: optionNumber(
      options.handshakeTimeoutMs,
      DEFAULT_HANDSHAKE_TIMEOUT_MS,
      120_000,
    ),
    requestTimeoutMs: optionNumber(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      120_000,
    ),
    shutdownTimeoutMs: optionNumber(
      options.shutdownTimeoutMs,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
      30_000,
    ),
    maxEvents: optionNumber(options.maxEvents, DEFAULT_MAX_EVENTS, 1_024),
  };
};

const safeText = (value: string, maximum: number): string => {
  const bounded = value.slice(0, maximum);
  const redacted = bounded
    .replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(
      /((?:api[_-]?key|token|secret|password|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted]");
  return redacted.length > 0 ? redacted : "codex_event";
};

const safeSummary = (value: string): string => safeText(value.trim(), 512);

const isWithin = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
};

const findGitRoot = async (directory: string): Promise<string | null> => {
  let current = directory;
  while (true) {
    try {
      await stat(join(current, ".git"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
};

const normalizeEnvironment = (
  environment: unknown,
): Readonly<Record<string, string>> => {
  if (environment === undefined) return {};
  if (!isObject(environment)) throw classified("start", "configuration");
  const entries = Object.entries(environment);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw classified("start", "configuration");
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.includes("\u0000")) {
      throw classified("start", "configuration");
    }
    if (
      typeof value !== "string" ||
      value.includes("\u0000") ||
      value.length > MAX_ENVIRONMENT_VALUE_LENGTH
    ) {
      throw classified("start", "configuration");
    }
    normalized[key] = value;
  }
  return normalized;
};

const resolveExecutable = async (
  configured: string,
  environment: Readonly<Record<string, string>>,
  operation: string,
): Promise<string> => {
  if (isAbsolute(configured)) {
    try {
      await access(configured, constants.X_OK);
      return configured;
    } catch {
      throw classified(operation, "configuration");
    }
  }

  if (configured.includes("/") || configured.includes("\\")) {
    throw classified(operation, "configuration");
  }
  const pathValue = environment.PATH;
  if (!pathValue) throw classified(operation, "configuration");
  for (const entry of pathValue.split(sep)) {
    if (!entry) continue;
    const candidate = join(entry, configured);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the caller-provided PATH only.
    }
  }
  throw classified(operation, "configuration");
};

const validateContext = async (
  input: HarnessStartInput,
  options: NormalizedOptions,
  operation: "start" | "resume",
): Promise<ValidatedContext> => {
  if (
    typeof input.repositoryCwd !== "string" ||
    !isAbsolute(input.repositoryCwd)
  ) {
    throw classified(operation, "configuration");
  }
  if (
    typeof input.workUri !== "string" ||
    input.workUri.length === 0 ||
    input.workUri.length > 2_048 ||
    /\s/.test(input.workUri) ||
    input.workUri.includes("\u0000")
  ) {
    throw classified(operation, "configuration");
  }
  try {
    const parsedUri = new URL(input.workUri);
    if (!parsedUri.protocol || !parsedUri.hostname) {
      throw new Error("invalid_uri");
    }
  } catch {
    throw classified(operation, "configuration");
  }
  if (
    typeof input.instruction !== "string" ||
    input.instruction.trim().length === 0 ||
    input.instruction.length > MAX_INSTRUCTION_LENGTH ||
    input.instruction.includes("\u0000")
  ) {
    throw classified(operation, "configuration");
  }

  const repositoryCwd = await realpath(input.repositoryCwd).catch(() => {
    throw classified(operation, "configuration");
  });
  const cwdStats = await stat(repositoryCwd).catch(() => null);
  if (!cwdStats?.isDirectory()) throw classified(operation, "configuration");
  const gitRoot = await findGitRoot(repositoryCwd);
  if (!gitRoot) throw classified(operation, "configuration");

  const policy = input.executionPolicy;
  if (!isObject(policy) || typeof policy.networkAccess !== "boolean") {
    throw classified(operation, "configuration");
  }
  if (
    policy.sandboxMode !== "read-only" &&
    policy.sandboxMode !== "workspace-write" &&
    policy.sandboxMode !== "danger-full-access"
  ) {
    throw classified(operation, "configuration");
  }
  if (
    policy.approvalMode !== "never" &&
    policy.approvalMode !== "on-request" &&
    policy.approvalMode !== "untrusted"
  ) {
    throw classified(operation, "configuration");
  }
  if (!Array.isArray(policy.writableRoots)) {
    throw classified(operation, "configuration");
  }
  if (policy.sandboxMode === "read-only" && policy.writableRoots.length > 0) {
    throw classified(operation, "configuration");
  }
  if (
    policy.sandboxMode === "workspace-write" &&
    policy.writableRoots.length === 0
  ) {
    throw classified(operation, "configuration");
  }
  if (
    policy.sandboxMode === "danger-full-access" &&
    policy.writableRoots.length > 0
  ) {
    throw classified(operation, "configuration");
  }

  const writableRoots: string[] = [];
  const seenRoots = new Set<string>();
  for (const root of policy.writableRoots) {
    if (typeof root !== "string" || !isAbsolute(root)) {
      throw classified(operation, "configuration");
    }
    const resolvedRoot = await realpath(root).catch(() => {
      throw classified(operation, "configuration");
    });
    const rootStats = await stat(resolvedRoot).catch(() => null);
    if (!rootStats?.isDirectory() || !isWithin(gitRoot, resolvedRoot)) {
      throw classified(operation, "configuration");
    }
    if (seenRoots.has(resolvedRoot))
      throw classified(operation, "configuration");
    seenRoots.add(resolvedRoot);
    writableRoots.push(resolvedRoot);
  }

  const environment = normalizeEnvironment(policy.environment);
  const executable = await resolveExecutable(
    options.executable,
    environment,
    operation,
  );
  return {
    executable,
    repositoryCwd,
    gitRoot,
    executionPolicy: {
      sandboxMode: policy.sandboxMode,
      writableRoots,
      networkAccess: policy.networkAccess,
      approvalMode: policy.approvalMode,
      environment,
    },
  };
};

const sandboxPolicyFor = (context: ValidatedContext) => {
  const policy = context.executionPolicy;
  if (policy.sandboxMode === "read-only") {
    return { type: "readOnly" as const, networkAccess: policy.networkAccess };
  }
  if (policy.sandboxMode === "danger-full-access") {
    return { type: "dangerFullAccess" as const };
  }
  return {
    type: "workspaceWrite" as const,
    writableRoots: [...policy.writableRoots],
    networkAccess: policy.networkAccess,
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
  };
};

const textInput = (text: string) => ({
  type: "text" as const,
  text,
  text_elements: [],
});

const sessionReference = (session: Session): ProviderReference => {
  if (!session.threadId) throw classified("session", "session");
  return { name: session.threadId, revision: String(session.revision) };
};

const requestKey = (id: JsonRpcId): string => String(id);

const enqueueEvent = (
  session: Session,
  event: HarnessObservationEvent,
): void => {
  if (session.events.length >= session.maxEvents) session.events.shift();
  session.events.push(Object.freeze(event));
};

const errorSummary = (error: ProviderError): string => {
  switch (error.code) {
    case "cancelled":
      return "codex_operation_cancelled";
    case "configuration":
      return "codex_configuration_failed";
    case "spawn":
      return "codex_process_spawn_failed";
    case "handshake":
      return "codex_handshake_failed";
    case "protocol":
      return "codex_protocol_failed";
    case "timeout":
      return "codex_request_timed_out";
    case "session":
      return "codex_session_invalid";
    case "request":
      return "codex_request_rejected";
    case "unexpected-exit":
      return "codex_process_exited_unexpectedly";
    case "unsupported_capability":
      return "codex_capability_unsupported";
  }
};

const jsonRpcError = (error: ProviderError): ProviderErrorJson =>
  error.toJSON();

const enqueueTerminal = (
  session: Session,
  outcome: HarnessTerminalOutcome,
  summary: string,
  error?: ProviderError,
): void => {
  if (session.terminalEmitted) return;
  session.terminalEmitted = true;
  session.state = outcome === "failed" ? "failed" : "ready";
  enqueueEvent(session, {
    type: "terminal",
    outcome,
    summary: safeSummary(summary),
    ...(error ? { error: jsonRpcError(error) } : {}),
  });
};

const failSession = (session: Session, error: ProviderError): void => {
  if (session.failure || session.stopping) return;
  session.failure = error;
  session.state = "failed";
  for (const pending of session.pendingRpc.values()) {
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.onAbort ?? (() => {}));
    pending.reject(error);
  }
  session.pendingRpc.clear();
  enqueueTerminal(session, "failed", errorSummary(error), error);
  void terminateProcess(session, DEFAULT_SHUTDOWN_TIMEOUT_MS);
};

const ensureThread = (
  session: Session,
  threadId: string,
  operation: string,
): void => {
  if (session.threadId !== threadId) {
    throw classified(operation, "protocol");
  }
};

const parseResponse = (message: CodexMessage): JsonRpcResponse => {
  if (message.type !== "response") throw new Error("expected_response");
  return protocolValue(responseEnvelopeSchema, message.value);
};

const sendJson = (session: Session, value: unknown): Promise<void> => {
  if (
    session.stopping ||
    session.processExited ||
    !session.child.stdin.writable
  ) {
    throw classified("transport", "session");
  }
  const line = `${JSON.stringify(value)}\n`;
  return new Promise((resolve, reject) => {
    session.child.stdin.write(line, "utf8", (error?: Error | null) => {
      if (error) reject(classified("transport", "protocol"));
      else resolve();
    });
  });
};

const sendNotification = async (
  session: Session,
  method: string,
  params: unknown,
): Promise<void> => {
  await sendJson(session, { method, params });
};

const rpcRequest = (
  session: Session,
  operation: string,
  method: string,
  params: unknown,
  signal: AbortSignal | undefined,
  phase: RequestPhase,
  timeoutMs: number,
): Promise<unknown> => {
  if (signal?.aborted) return Promise.reject(cancelled(operation));
  if (session.stopping || session.processExited) {
    return Promise.reject(classified(operation, "session"));
  }
  const id = session.nextRequestId++;
  const key = requestKey(id);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: ProviderError, value?: unknown): void => {
      if (settled) return;
      settled = true;
      const pending = session.pendingRpc.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        signal?.removeEventListener("abort", pending.onAbort ?? (() => {}));
        session.pendingRpc.delete(key);
      }
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = (): void => finish(cancelled(operation));
    const timer = setTimeout(() => {
      finish(
        classified(
          operation,
          phase === "handshake" ? "handshake" : "timeout",
          true,
        ),
      );
    }, timeoutMs);
    const pending: PendingRpc = {
      key,
      phase,
      operation,
      resolve: (value) => finish(undefined, value),
      reject: (error) => finish(error),
      timer,
      signal,
      onAbort,
    };
    session.pendingRpc.set(key, pending);
    signal?.addEventListener("abort", onAbort, { once: true });
    void sendJson(session, { method, id, params }).catch(() => {
      finish(classified(operation, "protocol"));
    });
  });
};

const handleResponse = (session: Session, message: CodexMessage): void => {
  let response: JsonRpcResponse;
  try {
    response = parseResponse(message);
  } catch {
    failSession(session, classified("transport", "protocol"));
    return;
  }
  const pending = session.pendingRpc.get(requestKey(response.id));
  if (!pending) {
    failSession(session, classified("transport", "protocol"));
    return;
  }
  if (response.error !== undefined) {
    pending.reject(
      classified(
        pending.operation,
        pending.phase === "handshake" ? "handshake" : "request",
        false,
      ),
    );
    return;
  }
  pending.resolve(response.result);
};

const requestServerError = async (
  session: Session,
  request: PendingServerRequest,
): Promise<void> => {
  await sendJson(session, {
    id: request.id,
    error: { code: -32000, message: "request_not_supported" },
  });
};

const classifyApproval = (
  method: string,
  params: Record<string, unknown>,
): ApprovalKind => {
  if (method === "item/commandExecution/requestApproval") {
    return params.networkApprovalContext ? "network" : "command";
  }
  if (method === "item/fileChange/requestApproval") return "file";
  if (method === "item/permissions/requestApproval") return "permission";
  return "unsupported";
};

const handleServerRequest = (session: Session, message: CodexMessage): void => {
  if (message.type !== "request") return;
  const requestId = requestKey(message.id);
  if (session.pendingServerRequests.has(requestId)) {
    failSession(session, classified("transport", "protocol"));
    return;
  }
  if (message.method === "item/tool/requestUserInput") {
    const parsed = userInputRequestParamsSchema.safeParse(message.params);
    if (!parsed.success) {
      failSession(session, classified("transport", "protocol"));
      return;
    }
    try {
      ensureThread(session, parsed.data.threadId, "transport");
    } catch (error) {
      failSession(
        session,
        error instanceof ProviderError
          ? error
          : classified("transport", "protocol"),
      );
      return;
    }
    const questions = parsed.data.questions.map((question) => ({
      id: question.id,
      question: safeText(question.question, 1_024),
      choices: (question.options ?? []).map((option) => ({
        label: safeText(option.label, 256),
        description: safeText(option.description, 512),
      })),
    }));
    session.pendingServerRequests.set(requestId, {
      id: message.id,
      kind: "user_input",
      questionIds: questions.map((question) => question.id),
    });
    enqueueEvent(session, {
      type: "user_input_request",
      requestId,
      questions,
    });
    return;
  }

  const parsed = approvalRequestParamsSchema.safeParse(message.params);
  const params = parsed.success ? parsed.data : null;
  const kind = classifyApproval(
    message.method,
    isObject(message.params) ? message.params : {},
  );
  if (!params && kind !== "unsupported") {
    failSession(session, classified("transport", "protocol"));
    return;
  }
  if (params) {
    try {
      ensureThread(session, params.threadId, "transport");
    } catch (error) {
      failSession(
        session,
        error instanceof ProviderError
          ? error
          : classified("transport", "protocol"),
      );
      return;
    }
  }
  session.pendingServerRequests.set(requestId, { id: message.id, kind });
  enqueueEvent(session, {
    type: "approval_blocked",
    requestId,
    approval: kind,
    reason:
      kind === "command"
        ? "codex_command_approval_required"
        : kind === "file"
          ? "codex_file_approval_required"
          : kind === "network"
            ? "codex_network_approval_required"
            : kind === "permission"
              ? "codex_permission_approval_required"
              : "codex_request_not_supported",
  });
};

const handleTurnCompleted = (session: Session, params: unknown): void => {
  const parsed = turnCompletedParamsSchema.safeParse(params);
  if (!parsed.success) {
    failSession(session, classified("observe", "protocol"));
    return;
  }
  try {
    ensureThread(session, parsed.data.threadId, "observe");
  } catch (error) {
    failSession(
      session,
      error instanceof ProviderError
        ? error
        : classified("observe", "protocol"),
    );
    return;
  }
  const turnId = parsed.data.turn.id;
  if (session.activeTurnId && session.activeTurnId !== turnId) {
    failSession(session, classified("observe", "protocol"));
    return;
  }
  session.completedTurnIds.add(turnId);
  const output =
    finalOutputFromItems(parsed.data.turn.items) ?? session.finalOutput;
  session.finalOutput = null;
  session.activeTurnId = null;
  if (parsed.data.turn.status === "interrupted") {
    if (output) {
      failSession(session, classified("observe", "protocol"));
      return;
    }
    enqueueTerminal(session, "interrupted", "codex_turn_interrupted");
    return;
  }
  if (parsed.data.turn.status === "failed") {
    if (output) {
      failSession(session, classified("observe", "protocol"));
      return;
    }
    const error = classified("observe", "request");
    enqueueTerminal(session, "failed", "codex_turn_failed", error);
    session.state = "failed";
    return;
  }
  if (!output) {
    failSession(session, classified("observe", "protocol"));
    return;
  }
  const summary = safeSummary(output.summary);
  switch (output.intent) {
    case "completed":
      enqueueTerminal(session, "completed", summary);
      return;
    case "validation_requested":
      enqueueEvent(session, { type: "validation_request", summary });
      enqueueTerminal(session, "validation_requested", summary);
      return;
    case "blocked":
      enqueueTerminal(session, "blocked", summary);
      return;
    case "failed": {
      const error = classified("observe", "request");
      enqueueTerminal(session, "failed", summary, error);
      session.state = "failed";
      return;
    }
  }
};

const handleNotification = (session: Session, message: CodexMessage): void => {
  if (message.type !== "notification") return;
  try {
    switch (message.method) {
      case "thread/started": {
        const result = protocolValue(threadResultSchema, message.params);
        if (session.threadId && session.threadId !== result.thread.id) {
          throw classified("observe", "protocol");
        }
        session.threadId = result.thread.id;
        enqueueEvent(session, { type: "progress", summary: "thread_started" });
        return;
      }
      case "thread/status/changed": {
        const params = protocolValue(
          threadStatusChangedParamsSchema,
          message.params,
        );
        ensureThread(session, params.threadId, "observe");
        if (params.status.type === "active") session.state = "running";
        if (params.status.type === "idle") session.state = "ready";
        if (params.status.type === "systemError") {
          failSession(session, classified("observe", "request"));
          return;
        }
        enqueueEvent(session, {
          type: "progress",
          summary: `thread_${params.status.type}`,
        });
        return;
      }
      case "turn/started": {
        const params = protocolValue(turnStartedParamsSchema, message.params);
        ensureThread(session, params.threadId, "observe");
        session.activeTurnId = params.turn.id;
        session.finalOutput = null;
        session.terminalEmitted = false;
        session.state = "running";
        enqueueEvent(session, { type: "progress", summary: "turn_started" });
        return;
      }
      case "item/started": {
        const params = protocolValue(itemLifecycleParamsSchema, message.params);
        ensureThread(session, params.threadId, "observe");
        enqueueEvent(session, {
          type: "progress",
          summary: "item_started",
        });
        return;
      }
      case "item/completed": {
        const params = protocolValue(itemLifecycleParamsSchema, message.params);
        ensureThread(session, params.threadId, "observe");
        const item = params.item as Record<string, unknown>;
        if (item.type === "agentMessage" && typeof item.text === "string") {
          session.finalOutput =
            finalOutputFromItems([item]) ?? session.finalOutput;
        }
        enqueueEvent(session, {
          type: "progress",
          summary: "item_completed",
        });
        return;
      }
      case "item/agentMessage/delta":
      case "item/plan/delta": {
        const params = protocolValue(deltaParamsSchema, message.params);
        ensureThread(session, params.threadId, "observe");
        enqueueEvent(session, {
          type: "progress",
          summary:
            message.method === "item/plan/delta"
              ? "plan_updated"
              : "agent_message_updated",
        });
        return;
      }
      case "turn/plan/updated": {
        const params = message.params;
        if (
          !isObject(params) ||
          typeof params.threadId !== "string" ||
          typeof params.turnId !== "string"
        ) {
          throw classified("observe", "protocol");
        }
        ensureThread(session, params.threadId, "observe");
        enqueueEvent(session, { type: "progress", summary: "plan_updated" });
        return;
      }
      case "turn/completed":
        handleTurnCompleted(session, message.params);
        return;
      case "error": {
        const params = protocolValue(
          errorNotificationParamsSchema,
          message.params,
        );
        ensureThread(session, params.threadId, "observe");
        if (params.willRetry) {
          enqueueEvent(session, {
            type: "progress",
            summary: "codex_error_retrying",
          });
          return;
        }
        failSession(session, classified("observe", "request"));
        return;
      }
      default:
        return;
    }
  } catch (error) {
    failSession(
      session,
      error instanceof ProviderError
        ? error
        : classified("observe", "protocol"),
    );
  }
};

const handleMessage = (session: Session, line: string): void => {
  if (session.stopping) return;
  let message: CodexMessage;
  try {
    message = parseJsonLine(line);
  } catch {
    failSession(session, classified("transport", "protocol"));
    return;
  }
  if (message.type === "response") handleResponse(session, message);
  else if (message.type === "request") handleServerRequest(session, message);
  else handleNotification(session, message);
};

const createSession = (
  child: ChildProcessWithoutNullStreams,
  context: ValidatedContext,
  maxEvents: number,
): Session => {
  const reader = createInterface({ input: child.stdout });
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const session: Session = {
    child,
    reader,
    closed,
    context,
    maxEvents,
    pendingRpc: new Map(),
    pendingServerRequests: new Map(),
    completedTurnIds: new Set(),
    events: [],
    transition: Promise.resolve(),
    threadId: null,
    activeTurnId: null,
    nextRequestId: 1,
    revision: 1,
    state: "starting",
    finalOutput: null,
    terminalEmitted: false,
    stopping: false,
    processExited: false,
    failure: null,
  };
  reader.on("line", (line) => handleMessage(session, line));
  child.stderr.on("data", () => {
    // Drain stderr so a noisy child cannot block. Raw stderr never leaves the process.
  });
  child.once("error", () => {
    if (!session.stopping) {
      failSession(session, classified("transport", "spawn"));
    }
  });
  child.once("close", () => {
    session.processExited = true;
    resolveClosed();
    if (!session.stopping && !session.failure) {
      failSession(session, classified("transport", "unexpected-exit", true));
    }
  });
  return session;
};

const terminateProcess = async (
  session: Session,
  timeoutMs: number,
): Promise<void> => {
  if (session.processExited) return;
  session.stopping = true;
  session.reader.close();
  for (const pending of session.pendingRpc.values()) {
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.onAbort ?? (() => {}));
    pending.reject(classified(pending.operation, "session"));
  }
  session.pendingRpc.clear();
  session.pendingServerRequests.clear();
  try {
    session.child.stdin.end();
  } catch {
    // The process may already have closed its stdin.
  }
  try {
    session.child.kill("SIGTERM");
  } catch {
    // The process may have exited between the state check and kill.
  }
  await Promise.race([
    session.closed,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  if (!session.processExited) {
    try {
      session.child.kill("SIGKILL");
    } catch {
      // Best-effort bounded cleanup.
    }
    await Promise.race([
      session.closed,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
};

const openConnection = async (
  context: ValidatedContext,
  options: NormalizedOptions,
  signal: AbortSignal | undefined,
  operation: "start" | "resume",
): Promise<Session> => {
  if (signal?.aborted) throw cancelled(operation);
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(context.executable, [...APP_SERVER_ARGUMENTS], {
      cwd: context.repositoryCwd,
      env: { ...context.executionPolicy.environment },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
  } catch {
    throw classified(operation, "spawn");
  }
  const session = createSession(child, context, options.maxEvents);
  try {
    await rpcRequest(
      session,
      operation,
      "initialize",
      {
        clientInfo: {
          name: "reef_harness_provider_codex",
          title: "Reef Codex Harness Provider",
          version: CODEX_HARNESS_PROVIDER_VERSION,
        },
        capabilities: null,
      },
      signal,
      "handshake",
      options.handshakeTimeoutMs,
    );
    await sendNotification(session, "initialized", {});
  } catch (error) {
    await terminateProcess(session, options.shutdownTimeoutMs);
    if (error instanceof ProviderError) throw error;
    throw normalizeProviderError(error, metadataFor(operation), signal);
  }
  return session;
};

const threadStart = async (
  session: Session,
  options: NormalizedOptions,
  signal: AbortSignal | undefined,
): Promise<void> => {
  const params = {
    ...(options.model ? { model: options.model } : {}),
    cwd: session.context.repositoryCwd,
    approvalPolicy: session.context.executionPolicy.approvalMode,
    sandbox: session.context.executionPolicy.sandboxMode,
  };
  const result = await rpcRequest(
    session,
    "start",
    "thread/start",
    params,
    signal,
    "request",
    options.requestTimeoutMs,
  );
  const parsed = protocolValue(threadResultSchema, result);
  session.threadId = parsed.thread.id;
};

const threadResume = async (
  session: Session,
  threadId: string,
  options: NormalizedOptions,
  signal: AbortSignal | undefined,
): Promise<void> => {
  const result = await rpcRequest(
    session,
    "resume",
    "thread/resume",
    {
      threadId,
      ...(options.model ? { model: options.model } : {}),
      cwd: session.context.repositoryCwd,
      approvalPolicy: session.context.executionPolicy.approvalMode,
      sandbox: session.context.executionPolicy.sandboxMode,
    },
    signal,
    "request",
    options.requestTimeoutMs,
  );
  const parsed = protocolValue(threadResultSchema, result);
  if (parsed.thread.id !== threadId) throw classified("resume", "protocol");
  session.threadId = threadId;
  session.state = "ready";
};

const startTurn = async (
  session: Session,
  instruction: string,
  options: NormalizedOptions,
  signal: AbortSignal | undefined,
): Promise<void> => {
  if (!session.threadId) throw classified("start", "session");
  session.finalOutput = null;
  session.terminalEmitted = false;
  session.state = "running";
  const result = await rpcRequest(
    session,
    "sendInput",
    "turn/start",
    {
      threadId: session.threadId,
      input: [textInput(instruction)],
      cwd: session.context.repositoryCwd,
      approvalPolicy: session.context.executionPolicy.approvalMode,
      sandboxPolicy: sandboxPolicyFor(session.context),
      outputSchema: finalOutputJsonSchema,
    },
    signal,
    "request",
    options.requestTimeoutMs,
  );
  const parsed = protocolValue(turnResultSchema, result);
  if (!session.completedTurnIds.has(parsed.turn.id)) {
    session.activeTurnId = parsed.turn.id;
    session.state = "running";
  }
};

const serialize = <T>(
  session: Session,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = session.transition;
  const next = previous.then(operation, operation);
  session.transition = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

const validateReference = (
  reference: ProviderReference,
  operation: string,
): { readonly threadId: string; readonly revision: number } => {
  if (
    !isObject(reference) ||
    typeof reference.name !== "string" ||
    reference.name.length === 0 ||
    /\s/.test(reference.name) ||
    reference.name.includes("\u0000") ||
    typeof reference.revision !== "string" ||
    !/^\d+$/.test(reference.revision) ||
    !Number.isSafeInteger(Number(reference.revision)) ||
    Number(reference.revision) < 1
  ) {
    throw classified(operation, "session");
  }
  return { threadId: reference.name, revision: Number(reference.revision) };
};

const getSession = (
  sessions: Map<string, Session>,
  reference: ProviderReference,
  operation: string,
  allowClosed = false,
): Session => {
  const parsed = validateReference(reference, operation);
  const session = sessions.get(parsed.threadId);
  if (
    !session ||
    (!allowClosed && (session.stopping || session.processExited))
  ) {
    throw classified(operation, "session");
  }
  if (session.revision !== parsed.revision)
    throw classified(operation, "session");
  return session;
};

const answerUserInput = async (
  session: Session,
  input: Extract<HarnessInput, { readonly type: "user_input" }>,
): Promise<void> => {
  const pending = session.pendingServerRequests.get(input.requestId);
  if (!pending || pending.kind !== "user_input" || !pending.questionIds) {
    throw classified("sendInput", "request");
  }
  const answerKeys = Object.keys(input.answers);
  if (
    answerKeys.length !== pending.questionIds.length ||
    pending.questionIds.some((questionId) => !answerKeys.includes(questionId))
  ) {
    throw classified("sendInput", "request");
  }
  const answers: Record<string, { answers: string[] }> = {};
  for (const questionId of pending.questionIds) {
    const values = input.answers[questionId];
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.some(
        (value) =>
          typeof value !== "string" ||
          value.trim().length === 0 ||
          value.length > MAX_ANSWER_LENGTH,
      )
    ) {
      throw classified("sendInput", "request");
    }
    answers[questionId] = { answers: [...values] };
  }
  session.pendingServerRequests.delete(input.requestId);
  await sendJson(session, { id: pending.id, result: { answers } });
};

const approveRequest = async (
  session: Session,
  input: Extract<HarnessInput, { readonly type: "approval" }>,
): Promise<void> => {
  const pending = session.pendingServerRequests.get(input.requestId);
  if (!pending || pending.kind === "user_input") {
    throw classified("sendInput", "request");
  }
  if (
    input.decision === "accept" &&
    (pending.kind === "permission" || pending.kind === "unsupported")
  ) {
    throw classified("sendInput", "configuration");
  }
  session.pendingServerRequests.delete(input.requestId);
  if (pending.kind === "unsupported" || pending.kind === "permission") {
    await requestServerError(session, pending);
    return;
  }
  await sendJson(session, {
    id: pending.id,
    result: { decision: input.decision },
  });
};

const sendText = async (
  session: Session,
  text: string,
  options: NormalizedOptions,
  signal: AbortSignal | undefined,
): Promise<void> => {
  if (
    text.trim().length === 0 ||
    text.length > MAX_INSTRUCTION_LENGTH ||
    text.includes("\u0000")
  ) {
    throw classified("sendInput", "configuration");
  }
  if (session.pendingServerRequests.size > 0)
    throw classified("sendInput", "request");
  if (!session.threadId) throw classified("sendInput", "session");
  if (session.activeTurnId) {
    await rpcRequest(
      session,
      "sendInput",
      "turn/steer",
      {
        threadId: session.threadId,
        expectedTurnId: session.activeTurnId,
        input: [textInput(text)],
      },
      signal,
      "request",
      options.requestTimeoutMs,
    );
    return;
  }
  await startTurn(session, text, options, signal);
};

const interruptTurn = async (
  session: Session,
  options: NormalizedOptions,
  signal: AbortSignal | undefined,
): Promise<boolean> => {
  if (!session.threadId || !session.activeTurnId) return false;
  const turnId = session.activeTurnId;
  await rpcRequest(
    session,
    "interrupt",
    "turn/interrupt",
    { threadId: session.threadId, turnId },
    signal,
    "request",
    options.requestTimeoutMs,
  );
  return true;
};

const runOperation = async <T>(
  operation: string,
  context: ProviderRequestContext,
  action: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> => {
  try {
    if (context.signal?.aborted) throw cancelled(operation);
    return await action(context.signal);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw normalizeProviderError(error, metadataFor(operation), context.signal);
  }
};

export function createCodexHarnessProvider(
  options: CodexHarnessProviderOptions,
): HarnessProvider {
  const normalizedOptions = normalizeOptions(options);
  const sessions = new Map<string, Session>();
  const stoppedThreadIds = new Set<string>();

  const start = async (
    input: HarnessStartInput,
    context: ProviderRequestContext,
  ): Promise<{ readonly session: ProviderReference }> =>
    runOperation("start", context, async (signal) => {
      const validated = await validateContext(
        input,
        normalizedOptions,
        "start",
      );
      const session = await openConnection(
        validated,
        normalizedOptions,
        signal,
        "start",
      );
      try {
        await threadStart(session, normalizedOptions, signal);
        if (!session.threadId) throw classified("start", "protocol");
        if (sessions.has(session.threadId))
          throw classified("start", "session");
        sessions.set(session.threadId, session);
        await startTurn(session, input.instruction, normalizedOptions, signal);
        return { session: sessionReference(session) };
      } catch (error) {
        await terminateProcess(session, normalizedOptions.shutdownTimeoutMs);
        if (session.threadId && sessions.get(session.threadId) === session) {
          sessions.delete(session.threadId);
        }
        if (error instanceof ProviderError) throw error;
        throw normalizeProviderError(error, metadataFor("start"), signal);
      }
    });

  const observe = async (
    input: { readonly session: ProviderReference },
    context: ProviderRequestContext,
  ): Promise<HarnessObservation> =>
    runOperation("observe", context, async (signal) => {
      const session = getSession(sessions, input.session, "observe", true);
      return serialize(session, async () => {
        if (signal?.aborted) throw cancelled("observe");
        const events = session.events.splice(0, session.events.length);
        return { state: session.state, events };
      });
    });

  const sendInput = async (
    input: {
      readonly session: ProviderReference;
      readonly input: HarnessInput;
    },
    context: ProviderRequestContext,
  ): Promise<{ readonly accepted: boolean }> =>
    runOperation("sendInput", context, async (signal) => {
      const session = getSession(sessions, input.session, "sendInput");
      return serialize(session, async () => {
        if (signal?.aborted) throw cancelled("sendInput");
        switch (input.input.type) {
          case "text":
            await sendText(
              session,
              input.input.text,
              normalizedOptions,
              signal,
            );
            break;
          case "user_input":
            await answerUserInput(session, input.input);
            break;
          case "approval":
            await approveRequest(session, input.input);
            break;
        }
        return { accepted: true };
      });
    });

  const interrupt = async (
    input: { readonly session: ProviderReference },
    context: ProviderRequestContext,
  ): Promise<{ readonly interrupted: boolean }> =>
    runOperation("interrupt", context, async (signal) => {
      const session = getSession(sessions, input.session, "interrupt");
      return serialize(session, async () => ({
        interrupted: await interruptTurn(session, normalizedOptions, signal),
      }));
    });

  const resume = async (
    input: {
      readonly session: ProviderReference;
      readonly repositoryCwd: string;
      readonly executionPolicy: HarnessExecutionPolicy;
    },
    context: ProviderRequestContext,
  ): Promise<{ readonly session: ProviderReference }> =>
    runOperation("resume", context, async (signal) => {
      const reference = validateReference(input.session, "resume");
      if (sessions.has(reference.threadId))
        throw classified("resume", "session");
      const validated = await validateContext(
        {
          workUri: `codex://resume/${reference.threadId}`,
          instruction: "resume",
          repositoryCwd: input.repositoryCwd,
          executionPolicy: input.executionPolicy,
        },
        normalizedOptions,
        "resume",
      );
      const session = await openConnection(
        validated,
        normalizedOptions,
        signal,
        "resume",
      );
      session.revision = reference.revision + 1;
      try {
        await threadResume(
          session,
          reference.threadId,
          normalizedOptions,
          signal,
        );
        sessions.set(reference.threadId, session);
        stoppedThreadIds.delete(reference.threadId);
        return { session: sessionReference(session) };
      } catch (error) {
        await terminateProcess(session, normalizedOptions.shutdownTimeoutMs);
        if (error instanceof ProviderError) throw error;
        throw normalizeProviderError(error, metadataFor("resume"), signal);
      }
    });

  const stop = async (
    input: { readonly session: ProviderReference },
    context: ProviderRequestContext,
  ): Promise<{ readonly stopped: boolean }> =>
    runOperation("stop", context, async (signal) => {
      const reference = validateReference(input.session, "stop");
      const session = sessions.get(reference.threadId);
      if (!session) {
        if (stoppedThreadIds.has(reference.threadId)) return { stopped: true };
        throw classified("stop", "session");
      }
      return serialize(session, async () => {
        if (signal?.aborted) throw cancelled("stop");
        if (session.revision !== reference.revision)
          throw classified("stop", "session");
        if (session.activeTurnId) {
          try {
            await interruptTurn(session, normalizedOptions, undefined);
          } catch {
            // Stop is bounded best-effort after an interrupt request.
          }
        }
        await terminateProcess(session, normalizedOptions.shutdownTimeoutMs);
        session.state = "stopped";
        sessions.delete(reference.threadId);
        stoppedThreadIds.add(reference.threadId);
        return { stopped: true };
      });
    });

  return {
    kind: "harness",
    id: CODEX_HARNESS_PROVIDER_ID,
    version: CODEX_HARNESS_PROVIDER_VERSION,
    capabilities: HARNESS_CAPABILITIES,
    start,
    observe,
    sendInput,
    interrupt,
    resume,
    stop,
  };
}

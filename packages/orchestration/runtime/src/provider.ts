import { z } from "zod";

export const WORK_CAPABILITIES = [
  "read",
  "refresh",
  "transition",
  "report",
  "linkArtifact",
] as const;

export const HARNESS_CAPABILITIES = [
  "start",
  "observe",
  "sendInput",
  "interrupt",
  "resume",
  "stop",
] as const;

export const INFRASTRUCTURE_CAPABILITIES = [
  "provision",
  "exec",
  "sync",
  "collect",
  "cleanup",
] as const;

export const SCM_CAPABILITIES = [
  "readBase",
  "readRef",
  "createBranch",
  "commit",
  "push",
  "createDraftPullRequest",
  "collectArtifact",
] as const;

export const VALIDATION_CAPABILITIES = ["validate"] as const;

export const PROVIDER_KINDS = [
  "work",
  "harness",
  "infrastructure",
  "scm",
  "validation",
] as const;

export const PROVIDER_CAPABILITIES = {
  work: WORK_CAPABILITIES,
  harness: HARNESS_CAPABILITIES,
  infrastructure: INFRASTRUCTURE_CAPABILITIES,
  scm: SCM_CAPABILITIES,
  validation: VALIDATION_CAPABILITIES,
} as const;

export const ALL_PROVIDER_CAPABILITIES = [
  "read",
  "refresh",
  "transition",
  "report",
  "linkArtifact",
  "start",
  "observe",
  "sendInput",
  "interrupt",
  "resume",
  "stop",
  "provision",
  "exec",
  "sync",
  "collect",
  "cleanup",
  "readBase",
  "readRef",
  "createBranch",
  "commit",
  "push",
  "createDraftPullRequest",
  "collectArtifact",
  "validate",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type ProviderCapability = (typeof ALL_PROVIDER_CAPABILITIES)[number];
export type CapabilityForKind<K extends ProviderKind> =
  (typeof PROVIDER_CAPABILITIES)[K][number];

const capabilitySets: Record<ProviderKind, ReadonlySet<string>> = {
  work: new Set(WORK_CAPABILITIES),
  harness: new Set(HARNESS_CAPABILITIES),
  infrastructure: new Set(INFRASTRUCTURE_CAPABILITIES),
  scm: new Set(SCM_CAPABILITIES),
  validation: new Set(VALIDATION_CAPABILITIES),
};

export const ProviderCapabilitySchema = z.enum(ALL_PROVIDER_CAPABILITIES);
export const ProviderKindSchema = z.enum(PROVIDER_KINDS);

const providerTokenSchema = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .max(128, "must be at most 128 characters")
  .refine((value) => !/\s/.test(value), "must not contain whitespace");

export const ProviderIdentitySchema = z
  .object({
    kind: ProviderKindSchema,
    id: providerTokenSchema,
    version: providerTokenSchema,
    capabilities: z.array(ProviderCapabilitySchema),
  })
  .strict()
  .superRefine((provider, context) => {
    const seen = new Set<string>();
    provider.capabilities.forEach((capability, index) => {
      if (seen.has(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilities", index],
          message: `duplicate capability: ${capability}`,
        });
      }
      seen.add(capability);

      if (!capabilitySets[provider.kind].has(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilities", index],
          message: `capability ${capability} is not valid for provider kind ${provider.kind}`,
        });
      }
    });
  });

export interface ProviderIdentity<K extends ProviderKind = ProviderKind> {
  readonly kind: K;
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly CapabilityForKind<K>[];
}

export type ProviderSnapshot<K extends ProviderKind = ProviderKind> =
  ProviderIdentity<K>;

export interface ProviderRequestContext {
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
}

export type ArtifactKind =
  | "branch"
  | "commit"
  | "file"
  | "proof"
  | "pull_request"
  | "report";

export interface ProviderArtifact {
  readonly kind: ArtifactKind;
  readonly ref: string;
  readonly uri?: string;
  readonly title?: string;
}

export interface ProviderReference {
  readonly name: string;
  readonly revision: string;
  readonly uri?: string;
}

export interface WorkSnapshot {
  readonly uri: string;
  readonly revision: string;
  readonly provenance: {
    readonly source: string;
    readonly revision: string;
  };
}

export interface WorkReport {
  readonly uri: string;
  readonly revision: string;
  readonly outcome: "failed" | "pending" | "succeeded";
  readonly summary?: string;
}

export interface WorkOperationMap {
  read: { input: { readonly uri: string }; result: WorkSnapshot };
  refresh: {
    input: { readonly uri: string; readonly revision?: string };
    result: WorkSnapshot;
  };
  transition: {
    input: { readonly uri: string; readonly transition: string };
    result: WorkSnapshot;
  };
  report: { input: WorkReport; result: WorkReport };
  linkArtifact: {
    input: { readonly uri: string; readonly artifact: ProviderArtifact };
    result: ProviderArtifact;
  };
}

export type HarnessState =
  | "failed"
  | "ready"
  | "running"
  | "starting"
  | "stopped";

export type HarnessSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type HarnessApprovalMode = "never" | "on-request" | "untrusted";

export interface HarnessExecutionPolicy {
  readonly sandboxMode: HarnessSandboxMode;
  readonly writableRoots: readonly string[];
  readonly networkAccess: boolean;
  readonly approvalMode: HarnessApprovalMode;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface HarnessStartInput {
  readonly workUri: string;
  readonly instruction: string;
  readonly repositoryCwd: string;
  readonly executionPolicy: HarnessExecutionPolicy;
}

export interface HarnessUserInputOption {
  readonly label: string;
  readonly description: string;
}

export interface HarnessUserInputQuestion {
  readonly id: string;
  readonly question: string;
  readonly choices: readonly HarnessUserInputOption[];
}

export type HarnessInput =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "user_input";
      readonly requestId: string;
      readonly answers: Readonly<Record<string, readonly string[]>>;
    }
  | {
      readonly type: "approval";
      readonly requestId: string;
      readonly decision: "accept" | "decline" | "cancel";
    };

export type HarnessTerminalOutcome =
  | "completed"
  | "validation_requested"
  | "blocked"
  | "failed"
  | "interrupted";

export type HarnessObservationEvent =
  | { readonly type: "progress"; readonly summary: string }
  | {
      readonly type: "user_input_request";
      readonly requestId: string;
      readonly questions: readonly HarnessUserInputQuestion[];
    }
  | {
      readonly type: "approval_blocked";
      readonly requestId: string;
      readonly approval:
        | "command"
        | "file"
        | "network"
        | "permission"
        | "unsupported";
      readonly reason: string;
    }
  | { readonly type: "validation_request"; readonly summary: string }
  | {
      readonly type: "terminal";
      readonly outcome: HarnessTerminalOutcome;
      readonly summary: string;
      readonly error?: ProviderErrorJson;
    };

export interface HarnessObservation {
  readonly state: HarnessState;
  readonly events: readonly HarnessObservationEvent[];
}

export interface HarnessOperationMap {
  start: {
    input: HarnessStartInput;
    result: { readonly session: ProviderReference };
  };
  observe: {
    input: { readonly session: ProviderReference };
    result: HarnessObservation;
  };
  sendInput: {
    input: {
      readonly session: ProviderReference;
      readonly input: HarnessInput;
    };
    result: { readonly accepted: boolean };
  };
  interrupt: {
    input: { readonly session: ProviderReference };
    result: { readonly interrupted: boolean };
  };
  resume: {
    input: {
      readonly session: ProviderReference;
      readonly repositoryCwd: string;
      readonly executionPolicy: HarnessExecutionPolicy;
    };
    result: { readonly session: ProviderReference };
  };
  stop: {
    input: { readonly session: ProviderReference };
    result: { readonly stopped: boolean };
  };
}

export interface InfrastructureOperationMap {
  provision: {
    input: { readonly target: string };
    result: { readonly resource: ProviderReference };
  };
  exec: {
    input: {
      readonly resource: ProviderReference;
      readonly command: string;
      readonly cwd?: string;
    };
    result: { readonly exitCode: number; readonly artifact?: ProviderArtifact };
  };
  sync: {
    input: { readonly resource: ProviderReference; readonly revision: string };
    result: { readonly resource: ProviderReference; readonly revision: string };
  };
  collect: {
    input: { readonly resource: ProviderReference };
    result: { readonly artifacts: readonly ProviderArtifact[] };
  };
  cleanup: {
    input: { readonly resource: ProviderReference };
    result: { readonly cleaned: boolean };
  };
}

export interface ScmOperationMap {
  readBase: {
    input: { readonly repository: string };
    result: ProviderReference;
  };
  readRef: {
    input: { readonly repository: string; readonly ref: string };
    result: ProviderReference;
  };
  createBranch: {
    input: { readonly repository: string; readonly branch: string };
    result: ProviderReference;
  };
  commit: {
    input: {
      readonly repository: string;
      readonly branch: string;
      readonly message: string;
    };
    result: ProviderReference;
  };
  push: {
    input: { readonly repository: string; readonly ref: string };
    result: ProviderReference;
  };
  createDraftPullRequest: {
    input: {
      readonly repository: string;
      readonly head: string;
      readonly base: string;
      readonly title: string;
      readonly body?: string;
    };
    result: ProviderArtifact;
  };
  collectArtifact: {
    input: { readonly repository: string; readonly ref: string };
    result: ProviderArtifact;
  };
}

export interface ValidationProof {
  readonly status: "failed" | "passed";
  readonly checks: readonly {
    readonly name: string;
    readonly status: "failed" | "passed" | "skipped";
    readonly summary?: string;
  }[];
  readonly artifacts: readonly ProviderArtifact[];
}

export interface ValidationOperationMap {
  validate: {
    input: {
      readonly candidateRevision: string;
      readonly contractRevision: string;
      readonly target?: string;
    };
    result: ValidationProof;
  };
}

export interface ProviderOperationMap {
  work: WorkOperationMap;
  harness: HarnessOperationMap;
  infrastructure: InfrastructureOperationMap;
  scm: ScmOperationMap;
  validation: ValidationOperationMap;
}

export type OperationName<K extends ProviderKind = ProviderKind> =
  K extends ProviderKind ? keyof ProviderOperationMap[K] & string : never;

type ProviderMethods<Operations> = {
  [Operation in keyof Operations]: Operations[Operation] extends {
    input: infer Input;
    result: infer Result;
  }
    ? (
        input: Input,
        context: ProviderRequestContext,
      ) => Promise<Result> | Result
    : never;
};

export type WorkProvider = ProviderIdentity<"work"> &
  ProviderMethods<WorkOperationMap>;
export type HarnessProvider = ProviderIdentity<"harness"> &
  ProviderMethods<HarnessOperationMap>;
export type InfrastructureProvider = ProviderIdentity<"infrastructure"> &
  ProviderMethods<InfrastructureOperationMap>;
export type ScmProvider = ProviderIdentity<"scm"> &
  ProviderMethods<ScmOperationMap>;
export type ValidationProvider = ProviderIdentity<"validation"> &
  ProviderMethods<ValidationOperationMap>;

export interface ProviderByKind {
  work: WorkProvider;
  harness: HarnessProvider;
  infrastructure: InfrastructureProvider;
  scm: ScmProvider;
  validation: ValidationProvider;
}

export type AnyProvider = ProviderByKind[ProviderKind];

export type OperationInput<
  K extends ProviderKind,
  O extends OperationName<K>,
> = K extends ProviderKind
  ? O extends keyof ProviderOperationMap[K]
    ? ProviderOperationMap[K][O] extends { input: infer Input }
      ? Input
      : never
    : never
  : never;

export type OperationResult<
  K extends ProviderKind,
  O extends OperationName<K>,
> = K extends ProviderKind
  ? O extends keyof ProviderOperationMap[K]
    ? ProviderOperationMap[K][O] extends { result: infer Result }
      ? Result
      : never
    : never
  : never;

export type ProviderErrorCode =
  | "cancelled"
  | "unsupported_capability"
  | "configuration"
  | "spawn"
  | "handshake"
  | "protocol"
  | "timeout"
  | "session"
  | "request"
  | "unexpected-exit";

export interface ProviderFailureMetadata {
  readonly kind: ProviderKind;
  readonly providerId: string;
  readonly operation: string;
}

export interface ProviderErrorJson {
  readonly name: "ProviderError";
  readonly code: ProviderErrorCode;
  readonly providerKind: ProviderKind;
  readonly providerId: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly capability?: string;
}

export interface ProviderErrorOptions extends ProviderFailureMetadata {
  readonly capability?: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly providerKind: ProviderKind;
  readonly providerId: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly capability?: string;

  constructor(options: ProviderErrorOptions) {
    super(messageForCode(options.code));
    this.name = "ProviderError";
    this.code = options.code;
    this.providerKind = options.kind;
    this.providerId = options.providerId;
    this.operation = options.operation;
    this.retryable = options.retryable;
    this.capability = options.capability;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static unsupportedCapability(
    metadata: ProviderFailureMetadata,
    capability: string,
  ): ProviderError {
    return new ProviderError({
      ...metadata,
      capability,
      code: "unsupported_capability",
      retryable: false,
    });
  }

  static cancelled(metadata: ProviderFailureMetadata): ProviderError {
    return new ProviderError({
      ...metadata,
      code: "cancelled",
      retryable: false,
    });
  }

  static classified(
    metadata: ProviderFailureMetadata,
    code: Exclude<ProviderErrorCode, "cancelled" | "unsupported_capability">,
    retryable = false,
  ): ProviderError {
    return new ProviderError({
      ...metadata,
      code,
      retryable,
    });
  }

  toJSON(): ProviderErrorJson {
    return {
      name: "ProviderError",
      code: this.code,
      providerKind: this.providerKind,
      providerId: this.providerId,
      operation: this.operation,
      retryable: this.retryable,
      ...(this.capability ? { capability: this.capability } : {}),
    };
  }
}

const messageForCode = (code: ProviderErrorCode): string => {
  switch (code) {
    case "cancelled":
      return "provider_operation_cancelled";
    case "unsupported_capability":
      return "unsupported_capability";
    case "configuration":
      return "provider_configuration_failed";
    case "spawn":
      return "provider_spawn_failed";
    case "handshake":
      return "provider_handshake_failed";
    case "protocol":
      return "provider_protocol_failed";
    case "timeout":
      return "provider_request_timed_out";
    case "session":
      return "provider_session_invalid";
    case "request":
      return "provider_request_rejected";
    case "unexpected-exit":
      return "provider_unexpected_exit";
  }
};

const isAbortLike = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  return "name" in error && error.name === "AbortError";
};

export function requireProviderCapability(
  provider: ProviderIdentity,
  capability: string,
  operation = capability,
): void {
  if (!provider.capabilities.some((declared) => declared === capability)) {
    throw ProviderError.unsupportedCapability(
      {
        kind: provider.kind,
        providerId: provider.id,
        operation,
      },
      capability,
    );
  }
}

export function requireProviderCapabilities(
  provider: ProviderIdentity,
  capabilities: readonly string[],
  operation = "preflight",
): void {
  for (const capability of capabilities) {
    requireProviderCapability(provider, capability, operation);
  }
}

export function normalizeProviderError(
  error: unknown,
  metadata: ProviderFailureMetadata,
  signal?: AbortSignal,
): ProviderError {
  if (signal?.aborted || isAbortLike(error)) {
    return ProviderError.cancelled(metadata);
  }
  if (error instanceof ProviderError) return error;
  return ProviderError.classified(metadata, "protocol", true);
}

export async function executeProviderOperation<Result>(
  provider: ProviderIdentity,
  capability: string,
  operation: string,
  action: (context: ProviderRequestContext) => Promise<Result> | Result,
  context: ProviderRequestContext = {},
): Promise<Result> {
  requireProviderCapability(provider, capability, operation);
  if (context.signal?.aborted) {
    throw ProviderError.cancelled({
      kind: provider.kind,
      providerId: provider.id,
      operation,
    });
  }

  try {
    return await action(context);
  } catch (error) {
    throw normalizeProviderError(
      error,
      {
        kind: provider.kind,
        providerId: provider.id,
        operation,
      },
      context.signal,
    );
  }
}

export async function invokeProviderOperation<
  K extends ProviderKind,
  O extends OperationName<K>,
>(
  provider: ProviderByKind[K],
  operation: O,
  input: OperationInput<K, O>,
  context: ProviderRequestContext = {},
): Promise<OperationResult<K, O>> {
  const operationName = String(operation);
  const method = (provider as unknown as Record<string, unknown>)[
    operationName
  ] as (
    operationInput: OperationInput<K, O>,
    operationContext: ProviderRequestContext,
  ) => Promise<OperationResult<K, O>> | OperationResult<K, O>;

  return executeProviderOperation(
    provider,
    operationName,
    operationName,
    (operationContext) => method.call(provider, input, operationContext),
    context,
  );
}

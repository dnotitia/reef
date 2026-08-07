import {
  type ArtifactKind,
  type ExecutionPhase,
  type ExecutionResult,
  PROVIDER_KINDS,
  type ProviderArtifact,
  type ProviderKind,
  type ProviderReference,
  type RunPlan,
  type RunPlanInput,
  RunPlanSchema,
  deepFreeze,
} from "@reef/orchestrator";
import { z } from "zod";

import { ControllerError } from "./errors.js";

export const CONTROLLER_STATE_SCHEMA_VERSION = 1 as const;

const MAX_OPAQUE_VALUE_LENGTH = 2048;
const MAX_CONTROLLER_ID_LENGTH = 256;

const printableText = (label: string, max = MAX_OPAQUE_VALUE_LENGTH) =>
  z
    .string()
    .trim()
    .min(1, `${label} must not be empty`)
    .max(max, `${label} is too long`)
    .refine(
      (value) =>
        Array.from(value).every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      `${label} must not contain control characters`,
    );

const opaqueValue = (label: string, max = MAX_OPAQUE_VALUE_LENGTH) =>
  printableText(label, max).refine(
    (value) => !/^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}(?:[\\/]|$))/.test(value),
    `${label} must not be a filesystem path`,
  );

export const ControllerUriSchema = printableText("URI", 2048)
  .refine(
    (value) => /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(value),
    "URI must be absolute",
  )
  .refine(
    (value) => !value.toLowerCase().startsWith("file:"),
    "filesystem URIs are not allowed",
  );

export const ControllerTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value),
    "timestamp must include a UTC offset",
  );

export const ProcessIdentitySchema = z
  .object({
    pid: z.number().int().positive(),
    startTime: opaqueValue("process start time", 256),
  })
  .strict();

export type ProcessIdentity = z.infer<typeof ProcessIdentitySchema>;

export const ControllerOwnerSchema = z
  .object({
    controllerId: opaqueValue("controller id", MAX_CONTROLLER_ID_LENGTH),
    process: ProcessIdentitySchema,
  })
  .strict();

export type ControllerOwner = z.infer<typeof ControllerOwnerSchema>;

const providerReferenceName = opaqueValue("provider reference name", 512);
const providerReferenceRevision = opaqueValue(
  "provider reference revision",
  512,
);

export const ControllerProviderReferenceSchema = z
  .object({
    name: providerReferenceName,
    revision: providerReferenceRevision,
    uri: ControllerUriSchema.optional(),
  })
  .strict();

export type ControllerProviderReference = z.infer<
  typeof ControllerProviderReferenceSchema
>;

const artifactKindValues = [
  "branch",
  "commit",
  "file",
  "proof",
  "pull_request",
  "report",
] as const satisfies readonly ArtifactKind[];

export const ControllerArtifactSchema = z
  .object({
    kind: z.enum(artifactKindValues),
    ref: opaqueValue("artifact reference"),
    uri: ControllerUriSchema.optional(),
    title: printableText("artifact title", 512).optional(),
  })
  .strict();

export type ControllerArtifact = z.infer<typeof ControllerArtifactSchema>;

export const ControllerExecutionPhaseSchema = z.enum([
  "preflight",
  "running",
  "cleanup",
  "terminal",
]);

export type ControllerExecutionPhase = z.infer<
  typeof ControllerExecutionPhaseSchema
>;

const providerErrorCodeSchema = z.enum([
  "cancelled",
  "unsupported_capability",
  "configuration",
  "spawn",
  "handshake",
  "protocol",
  "timeout",
  "session",
  "request",
  "unexpected-exit",
]);

const providerErrorSchema = z
  .object({
    name: z.literal("ProviderError"),
    code: providerErrorCodeSchema,
    providerKind: z.enum(PROVIDER_KINDS),
    providerId: opaqueValue("provider id", 128),
    operation: opaqueValue("provider operation", 128),
    retryable: z.boolean(),
    capability: opaqueValue("provider capability", 128).optional(),
  })
  .strict();

const executionProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    workUri: ControllerUriSchema,
    workRevision: opaqueValue("work revision", 512),
    workSource: printableText("work source", 512),
    workSourceRevision: opaqueValue("work source revision", 512),
    inputSource: printableText("input source", 512),
    inputRevision: opaqueValue("input revision", 512),
    planCreatedAt: ControllerTimestampSchema,
  })
  .strict();

const preflightIssueSchema = z
  .object({
    code: z.enum([
      "provider_missing",
      "provider_kind_mismatch",
      "provider_id_mismatch",
      "provider_version_mismatch",
      "provider_capability_drift",
      "unsupported_capability",
    ]),
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    providerKind: z.enum(PROVIDER_KINDS),
    providerId: opaqueValue("provider id", 128).nullable(),
    field: z.enum([
      "provider",
      "kind",
      "id",
      "version",
      "capabilities",
      "requiredCapabilities",
    ]),
    expected: z
      .union([
        printableText("expected value"),
        z.array(printableText("expected value")),
      ])
      .optional(),
    actual: z
      .union([
        printableText("actual value"),
        z.array(printableText("actual value")),
        z.null(),
      ])
      .optional(),
    capability: printableText("capability", 128).optional(),
  })
  .strict();

const cancelledFailureSchema = z
  .object({
    code: z.literal("cancelled"),
    provider: providerErrorSchema.optional(),
  })
  .strict();

const executionFailureSchema = z.union([
  z
    .object({
      code: z.literal("preflight_failed"),
      issues: z.array(preflightIssueSchema),
    })
    .strict(),
  z.object({ code: z.literal("engine_failed") }).strict(),
  z.object({ code: z.literal("cleanup_failed") }).strict(),
  cancelledFailureSchema,
  providerErrorSchema,
]);

const cleanupOutcomeSchema = z
  .object({
    index: z.number().int().nonnegative(),
    status: z.enum(["succeeded", "failed"]),
    failure: z
      .union([
        z.object({ code: z.literal("cleanup_failed") }).strict(),
        providerErrorSchema,
      ])
      .optional(),
  })
  .strict()
  .superRefine((outcome, context) => {
    if (outcome.status === "succeeded" && outcome.failure !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "successful cleanup must not contain a failure",
      });
    }
    if (outcome.status === "failed" && outcome.failure === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "failed cleanup must contain a failure",
      });
    }
  });

const executionResultBaseObject = z
  .object({
    provenance: executionProvenanceSchema,
    completedPhases: z.array(ControllerExecutionPhaseSchema),
    cleanup: z.object({ outcomes: z.array(cleanupOutcomeSchema) }).strict(),
  })
  .strict();

const validateExecutionPhases = (
  result: { readonly completedPhases: readonly ControllerExecutionPhase[] },
  context: z.RefinementCtx,
) => {
  if (
    result.completedPhases.length === 0 ||
    result.completedPhases.at(-1) !== "terminal"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["completedPhases"],
      message: "execution result must end at terminal",
    });
  }
  for (let index = 1; index < result.completedPhases.length; index += 1) {
    const previous = result.completedPhases[index - 1];
    const current = result.completedPhases[index];
    if (
      ControllerExecutionPhaseSchema.options.indexOf(current) <=
      ControllerExecutionPhaseSchema.options.indexOf(previous)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedPhases", index],
        message: "execution phases must be strictly monotonic",
      });
    }
  }
};

export const ControllerExecutionResultSchema = z.union([
  executionResultBaseObject
    .extend({ outcome: z.literal("succeeded"), failure: z.null() })
    .strict()
    .superRefine(validateExecutionPhases),
  executionResultBaseObject
    .extend({
      outcome: z.literal("failed"),
      failure: executionFailureSchema,
    })
    .strict()
    .superRefine(validateExecutionPhases),
  executionResultBaseObject
    .extend({
      outcome: z.literal("cancelled"),
      failure: cancelledFailureSchema,
    })
    .strict()
    .superRefine(validateExecutionPhases),
]);

const controllerStateObject = z
  .object({
    schemaVersion: z.literal(CONTROLLER_STATE_SCHEMA_VERSION),
    runId: opaqueValue("run id", 128),
    plan: RunPlanSchema,
    revision: z.number().int().nonnegative(),
    owner: ControllerOwnerSchema,
    phase: z.union([z.literal("prepared"), ControllerExecutionPhaseSchema]),
    workspace: ControllerProviderReferenceSchema.nullable(),
    artifacts: z.array(ControllerArtifactSchema),
    startedAt: ControllerTimestampSchema,
    updatedAt: ControllerTimestampSchema,
    interruptedAt: ControllerTimestampSchema.nullable(),
    terminalResult: ControllerExecutionResultSchema.nullable(),
  })
  .strict();

type ControllerStateRefinementInput = {
  readonly phase: "prepared" | ControllerExecutionPhase;
  readonly plan: RunPlan;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly interruptedAt: string | null;
  readonly terminalResult: {
    readonly provenance: {
      readonly workUri: string;
      readonly schemaVersion: number;
      readonly workRevision: string;
      readonly workSource: string;
      readonly workSourceRevision: string;
      readonly inputSource: string;
      readonly inputRevision: string;
      readonly planCreatedAt: string;
    };
  } | null;
};

export const ControllerStateSchema = controllerStateObject.superRefine(
  (rawState, context) => {
    const state = rawState as unknown as ControllerStateRefinementInput;
    if (state.phase === "terminal" && state.terminalResult === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terminalResult"],
        message: "terminal state must include a terminal result",
      });
    }
    if (state.phase !== "terminal" && state.terminalResult !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terminalResult"],
        message: "non-terminal state must not include a terminal result",
      });
    }
    if (state.phase === "terminal" && state.interruptedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interruptedAt"],
        message: "terminal state must not be interrupted",
      });
    }
    if (
      state.terminalResult !== null &&
      state.terminalResult.provenance.workUri !== state.plan.work.uri
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terminalResult", "provenance", "workUri"],
        message: "terminal result work URI must match the plan",
      });
    }
    if (state.terminalResult !== null) {
      const provenance = state.terminalResult.provenance;
      const expected = {
        schemaVersion: state.plan.schemaVersion,
        workUri: state.plan.work.uri,
        workRevision: state.plan.work.snapshot.revision,
        workSource: state.plan.work.snapshot.provenance.source,
        workSourceRevision: state.plan.work.snapshot.provenance.revision,
        inputSource: state.plan.inputProvenance.source,
        inputRevision: state.plan.inputProvenance.revision,
        planCreatedAt: state.plan.createdAt,
      };
      for (const [field, value] of Object.entries(expected)) {
        if (provenance[field as keyof typeof expected] !== value) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["terminalResult", "provenance", field],
            message: "terminal result provenance must match the plan",
          });
        }
      }
    }
    if (Date.parse(state.updatedAt) < Date.parse(state.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "updatedAt must not precede startedAt",
      });
    }
    if (
      state.interruptedAt !== null &&
      Date.parse(state.interruptedAt) < Date.parse(state.startedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interruptedAt"],
        message: "interruptedAt must not precede startedAt",
      });
    }
  },
);

export type ControllerStateInput = z.input<typeof ControllerStateSchema>;

export interface ControllerState {
  readonly schemaVersion: typeof CONTROLLER_STATE_SCHEMA_VERSION;
  readonly runId: string;
  readonly plan: RunPlan;
  readonly revision: number;
  readonly owner: ControllerOwner;
  readonly phase: "prepared" | ExecutionPhase;
  readonly workspace: ProviderReference | null;
  readonly artifacts: readonly ProviderArtifact[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly interruptedAt: string | null;
  readonly terminalResult: ExecutionResult | null;
}

export const ControllerClaimSchema = z
  .object({
    schemaVersion: z.literal(CONTROLLER_STATE_SCHEMA_VERSION),
    runId: opaqueValue("run id", 128),
    workUri: ControllerUriSchema,
    workKey: z.string().regex(/^[a-f0-9]{64}$/),
    owner: ControllerOwnerSchema,
    status: z.enum(["active", "released"]),
    claimedAt: ControllerTimestampSchema,
    releasedAt: ControllerTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((claim, context) => {
    if (claim.status === "active" && claim.releasedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["releasedAt"],
        message: "active claim must not have a release timestamp",
      });
    }
    if (claim.status === "released" && claim.releasedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["releasedAt"],
        message: "released claim must have a release timestamp",
      });
    }
  });

export type ControllerClaim = z.infer<typeof ControllerClaimSchema>;

export const ControllerUpdateOperationSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("phase"), phase: ControllerExecutionPhaseSchema })
    .strict(),
  z
    .object({
      type: z.literal("workspace"),
      reference: ControllerProviderReferenceSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("artifact"), artifact: ControllerArtifactSchema })
    .strict(),
  z
    .object({
      type: z.literal("terminal"),
      result: ControllerExecutionResultSchema,
    })
    .strict(),
  z.object({ type: z.literal("interrupted") }).strict(),
]);

export type ControllerUpdateOperation =
  | { readonly type: "phase"; readonly phase: ControllerExecutionPhase }
  | {
      readonly type: "workspace";
      readonly reference: ProviderReference;
    }
  | { readonly type: "artifact"; readonly artifact: ProviderArtifact }
  | { readonly type: "terminal"; readonly result: ExecutionResult }
  | { readonly type: "interrupted" };

export const ControllerUpdateInputSchema = z
  .object({
    runId: opaqueValue("run id", 128),
    expectedRevision: z.number().int().nonnegative().optional(),
    operation: ControllerUpdateOperationSchema,
  })
  .strict();

export type ControllerUpdateInput = {
  readonly runId: string;
  readonly expectedRevision?: number;
  readonly operation: ControllerUpdateOperation;
};

export const ControllerClaimInputSchema = z
  .object({
    runId: opaqueValue("run id", 128),
    plan: z.unknown(),
  })
  .strict();

export type ControllerClaimInput = {
  readonly runId: string;
  readonly plan: RunPlanInput | RunPlan;
};

export const ControllerCleanupInputSchema = z
  .object({ workUri: ControllerUriSchema })
  .strict();

export type ControllerCleanupInput = z.infer<
  typeof ControllerCleanupInputSchema
>;

export const ControllerProviderKindSchema = z.enum(PROVIDER_KINDS);
export type ControllerProviderKind = z.infer<
  typeof ControllerProviderKindSchema
> &
  ProviderKind;

export const parseControllerState = (value: unknown): ControllerState => {
  const version =
    typeof value === "object" && value !== null && "schemaVersion" in value
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version === undefined) {
    throw new ControllerError("state_schema_invalid");
  }
  if (version !== CONTROLLER_STATE_SCHEMA_VERSION) {
    throw new ControllerError("unsupported_schema_version");
  }
  const parsed = ControllerStateSchema.safeParse(value);
  if (!parsed.success) throw new ControllerError("state_schema_invalid");
  return deepFreeze(parsed.data) as unknown as ControllerState;
};

export const parseControllerClaim = (value: unknown): ControllerClaim => {
  const version =
    typeof value === "object" && value !== null && "schemaVersion" in value
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version === undefined) {
    throw new ControllerError("claim_schema_invalid");
  }
  if (version !== CONTROLLER_STATE_SCHEMA_VERSION) {
    throw new ControllerError("unsupported_schema_version");
  }
  const parsed = ControllerClaimSchema.safeParse(value);
  if (!parsed.success) throw new ControllerError("claim_schema_invalid");
  return parsed.data;
};

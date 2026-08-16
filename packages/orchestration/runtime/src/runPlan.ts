import { z } from "zod";
import {
  HARNESS_CAPABILITIES,
  INFRASTRUCTURE_CAPABILITIES,
  PROVIDER_KINDS,
  ProviderIdentitySchema,
  type ProviderKind,
  SCM_CAPABILITIES,
  VALIDATION_CAPABILITIES,
  ValidationChecksSchema,
  WORK_CAPABILITIES,
} from "./provider.js";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? ReadonlyArray<DeepReadonly<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  const seen = new WeakSet<object>();

  const freeze = (current: unknown): unknown => {
    if (current === null || typeof current !== "object" || seen.has(current)) {
      return current;
    }

    seen.add(current);
    for (const child of Object.values(current)) freeze(child);
    return Object.freeze(current);
  };

  return freeze(value) as DeepReadonly<T>;
}

const uriSchema = z
  .string()
  .trim()
  .min(1, "URI must not be empty")
  .max(2048, "URI must be at most 2048 characters")
  .refine(
    (value) => /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(value),
    "must be an absolute URI",
  );

const revisionSchema = z
  .string()
  .trim()
  .min(1, "revision must not be empty")
  .max(512, "revision must be at most 512 characters")
  .refine((value) => !/\s/.test(value), "revision must not contain whitespace");

const provenanceSourceSchema = z
  .string()
  .trim()
  .min(1, "provenance source must not be empty")
  .max(512, "provenance source must be at most 512 characters")
  .refine(
    (value) =>
      Array.from(value).every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    "provenance source must not contain control characters",
  );

const timestampSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value), {
    message: "timestamp must include a UTC offset",
  });

const uniqueCapabilities = (
  values: readonly string[],
  context: z.RefinementCtx,
): void => {
  const seen = new Set<string>();
  values.forEach((capability, index) => {
    if (seen.has(capability)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `duplicate capability: ${capability}`,
      });
    }
    seen.add(capability);
  });
};

const requiredCapabilitiesSchema = z.strictObject({
  work: z
    .array(z.enum(WORK_CAPABILITIES))
    .superRefine((values, context) => uniqueCapabilities(values, context)),
  harness: z
    .array(z.enum(HARNESS_CAPABILITIES))
    .superRefine((values, context) => uniqueCapabilities(values, context)),
  infrastructure: z
    .array(z.enum(INFRASTRUCTURE_CAPABILITIES))
    .superRefine((values, context) => uniqueCapabilities(values, context)),
  scm: z
    .array(z.enum(SCM_CAPABILITIES))
    .superRefine((values, context) => uniqueCapabilities(values, context)),
  validation: z
    .array(z.enum(VALIDATION_CAPABILITIES))
    .superRefine((values, context) => uniqueCapabilities(values, context)),
});

const workSnapshotSchema = z.strictObject({
  uri: uriSchema,
  snapshot: z.strictObject({
    revision: revisionSchema,
    provenance: z.strictObject({
      source: provenanceSourceSchema,
      revision: revisionSchema,
    }),
  }),
});

const runPlanBaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  work: workSnapshotSchema,
  providers: z.strictObject({
    work: ProviderIdentitySchema,
    harness: ProviderIdentitySchema,
    infrastructure: ProviderIdentitySchema,
    scm: ProviderIdentitySchema,
    validation: ProviderIdentitySchema,
  }),
  validationChecks: ValidationChecksSchema,
  requiredCapabilities: requiredCapabilitiesSchema,
  createdAt: timestampSchema,
  inputProvenance: z.strictObject({
    source: provenanceSourceSchema,
    revision: revisionSchema,
  }),
});

const providerKinds = PROVIDER_KINDS satisfies readonly ProviderKind[];

const compatibleCapabilities = (
  plan: z.infer<typeof runPlanBaseSchema>,
  context: z.RefinementCtx,
): void => {
  for (const kind of providerKinds) {
    const provider = plan.providers[kind];
    if (provider.kind !== kind) {
      context.addIssue({
        code: "custom",
        path: ["providers", kind, "kind"],
        message: `provider snapshot kind must be ${kind}`,
      });
    }

    const declared = new Set(provider.capabilities);
    for (const [index, capability] of plan.requiredCapabilities[
      kind
    ].entries()) {
      if (!declared.has(capability)) {
        context.addIssue({
          code: "custom",
          path: ["requiredCapabilities", kind, index],
          message: `provider ${provider.id} does not declare required capability ${capability}`,
          params: {
            code: "unsupported_capability",
            providerId: provider.id,
            capability,
          },
        });
      }
    }
  }
};

export const RunPlanSchema = runPlanBaseSchema
  .superRefine(compatibleCapabilities)
  .transform((value) => deepFreeze(value));

export type RunPlanInput = z.input<typeof RunPlanSchema>;
export type RunPlan = z.output<typeof RunPlanSchema>;

export interface RunPlanValidationIssue {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export class RunPlanValidationError extends Error {
  readonly issues: readonly RunPlanValidationIssue[];

  constructor(issues: readonly RunPlanValidationIssue[]) {
    super("run_plan_invalid");
    this.name = "RunPlanValidationError";
    this.issues = issues;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): {
    name: string;
    code: string;
    issues: readonly RunPlanValidationIssue[];
  } {
    return {
      name: this.name,
      code: this.message,
      issues: this.issues,
    };
  }
}

const validationIssues = (error: z.ZodError): RunPlanValidationIssue[] =>
  error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    ),
    message: issue.message,
  }));

export type SafeRunPlanParseResult =
  | { readonly success: true; readonly data: RunPlan }
  | { readonly success: false; readonly error: RunPlanValidationError };

export function safeParseRunPlan(input: unknown): SafeRunPlanParseResult {
  const result = RunPlanSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      error: new RunPlanValidationError(validationIssues(result.error)),
    };
  }
  return { success: true, data: result.data };
}

export function parseRunPlan(input: unknown): RunPlan {
  const result = safeParseRunPlan(input);
  if (!result.success) throw result.error;
  return result.data;
}

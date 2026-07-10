import { z } from "zod";
import { MonitoredRepoSchema } from "../workspace";

const PROFILE_ID_PATTERN = /^[A-Za-z0-9:][A-Za-z0-9._:-]*$/;
const FORBIDDEN_REF_CHARS = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
const ALLOWED_BRANCH_PLACEHOLDERS = new Set(["issue_id", "run_id"]);

export const DevelopmentProfileIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(PROFILE_ID_PATTERN, "invalid profile id");

export const DevelopmentRecipePathSchema = z
  .string()
  .min(1)
  .max(500)
  .superRefine((value, ctx) => {
    if (
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      value.split("/").some((segment) => segment === ".." || segment === "")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recipe_path must be a checkout-relative POSIX path",
      });
    }
  });

function isSafeGitBranch(value: string): boolean {
  return !(
    value.length === 0 ||
    value === "HEAD" ||
    value.startsWith("-") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    Array.from(value).some(
      (char) =>
        FORBIDDEN_REF_CHARS.has(char) ||
        char.charCodeAt(0) <= 32 ||
        char.charCodeAt(0) === 127,
    ) ||
    value
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  );
}

export function renderDevelopmentBranchTemplate(
  template: string,
  values: { issue_id: string; run_id: string },
): string {
  return template.replace(/\{([^{}]+)\}/g, (_match, key: string) => {
    if (!ALLOWED_BRANCH_PLACEHOLDERS.has(key)) return `{${key}}`;
    return values[key as keyof typeof values];
  });
}

export const DevelopmentBranchTemplateSchema = z
  .string()
  .min(1)
  .max(240)
  .superRefine((value, ctx) => {
    const placeholders = Array.from(
      value.matchAll(/\{([^{}]+)\}/g),
      (m) => m[1],
    );
    if (placeholders.some((key) => !ALLOWED_BRANCH_PLACEHOLDERS.has(key))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "branch_template contains an unsupported placeholder",
      });
      return;
    }
    const sample = renderDevelopmentBranchTemplate(value, {
      issue_id: "REEF-381",
      run_id: "run-123",
    });
    if (!isSafeGitBranch(sample)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "branch_template does not render a safe Git branch",
      });
    }
  });

export const DevelopmentTargetConfigSchema = z
  .object({
    github_id: z.number().int().positive(),
    enabled: z.boolean(),
    recipe_path: DevelopmentRecipePathSchema.nullable().default(null),
    runner_profile: DevelopmentProfileIdSchema.nullable().default(null),
    permission_profile: DevelopmentProfileIdSchema.nullable().default(null),
    branch_template: DevelopmentBranchTemplateSchema.nullable().default(null),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (!target.enabled) return;
    for (const field of [
      "recipe_path",
      "runner_profile",
      "permission_profile",
      "branch_template",
    ] as const) {
      if (target[field] == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when the target is enabled`,
        });
      }
    }
  });
export type DevelopmentTargetConfig = z.infer<
  typeof DevelopmentTargetConfigSchema
>;

export const DevelopmentProfileOptionSchema = z
  .object({
    id: DevelopmentProfileIdSchema,
    label: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();
export type DevelopmentProfileOption = z.infer<
  typeof DevelopmentProfileOptionSchema
>;

export const DevelopmentProfileCatalogSchema = z
  .object({
    runner_profiles: z.array(DevelopmentProfileOptionSchema),
    permission_profiles: z.array(DevelopmentProfileOptionSchema),
  })
  .strict();
export type DevelopmentProfileCatalog = z.infer<
  typeof DevelopmentProfileCatalogSchema
>;

export const DEFAULT_DEVELOPMENT_PROFILE_CATALOG =
  DevelopmentProfileCatalogSchema.parse({
    runner_profiles: [
      {
        id: "default",
        label: "Default runner",
        description: "The deployment's standard Codex runner profile.",
      },
    ],
    permission_profiles: [
      {
        id: ":workspace",
        label: "Workspace access",
        description: "Repository workspace access within deployment limits.",
      },
    ],
  });

export const DevelopmentTargetEligibilityReasonEnum = z.enum([
  "target_missing",
  "target_disabled",
  "target_invalid",
  "profile_unavailable",
]);
export type DevelopmentTargetEligibilityReason = z.infer<
  typeof DevelopmentTargetEligibilityReasonEnum
>;

export const DevelopmentTargetEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    reason: DevelopmentTargetEligibilityReasonEnum.nullable(),
  })
  .strict();
export type DevelopmentTargetEligibility = z.infer<
  typeof DevelopmentTargetEligibilitySchema
>;

export function resolveDevelopmentTargetEligibility(input: {
  config: DevelopmentTargetConfig | null;
  catalog: DevelopmentProfileCatalog;
  duplicate?: boolean;
}): DevelopmentTargetEligibility {
  if (input.duplicate) return { eligible: false, reason: "target_invalid" };
  if (input.config == null)
    return { eligible: false, reason: "target_missing" };
  if (!input.config.enabled) {
    return { eligible: false, reason: "target_disabled" };
  }
  const runnerIds = new Set(
    input.catalog.runner_profiles.map((item) => item.id),
  );
  const permissionIds = new Set(
    input.catalog.permission_profiles.map((item) => item.id),
  );
  if (
    input.config.runner_profile == null ||
    input.config.permission_profile == null ||
    !runnerIds.has(input.config.runner_profile) ||
    !permissionIds.has(input.config.permission_profile)
  ) {
    return { eligible: false, reason: "profile_unavailable" };
  }
  return { eligible: true, reason: null };
}

export const DevelopmentTargetItemSchema = z
  .object({
    repo: MonitoredRepoSchema,
    config: DevelopmentTargetConfigSchema.nullable(),
    eligibility: DevelopmentTargetEligibilitySchema,
  })
  .strict();
export type DevelopmentTargetItem = z.infer<typeof DevelopmentTargetItemSchema>;

export const DevelopmentTargetsResponseSchema = z
  .object({
    items: z.array(DevelopmentTargetItemSchema),
    catalog: DevelopmentProfileCatalogSchema,
  })
  .strict();
export type DevelopmentTargetsResponse = z.infer<
  typeof DevelopmentTargetsResponseSchema
>;

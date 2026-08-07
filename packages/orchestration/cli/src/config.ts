import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import {
  HARNESS_CAPABILITIES,
  INFRASTRUCTURE_CAPABILITIES,
  MAX_VALIDATION_TIMEOUT_MS,
  PROVIDER_KINDS,
  SCM_CAPABILITIES,
  VALIDATION_CAPABILITIES,
  WORK_CAPABILITIES,
  deepFreeze,
} from "@reef/orchestrator";
import { z } from "zod";

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/u;
const VAULT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const SHA = /^[0-9a-f]{40,64}$/iu;
const MAX_RUN_WINDOW_MS = 30 * 60 * 1_000;

const uniqueStrings = (values: readonly string[], context: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: "duplicate value",
      });
    }
    seen.add(value);
  }
};

const environmentNames = z
  .array(z.string().regex(ENVIRONMENT_NAME))
  .superRefine(uniqueStrings);

const absolutePath = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value), "must be absolute")
  .refine((value) => !value.split(/[\\/]+/u).includes(".."), "must not escape")
  .transform((value) => resolve(value));

const safeToken = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => {
    return TOKEN.test(value) && !value.includes("..");
  }, "must be a safe token");

const branchName = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !hasForbiddenBranchCharacter(value))
  .refine((value) => !value.includes(".."))
  .refine((value) => !value.startsWith("/") && !value.endsWith("/"));

const branchPrefix = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !hasForbiddenBranchCharacter(value))
  .refine((value) => !value.includes(".."))
  .refine((value) => !value.startsWith("/"));

function hasForbiddenBranchCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      new Set(["~", "^", ":", "?", "*", "[", "\\"]).has(character)
    );
  });
}

const remoteUrl = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => {
    if (
      /(?:https?:\/\/[^/\s]+:[^@\s]+@|-----BEGIN [^-]+ PRIVATE KEY-----)/iu.test(
        value,
      )
    ) {
      return false;
    }
    if (value.startsWith("git@"))
      return /^git@[^:]+:[^/]+(?:\/[^/]+)*$/u.test(value);
    try {
      const parsed = new URL(value);
      return ["file:", "http:", "https:", "ssh:"].includes(parsed.protocol) &&
        parsed.username !== ""
        ? parsed.username === "git"
        : parsed.password === "";
    } catch {
      return isAbsolute(value);
    }
  });

const validationChecks = z
  .array(
    z
      .object({
        name: z.string().min(1).max(128),
        command: z
          .string()
          .min(1)
          .max(64 * 1024),
        timeout_ms: z.number().int().positive().max(MAX_VALIDATION_TIMEOUT_MS),
      })
      .strict(),
  )
  .min(1)
  .superRefine((checks, context) => {
    const seen = new Set<string>();
    for (const [index, check] of checks.entries()) {
      if (seen.has(check.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "name"],
          message: "duplicate validation check name",
        });
      }
      seen.add(check.name);
    }
  });

const providerBase = {
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(128),
  environment: environmentNames,
};

const workProvider = z
  .object({
    kind: z.literal("work"),
    ...providerBase,
    required_capabilities: z
      .array(z.enum(WORK_CAPABILITIES))
      .superRefine(uniqueStrings),
    options: z
      .object({
        vault: z.string().regex(VAULT_NAME),
        base_url_env: z.string().regex(ENVIRONMENT_NAME),
        jwt_env: z.string().regex(ENVIRONMENT_NAME),
      })
      .strict(),
  })
  .strict();

const harnessProvider = z
  .object({
    kind: z.literal("harness"),
    ...providerBase,
    required_capabilities: z
      .array(z.enum(HARNESS_CAPABILITIES))
      .superRefine(uniqueStrings),
    options: z
      .object({
        executable: z.string().min(1).max(4_096),
        model: z.string().min(1).max(256).optional(),
        handshake_timeout_ms: z
          .number()
          .int()
          .positive()
          .max(120_000)
          .optional(),
        request_timeout_ms: z.number().int().positive().max(120_000).optional(),
        shutdown_timeout_ms: z.number().int().positive().max(30_000).optional(),
        max_events: z.number().int().positive().max(1_024).optional(),
      })
      .strict(),
  })
  .strict();

const infrastructureProvider = z
  .object({
    kind: z.literal("infrastructure"),
    ...providerBase,
    required_capabilities: z
      .array(z.enum(INFRASTRUCTURE_CAPABILITIES))
      .superRefine(uniqueStrings),
    options: z
      .object({
        target: safeToken,
        max_output_bytes: z
          .number()
          .int()
          .positive()
          .max(1_024 * 1_024)
          .optional(),
        termination_timeout_ms: z
          .number()
          .int()
          .positive()
          .max(30_000)
          .optional(),
      })
      .strict(),
  })
  .strict();

const scmProvider = z
  .object({
    kind: z.literal("scm"),
    ...providerBase,
    required_capabilities: z
      .array(z.enum(SCM_CAPABILITIES))
      .superRefine(uniqueStrings),
    options: z
      .object({
        api_base_url: z.string().url().optional(),
        token_env: z.string().regex(ENVIRONMENT_NAME).optional(),
      })
      .strict(),
  })
  .strict();

const validationProvider = z
  .object({
    kind: z.literal("validation"),
    ...providerBase,
    required_capabilities: z
      .array(z.enum(VALIDATION_CAPABILITIES))
      .superRefine(uniqueStrings),
    options: z
      .object({
        max_output_bytes: z
          .number()
          .int()
          .positive()
          .max(1_024 * 1_024)
          .optional(),
        termination_timeout_ms: z
          .number()
          .int()
          .positive()
          .max(30_000)
          .optional(),
      })
      .strict(),
  })
  .strict();

export const CliProviderConfigSchema = z.discriminatedUnion("kind", [
  workProvider,
  harnessProvider,
  infrastructureProvider,
  scmProvider,
  validationProvider,
]);

const repository = z
  .object({
    id: safeToken,
    owner: z.string().regex(REPOSITORY_NAME),
    name: z.string().regex(REPOSITORY_NAME),
    root: absolutePath,
    managed_work_root: absolutePath,
    base_revision: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => !/\s/u.test(value)),
    remote: safeToken,
    remote_url: remoteUrl,
    base_branch: branchName,
    branch_policy: z
      .object({
        allowed_prefixes: z.array(branchPrefix).min(1),
        max_length: z.number().int().positive().max(255).optional(),
      })
      .strict(),
    permissions: z
      .object({
        commit: z.boolean(),
        push: z.boolean(),
        pull_request: z.boolean(),
      })
      .strict(),
  })
  .strict();

const controller = z
  .object({
    state_root: absolutePath,
    stale_after_ms: z.number().finite().positive(),
  })
  .strict();

export const CliConfigSchema = z
  .object({
    schema_version: z.literal(1),
    controller,
    repository,
    execution: z
      .object({
        run_window_ms: z.number().int().positive().max(MAX_RUN_WINDOW_MS),
      })
      .strict(),
    validation_checks: validationChecks,
    providers: z
      .array(CliProviderConfigSchema)
      .length(PROVIDER_KINDS.length)
      .superRefine((providers, context) => {
        const seen = new Set<string>();
        for (const [index, provider] of providers.entries()) {
          if (seen.has(provider.kind)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "kind"],
              message: "duplicate provider kind",
            });
          }
          seen.add(provider.kind);
        }
        for (const kind of PROVIDER_KINDS) {
          if (!seen.has(kind)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["providers"],
              message: `missing provider kind: ${kind}`,
            });
          }
        }
      }),
  })
  .strict();

export type CliConfig = z.output<typeof CliConfigSchema>;
export type CliProviderConfig = CliConfig["providers"][number];

export class CliConfigError extends Error {
  readonly code = "config_invalid" as const;
  readonly path: readonly (string | number)[];

  constructor(path: readonly (string | number)[] = []) {
    super("config_invalid");
    this.name = "CliConfigError";
    this.path = path;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

export interface ParsedCliConfig {
  readonly config: CliConfig;
  readonly digest: string;
}

export function parseCliConfig(input: unknown): ParsedCliConfig {
  const parsed = CliConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new CliConfigError(parsed.error.issues[0]?.path ?? []);
  }
  const config = deepFreeze(parsed.data) as CliConfig;
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalize(config)), "utf8")
    .digest("hex");
  return { config, digest };
}

export function providerConfigFor(
  config: CliConfig,
  kind: CliProviderConfig["kind"],
): CliProviderConfig {
  const provider = config.providers.find(
    (candidate) => candidate.kind === kind,
  );
  if (!provider) throw new CliConfigError(["providers", kind]);
  return provider;
}

export const cliConfigConstants = Object.freeze({
  maxRunWindowMs: MAX_RUN_WINDOW_MS,
  environmentNamePattern: ENVIRONMENT_NAME.source,
});

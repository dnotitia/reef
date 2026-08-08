import { Octokit } from "@octokit/rest";
import { createAkbAdapter } from "@reef/core";
import {
  type CodexHarnessProviderOptions,
  createCodexHarnessProvider,
} from "@reef/harness-provider-codex";
import {
  type LocalInfrastructureProviderOptions,
  createLocalInfrastructureProvider,
} from "@reef/infrastructure-provider-local";
import {
  PROVIDER_KINDS,
  type ProviderCapability,
  type ProviderIdentity,
  type ProviderKind,
  type ProviderRegistry,
} from "@reef/orchestrator";
import {
  type GithubScmProviderOptions,
  createGithubScmProvider,
} from "@reef/scm-provider-github";
import {
  type LocalValidationProviderOptions,
  createLocalValidationProvider,
} from "@reef/validation-provider-local";
import {
  type ReefWorkProviderOptions,
  createReefWorkProvider,
} from "@reef/work-provider-reef";
import {
  type CliConfig,
  type CliProviderConfig,
  providerConfigFor,
} from "./config.js";

export type CliEnvironment = Readonly<Record<string, string | undefined>>;

export class CliResolutionError extends Error {
  readonly code:
    | "environment_missing"
    | "provider_unsupported"
    | "provider_capability_unsupported"
    | "provider_configuration";
  readonly path: readonly (string | number)[];

  constructor(
    code: CliResolutionError["code"],
    path: readonly (string | number)[],
  ) {
    super(code);
    this.name = "CliResolutionError";
    this.code = code;
    this.path = path;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ResolvedProviders {
  readonly providers: ProviderRegistry;
  readonly requiredCapabilities: {
    readonly work: readonly ProviderCapability[];
    readonly harness: readonly ProviderCapability[];
    readonly infrastructure: readonly ProviderCapability[];
    readonly scm: readonly ProviderCapability[];
    readonly validation: readonly ProviderCapability[];
  };
  readonly redactionValues: readonly string[];
}

const isNonEmpty = (value: string | undefined): value is string =>
  typeof value === "string" && value.length > 0;

const environmentFor = (
  provider: CliProviderConfig,
  environment: CliEnvironment,
  providerIndex: number,
): {
  readonly values: Readonly<Record<string, string>>;
  readonly secrets: readonly string[];
} => {
  const values: Record<string, string> = {};
  const secrets: string[] = [];
  for (const [index, name] of provider.environment.entries()) {
    const value = environment[name];
    if (!isNonEmpty(value)) {
      throw new CliResolutionError("environment_missing", [
        "providers",
        providerIndex,
        "environment",
        index,
      ]);
    }
    values[name] = value;
    if (isSecretEnvironmentName(name)) secrets.push(value);
  }
  return { values: Object.freeze(values), secrets: Object.freeze(secrets) };
};

const isSecretEnvironmentName = (name: string): boolean =>
  /(?:TOKEN|JWT|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)/iu.test(name);

const requireReferencedEnvironment = (
  provider: CliProviderConfig,
  name: string,
  providerIndex: number,
  environmentValues: Readonly<Record<string, string>>,
  optionName: "base_url_env" | "jwt_env" | "token_env",
): string => {
  if (!provider.environment.includes(name)) {
    throw new CliResolutionError("provider_configuration", [
      "providers",
      providerIndex,
      "options",
      optionName,
    ]);
  }
  const value = environmentValues[name];
  if (!isNonEmpty(value)) {
    throw new CliResolutionError("environment_missing", [
      "providers",
      providerIndex,
      "environment",
      provider.environment.indexOf(name),
    ]);
  }
  return value;
};

const assertHttpUrl = (
  value: string,
  path: readonly (string | number)[],
): string => {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid_url");
    }
  } catch {
    throw new CliResolutionError("provider_configuration", path);
  }
  return value;
};

const actualProvider = (
  provider: CliProviderConfig,
  actual: ProviderIdentity,
  providerIndex: number,
): ProviderIdentity => {
  if (
    actual.kind !== provider.kind ||
    actual.id !== provider.id ||
    actual.version !== provider.version
  ) {
    throw new CliResolutionError("provider_unsupported", [
      "providers",
      providerIndex,
      actual.kind === provider.kind ? "id" : "kind",
    ]);
  }
  const actualCapabilities = new Set(actual.capabilities);
  for (const [
    capabilityIndex,
    required,
  ] of provider.required_capabilities.entries()) {
    if (!actualCapabilities.has(required)) {
      throw new CliResolutionError("provider_capability_unsupported", [
        "providers",
        providerIndex,
        "required_capabilities",
        capabilityIndex,
      ]);
    }
  }
  return actual;
};

const providerIndexFor = (config: CliConfig, kind: ProviderKind): number =>
  config.providers.findIndex((provider) => provider.kind === kind);

const optionsForHarness = (
  provider: Extract<CliProviderConfig, { kind: "harness" }>,
): CodexHarnessProviderOptions => ({
  executable: provider.options.executable,
  ...(provider.options.model ? { model: provider.options.model } : {}),
  ...(provider.options.handshake_timeout_ms
    ? { handshakeTimeoutMs: provider.options.handshake_timeout_ms }
    : {}),
  ...(provider.options.request_timeout_ms
    ? { requestTimeoutMs: provider.options.request_timeout_ms }
    : {}),
  ...(provider.options.shutdown_timeout_ms
    ? { shutdownTimeoutMs: provider.options.shutdown_timeout_ms }
    : {}),
  ...(provider.options.max_events
    ? { maxEvents: provider.options.max_events }
    : {}),
});

export function resolveProviders(
  config: CliConfig,
  environment: CliEnvironment = process.env,
): ResolvedProviders {
  const resolvedEnvironment = new Map<
    ProviderKind,
    Readonly<Record<string, string>>
  >();
  const redactionValues = new Set<string>();
  for (const kind of PROVIDER_KINDS) {
    const provider = providerConfigFor(config, kind);
    const index = providerIndexFor(config, kind);
    const resolved = environmentFor(provider, environment, index);
    resolvedEnvironment.set(kind, resolved.values);
    for (const value of resolved.secrets) redactionValues.add(value);
  }

  const scmConfig = providerConfigFor(config, "scm");
  const scmIndex = providerIndexFor(config, "scm");
  const scmEnvironment = resolvedEnvironment.get("scm");
  if (scmConfig.kind !== "scm" || !scmEnvironment) {
    throw new CliResolutionError("provider_configuration", [
      "providers",
      scmIndex,
    ]);
  }
  let githubToken: string | undefined;
  if (scmConfig.options.token_env) {
    githubToken = requireReferencedEnvironment(
      scmConfig,
      scmConfig.options.token_env,
      scmIndex,
      scmEnvironment,
      "token_env",
    );
    redactionValues.add(githubToken);
  }
  const githubBaseUrl = scmConfig.options.api_base_url
    ? assertHttpUrl(scmConfig.options.api_base_url, [
        "providers",
        scmIndex,
        "options",
        "api_base_url",
      ])
    : undefined;

  const workConfig = providerConfigFor(config, "work");
  const workIndex = providerIndexFor(config, "work");
  const workEnvironment = resolvedEnvironment.get("work");
  if (!workEnvironment || workConfig.kind !== "work") {
    throw new CliResolutionError("provider_configuration", [
      "providers",
      workIndex,
    ]);
  }
  const baseUrl = requireReferencedEnvironment(
    workConfig,
    workConfig.options.base_url_env,
    workIndex,
    workEnvironment,
    "base_url_env",
  );
  const jwt = requireReferencedEnvironment(
    workConfig,
    workConfig.options.jwt_env,
    workIndex,
    workEnvironment,
    "jwt_env",
  );
  assertHttpUrl(baseUrl, ["providers", workIndex, "options", "base_url_env"]);
  redactionValues.add(jwt);
  const workOptions: ReefWorkProviderOptions = {
    adapter: createAkbAdapter({ baseUrl, jwt }),
    jwt,
    vault: workConfig.options.vault,
    repository: `${config.repository.owner}/${config.repository.name}`,
  };
  const work = createReefWorkProvider(workOptions);

  const harnessConfig = providerConfigFor(config, "harness");
  const harnessIndex = providerIndexFor(config, "harness");
  if (harnessConfig.kind !== "harness") {
    throw new CliResolutionError("provider_configuration", [
      "providers",
      harnessIndex,
    ]);
  }
  const harness = createCodexHarnessProvider(optionsForHarness(harnessConfig));

  const infrastructureConfig = providerConfigFor(config, "infrastructure");
  const infrastructureIndex = providerIndexFor(config, "infrastructure");
  const infrastructureEnvironment = resolvedEnvironment.get("infrastructure");
  if (
    infrastructureConfig.kind !== "infrastructure" ||
    !infrastructureEnvironment
  ) {
    throw new CliResolutionError("provider_configuration", [
      "providers",
      infrastructureIndex,
    ]);
  }
  const infrastructureOptions: LocalInfrastructureProviderOptions = {
    target: infrastructureConfig.options.target,
    repositoryRoot: config.repository.root,
    managedWorkRoot: config.repository.managed_work_root,
    baseRevision: config.repository.base_revision,
    environment: infrastructureEnvironment,
    ...(infrastructureConfig.options.max_output_bytes
      ? { maxOutputBytes: infrastructureConfig.options.max_output_bytes }
      : {}),
    ...(infrastructureConfig.options.termination_timeout_ms
      ? {
          terminationTimeoutMs:
            infrastructureConfig.options.termination_timeout_ms,
        }
      : {}),
  };
  const infrastructure = createLocalInfrastructureProvider(
    infrastructureOptions,
  );

  const githubOptions: GithubScmProviderOptions = {
    repository: {
      id: config.repository.id,
      owner: config.repository.owner,
      name: config.repository.name,
      workingTree: config.repository.root,
      remote: config.repository.remote,
      remoteUrl: config.repository.remote_url,
      baseBranch: config.repository.base_branch,
      branchPolicy: {
        allowedPrefixes: config.repository.branch_policy.allowed_prefixes,
        ...(config.repository.branch_policy.max_length
          ? { maxLength: config.repository.branch_policy.max_length }
          : {}),
      },
      permissions: {
        commit: config.repository.permissions.commit,
        push: config.repository.permissions.push,
        pullRequest: config.repository.permissions.pull_request,
      },
    },
    github: new Octokit({
      ...(githubToken ? { auth: githubToken } : {}),
      ...(githubBaseUrl ? { baseUrl: githubBaseUrl } : {}),
    }),
    gitEnvironment: Object.fromEntries(
      Object.entries(scmEnvironment).filter(
        ([name]) => name !== scmConfig.options.token_env,
      ),
    ),
  };
  const scm = createGithubScmProvider(githubOptions);

  const validationConfig = providerConfigFor(config, "validation");
  const validationIndex = providerIndexFor(config, "validation");
  const validationEnvironment = resolvedEnvironment.get("validation");
  if (validationConfig.kind !== "validation" || !validationEnvironment) {
    throw new CliResolutionError("provider_configuration", [
      "providers",
      validationIndex,
    ]);
  }
  const validationOptions: LocalValidationProviderOptions = {
    repositoryRoot: config.repository.root,
    environment: validationEnvironment,
    redactionValues: [...redactionValues],
    ...(validationConfig.options.max_output_bytes
      ? { maxOutputBytes: validationConfig.options.max_output_bytes }
      : {}),
    ...(validationConfig.options.termination_timeout_ms
      ? {
          terminationTimeoutMs: validationConfig.options.termination_timeout_ms,
        }
      : {}),
  };
  const validation = createLocalValidationProvider(validationOptions);

  const providers: ProviderRegistry = {
    work: actualProvider(
      workConfig,
      work,
      workIndex,
    ) as ProviderRegistry["work"],
    harness: actualProvider(
      harnessConfig,
      harness,
      harnessIndex,
    ) as ProviderRegistry["harness"],
    infrastructure: actualProvider(
      infrastructureConfig,
      infrastructure,
      infrastructureIndex,
    ) as ProviderRegistry["infrastructure"],
    scm: actualProvider(scmConfig, scm, scmIndex) as ProviderRegistry["scm"],
    validation: actualProvider(
      validationConfig,
      validation,
      validationIndex,
    ) as ProviderRegistry["validation"],
  };

  return {
    providers,
    requiredCapabilities: {
      work: workConfig.required_capabilities,
      harness: harnessConfig.required_capabilities,
      infrastructure: infrastructureConfig.required_capabilities,
      scm: scmConfig.required_capabilities,
      validation: validationConfig.required_capabilities,
    },
    redactionValues: Object.freeze([...redactionValues]),
  };
}

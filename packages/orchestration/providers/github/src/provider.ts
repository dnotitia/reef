import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Octokit as OctokitClient } from "@octokit/rest";
import {
  type ProviderArtifact,
  ProviderError,
  type ProviderReference,
  type ProviderRequestContext,
  SCM_CAPABILITIES,
  type ScmOperationMap,
  type ScmProvider,
  executeProviderOperation,
} from "@reef/orchestrator";

export const GITHUB_SCM_PROVIDER_ID = "github" as const;
export const GITHUB_SCM_PROVIDER_VERSION = "0.1.0" as const;

const DEFAULT_MAX_BRANCH_LENGTH = 255;
const MAX_REPOSITORY_ID_LENGTH = 128;
const MAX_REMOTE_NAME_LENGTH = 128;
const MAX_OWNER_OR_REPOSITORY_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 4_096;
const MAX_PULL_REQUEST_TITLE_LENGTH = 256;
const MAX_PULL_REQUEST_BODY_LENGTH = 64 * 1024;
const GIT_OUTPUT_BYTES = 64 * 1024;
const FULL_COMMIT = /^[0-9a-f]{40}$/iu;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const GIT_BRANCH_SPECIAL = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
const CREDENTIAL_PATTERN =
  /(?:\b(?:authorization|bearer|password|passwd|secret|token|api[_-]?key|x-access-token)\b\s*[:=]|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|https?:\/\/[^/\s]+:[^@\s]+@|-----BEGIN [^-]+ PRIVATE KEY-----)/iu;

const execFileAsync = promisify(execFile);

export interface GithubBranchPolicy {
  readonly allowedPrefixes: readonly string[];
  readonly maxLength?: number;
}

export interface GithubScmRepository {
  /** Provider-neutral repository id supplied by the caller. */
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  /** Exact checkout whose Git state this adapter may inspect or mutate. */
  readonly workingTree: string;
  readonly remote: string;
  /** Expected fetch and push URL for the configured remote. */
  readonly remoteUrl: string;
  readonly baseBranch: string;
  readonly branchPolicy: GithubBranchPolicy;
  readonly permissions: {
    readonly commit: boolean;
    readonly push: boolean;
    readonly pullRequest: boolean;
  };
}

export interface GithubScmProviderOptions {
  readonly repository: GithubScmRepository;
  /** Caller-owned Octokit client; credentials stay out of provider artifacts. */
  readonly github: OctokitClient;
  /** Explicit Git transport environment, such as a caller-owned askpass seam. */
  readonly gitEnvironment?: Readonly<Record<string, string>>;
}

export type GithubScmProvider = ScmProvider;

interface NormalizedRepository {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly workingTree: string;
  readonly remote: string;
  readonly remoteUrl: string;
  readonly baseBranch: string;
  readonly branchPolicy: {
    readonly allowedPrefixes: readonly string[];
    readonly maxLength: number;
  };
  readonly permissions: GithubScmRepository["permissions"];
}

interface NormalizedOptions {
  readonly repository: NormalizedRepository;
  readonly github: OctokitClient;
  readonly gitEnvironment: Readonly<Record<string, string>>;
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAbortLike = (value: unknown): boolean =>
  isRecord(value) && value.name === "AbortError";

const metadataFor = (operation: string) => ({
  kind: "scm" as const,
  providerId: GITHUB_SCM_PROVIDER_ID,
  operation,
});

const configurationFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "configuration", false);

const requestFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "request", false);

const protocolFailure = (operation: string, retryable = false): ProviderError =>
  ProviderError.classified(metadataFor(operation), "protocol", retryable);

const spawnFailure = (operation: string): ProviderError =>
  ProviderError.classified(metadataFor(operation), "spawn", false);

const requireString = (
  value: unknown,
  maximum: number,
  operation: string,
): string => {
  if (typeof value !== "string") throw configurationFailure(operation);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw configurationFailure(operation);
  }
  return normalized;
};

const requireRequestString = (
  value: unknown,
  maximum: number,
  operation: string,
): string => {
  try {
    return requireString(value, maximum, operation);
  } catch (error) {
    if (error instanceof ProviderError) throw requestFailure(operation);
    throw error;
  }
};

const requireToken = (value: unknown, maximum: number, operation: string) => {
  const normalized = requireString(value, maximum, operation);
  if (!SAFE_TOKEN.test(normalized)) throw configurationFailure(operation);
  return normalized;
};

const hasForbiddenBranchCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      GIT_BRANCH_SPECIAL.has(character)
    );
  });

const normalizeRemoteUrl = (value: unknown, operation: string): string => {
  const normalized = requireString(value, 2_048, operation);
  if (CREDENTIAL_PATTERN.test(normalized)) {
    throw configurationFailure(operation);
  }

  if (normalized.startsWith("git@")) {
    const match = /^git@([^:]+):(.+)$/u.exec(normalized);
    if (!match || match[2].includes("@")) {
      throw configurationFailure(operation);
    }
    const path = match[2].replace(/^\/+|\/+$/gu, "");
    if (path.length === 0) throw configurationFailure(operation);
    return `ssh://git@${match[1].toLowerCase()}/${stripGitSuffix(path)}`;
  }

  if (isAbsolute(normalized)) {
    return stripGitSuffix(pathToFileURL(resolve(normalized)).href);
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw configurationFailure(operation);
  }
  if (
    !["file:", "http:", "https:", "ssh:"].includes(parsed.protocol) ||
    (parsed.username.length > 0 &&
      !(parsed.protocol === "ssh:" && parsed.username === "git")) ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw configurationFailure(operation);
  }
  const pathname = parsed.pathname.replace(/^\/+|\/+$/gu, "");
  if (pathname.length === 0) throw configurationFailure(operation);
  parsed.pathname = `/${stripGitSuffix(pathname)}`;
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.href.replace(/\/$/u, "");
};

const stripGitSuffix = (value: string): string =>
  value.endsWith(".git") ? value.slice(0, -4) : value;

const normalizeBranchPolicy = (
  policy: GithubBranchPolicy,
  operation: string,
): NormalizedRepository["branchPolicy"] => {
  if (!policy || !Array.isArray(policy.allowedPrefixes)) {
    throw configurationFailure(operation);
  }
  const allowedPrefixes = policy.allowedPrefixes.map((prefix) => {
    if (
      typeof prefix !== "string" ||
      prefix.length === 0 ||
      prefix.length > DEFAULT_MAX_BRANCH_LENGTH ||
      hasForbiddenBranchCharacter(prefix) ||
      prefix.includes("..") ||
      prefix.startsWith("/")
    ) {
      throw configurationFailure(operation);
    }
    return prefix;
  });
  if (allowedPrefixes.length === 0) throw configurationFailure(operation);
  const maxLength = policy.maxLength ?? DEFAULT_MAX_BRANCH_LENGTH;
  if (
    !Number.isInteger(maxLength) ||
    maxLength <= 0 ||
    maxLength > DEFAULT_MAX_BRANCH_LENGTH
  ) {
    throw configurationFailure(operation);
  }
  if (allowedPrefixes.some((prefix) => prefix.length > maxLength)) {
    throw configurationFailure(operation);
  }
  return { allowedPrefixes, maxLength };
};

const normalizeOptions = (
  options: GithubScmProviderOptions,
): NormalizedOptions => {
  if (!options || !options.github) throw configurationFailure("factory");
  const operation = "factory";
  const source = options.repository;
  if (!source) throw configurationFailure(operation);
  const id = requireToken(source.id, MAX_REPOSITORY_ID_LENGTH, operation);
  const owner = requireToken(
    source.owner,
    MAX_OWNER_OR_REPOSITORY_LENGTH,
    operation,
  );
  const name = requireToken(
    source.name,
    MAX_OWNER_OR_REPOSITORY_LENGTH,
    operation,
  );
  const workingTree = requireString(source.workingTree, 4_096, operation);
  if (!isAbsolute(workingTree)) throw configurationFailure(operation);
  const remote = requireToken(source.remote, MAX_REMOTE_NAME_LENGTH, operation);
  const baseBranch = requireBranchName(source.baseBranch, operation);
  const remoteUrl = normalizeRemoteUrl(source.remoteUrl, operation);
  const branchPolicy = normalizeBranchPolicy(source.branchPolicy, operation);
  if (!source.permissions || typeof source.permissions !== "object") {
    throw configurationFailure(operation);
  }
  for (const permission of ["commit", "push", "pullRequest"] as const) {
    if (typeof source.permissions[permission] !== "boolean") {
      throw configurationFailure(operation);
    }
  }

  const gitEnvironment: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  const protectedEnvironment = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  if (options.gitEnvironment) {
    for (const [key, value] of Object.entries(options.gitEnvironment)) {
      if (
        !SAFE_TOKEN.test(key) ||
        typeof value !== "string" ||
        CREDENTIAL_PATTERN.test(`${key}=${value}`) ||
        (key in protectedEnvironment &&
          value !==
            protectedEnvironment[key as keyof typeof protectedEnvironment])
      ) {
        throw configurationFailure(operation);
      }
      gitEnvironment[key] = value;
    }
  }
  Object.assign(gitEnvironment, protectedEnvironment);

  return {
    repository: {
      id,
      owner,
      name,
      workingTree,
      remote,
      remoteUrl,
      baseBranch,
      branchPolicy,
      permissions: source.permissions,
    },
    github: options.github,
    gitEnvironment: Object.freeze(gitEnvironment),
  };
};

const requireBranchName = (value: unknown, operation: string): string => {
  const branch = requireString(value, DEFAULT_MAX_BRANCH_LENGTH, operation);
  const segments = branch.split("/");
  if (
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    hasForbiddenBranchCharacter(branch) ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(".lock"),
    )
  ) {
    throw configurationFailure(operation);
  }
  return branch;
};

const requireInputBranch = (
  value: unknown,
  repository: NormalizedRepository,
  operation: string,
  allowBase = false,
): string => {
  const input = requireRequestString(
    value,
    repository.branchPolicy.maxLength + 16,
    operation,
  );
  const branch = input.startsWith("refs/heads/")
    ? input.slice("refs/heads/".length)
    : input;
  if (branch.startsWith("refs/") || branch.length === 0) {
    throw requestFailure(operation);
  }
  try {
    requireBranchName(branch, operation);
  } catch (error) {
    if (error instanceof ProviderError) throw requestFailure(operation);
    throw error;
  }
  if (branch.length > repository.branchPolicy.maxLength) {
    throw requestFailure(operation);
  }
  if (!allowBase && branch === repository.baseBranch) {
    throw requestFailure(operation);
  }
  if (
    !allowBase &&
    !repository.branchPolicy.allowedPrefixes.some((prefix) =>
      branch.startsWith(prefix),
    )
  ) {
    throw requestFailure(operation);
  }
  return branch;
};

const assertSafeText = (
  value: unknown,
  maximum: number,
  operation: string,
): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    throw requestFailure(operation);
  }
  if (value.includes("\u0000") || CREDENTIAL_PATTERN.test(value)) {
    throw requestFailure(operation);
  }
  return value;
};

const runGit = async (
  options: NormalizedOptions,
  args: readonly string[],
  signal: AbortSignal | undefined,
): Promise<GitResult> => {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd: options.repository.workingTree,
      env: options.gitEnvironment,
      encoding: "utf8",
      maxBuffer: GIT_OUTPUT_BYTES,
      signal,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    if (signal?.aborted || isAbortLike(error)) throw error;
    if (isRecord(error) && error.code === "ENOENT") {
      throw spawnFailure("git");
    }
    if (isRecord(error) && typeof error.code === "number") {
      return {
        stdout: typeof error.stdout === "string" ? error.stdout : "",
        stderr: typeof error.stderr === "string" ? error.stderr : "",
        exitCode: error.code,
      };
    }
    throw error;
  }
};

const gitSuccess = async (
  options: NormalizedOptions,
  args: readonly string[],
  operation: string,
  signal: AbortSignal | undefined,
  failure: "configuration" | "protocol" | "request" = "protocol",
): Promise<string> => {
  const result = await runGit(options, args, signal);
  if (result.exitCode !== 0) {
    if (failure === "configuration") throw configurationFailure(operation);
    if (failure === "request") throw requestFailure(operation);
    throw protocolFailure(operation, true);
  }
  return result.stdout.trim();
};

const optionalCommit = async (
  options: NormalizedOptions,
  ref: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string | null> => {
  const result = await runGit(
    options,
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
    signal,
  );
  if (result.exitCode === 1 || result.exitCode === 128) return null;
  if (result.exitCode !== 0) throw protocolFailure(operation, true);
  const commit = result.stdout.trim();
  if (!FULL_COMMIT.test(commit)) throw protocolFailure(operation);
  return commit.toLowerCase();
};

const isAncestor = async (
  options: NormalizedOptions,
  ancestor: string,
  descendant: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<boolean> => {
  const result = await runGit(
    options,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    signal,
  );
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw protocolFailure(operation, true);
};

const assertRepository = async (
  options: NormalizedOptions,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<void> => {
  const configuredRoot = await realpath(options.repository.workingTree).catch(
    () => {
      throw configurationFailure(operation);
    },
  );
  const gitRoot = await gitSuccess(
    options,
    ["rev-parse", "--show-toplevel"],
    operation,
    signal,
    "configuration",
  );
  const actualRoot = await realpath(gitRoot).catch(() => {
    throw configurationFailure(operation);
  });
  if (actualRoot !== configuredRoot) throw configurationFailure(operation);

  const urlOutputs = [
    await gitSuccess(
      options,
      ["remote", "get-url", "--all", options.repository.remote],
      operation,
      signal,
      "configuration",
    ),
    await gitSuccess(
      options,
      ["remote", "get-url", "--push", "--all", options.repository.remote],
      operation,
      signal,
      "configuration",
    ),
  ];
  for (const urls of urlOutputs) {
    const remoteUrls = urls
      .split("\n")
      .map((url) => url.trim())
      .filter((url) => url.length > 0)
      .map((url) => normalizeRemoteUrl(url, operation));
    if (
      remoteUrls.length === 0 ||
      remoteUrls.some((url) => url !== options.repository.remoteUrl)
    ) {
      throw configurationFailure(operation);
    }
  }
};

const assertNoControlState = async (
  options: NormalizedOptions,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<void> => {
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REBASE_HEAD"]) {
    const result = await runGit(
      options,
      ["rev-parse", "--verify", "--quiet", "--end-of-options", marker],
      signal,
    );
    if (result.exitCode === 0) throw requestFailure(operation);
    if (result.exitCode !== 1 && result.exitCode !== 128) {
      throw protocolFailure(operation, true);
    }
  }
};

const fetchRemote = async (
  options: NormalizedOptions,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<void> => {
  await gitSuccess(
    options,
    ["fetch", "--no-tags", options.repository.remote],
    operation,
    signal,
    "protocol",
  );
};

const remoteBranchRef = (repository: NormalizedRepository, branch: string) =>
  `refs/remotes/${repository.remote}/${branch}`;

const localBranchRef = (branch: string) => `refs/heads/${branch}`;

const commitUri = (
  repository: NormalizedRepository,
  revision: string,
): string =>
  `https://github.com/${repository.owner}/${repository.name}/commit/${revision}`;

const branchUri = (repository: NormalizedRepository, branch: string): string =>
  `https://github.com/${repository.owner}/${repository.name}/tree/${branch
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;

const branchReference = (
  repository: NormalizedRepository,
  branch: string,
  revision: string,
): ProviderReference => ({
  name: branch,
  revision,
  uri: branchUri(repository, branch),
});

const commitReference = (
  repository: NormalizedRepository,
  name: string,
  revision: string,
): ProviderReference => ({
  name,
  revision,
  uri: commitUri(repository, revision),
});

const validateRepositoryInput = (
  options: NormalizedOptions,
  repository: unknown,
  operation: string,
): void => {
  if (repository !== options.repository.id) throw requestFailure(operation);
};

const resolveReadRef = (
  repository: NormalizedRepository,
  value: unknown,
  operation: string,
): { readonly name: string; readonly ref: string } => {
  const input = requireRequestString(value, 512, operation);
  if (FULL_COMMIT.test(input)) return { name: input.toLowerCase(), ref: input };

  if (input.startsWith("refs/remotes/")) {
    const prefix = `refs/remotes/${repository.remote}/`;
    if (!input.startsWith(prefix)) throw requestFailure(operation);
    const branch = input.slice(prefix.length);
    try {
      requireBranchName(branch, operation);
    } catch {
      throw requestFailure(operation);
    }
    return { name: branch, ref: input };
  }
  if (input.startsWith("refs/heads/")) {
    const branch = input.slice("refs/heads/".length);
    try {
      requireBranchName(branch, operation);
    } catch {
      throw requestFailure(operation);
    }
    return { name: branch, ref: remoteBranchRef(repository, branch) };
  }
  if (input.startsWith("refs/tags/")) {
    const tag = input.slice("refs/tags/".length);
    try {
      requireBranchName(tag, operation);
    } catch {
      throw requestFailure(operation);
    }
    return { name: tag, ref: input };
  }
  if (
    input.startsWith("refs/") ||
    input.startsWith("-") ||
    input.includes("@{")
  ) {
    throw requestFailure(operation);
  }
  let branch: string;
  try {
    branch = requireBranchName(input, operation);
  } catch {
    throw requestFailure(operation);
  }
  return { name: branch, ref: remoteBranchRef(repository, branch) };
};

const resolveCommit = async (
  options: NormalizedOptions,
  ref: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string> => {
  const revision = await optionalCommit(options, ref, operation, signal);
  if (!revision) throw requestFailure(operation);
  return revision;
};

const localBranchRevision = async (
  options: NormalizedOptions,
  branch: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string | null> =>
  optionalCommit(options, `${localBranchRef(branch)}`, operation, signal);

const remoteBranchRevision = async (
  options: NormalizedOptions,
  branch: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string | null> =>
  optionalCommit(
    options,
    `${remoteBranchRef(options.repository, branch)}`,
    operation,
    signal,
  );

const mapGithubFailure = (operation: string, error: unknown): ProviderError => {
  if (isAbortLike(error)) throw error;
  const status =
    isRecord(error) && typeof error.status === "number" ? error.status : null;
  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 422
  ) {
    return requestFailure(operation);
  }
  if (status !== null && (status === 408 || status === 429 || status >= 500)) {
    return protocolFailure(operation, true);
  }
  return protocolFailure(operation, true);
};

const githubRequest = async <Result>(
  operation: string,
  action: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await action();
  } catch (error) {
    throw mapGithubFailure(operation, error);
  }
};

const pullRequestArtifact = (
  repository: NormalizedRepository,
  number: unknown,
  title: string,
  operation: string,
): ProviderArtifact => {
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw protocolFailure(operation);
  }
  return {
    kind: "pull_request",
    ref: String(number),
    uri: `https://github.com/${repository.owner}/${repository.name}/pull/${number}`,
    title,
  };
};

const assertRemoteBranchMatchesLocal = async (
  options: NormalizedOptions,
  branch: string,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string> => {
  const local = await localBranchRevision(options, branch, operation, signal);
  const remote = await remoteBranchRevision(options, branch, operation, signal);
  if (!local || !remote || local !== remote) throw requestFailure(operation);
  return local;
};

export function createGithubScmProvider(
  sourceOptions: GithubScmProviderOptions,
): GithubScmProvider {
  const options = normalizeOptions(sourceOptions);

  const provider: GithubScmProvider = {
    kind: "scm",
    id: GITHUB_SCM_PROVIDER_ID,
    version: GITHUB_SCM_PROVIDER_VERSION,
    capabilities: SCM_CAPABILITIES,

    readBase: (input, context) =>
      executeProviderOperation(
        provider,
        "readBase",
        "readBase",
        async ({ signal }) => {
          validateRepositoryInput(options, input.repository, "readBase");
          await assertRepository(options, "readBase", signal);
          await fetchRemote(options, "readBase", signal);
          const revision = await resolveCommit(
            options,
            remoteBranchRef(options.repository, options.repository.baseBranch),
            "readBase",
            signal,
          );
          return commitReference(
            options.repository,
            options.repository.baseBranch,
            revision,
          );
        },
        context,
      ),

    readRef: (input, context) =>
      executeProviderOperation(
        provider,
        "readRef",
        "readRef",
        async ({ signal }) => {
          validateRepositoryInput(options, input.repository, "readRef");
          await assertRepository(options, "readRef", signal);
          await fetchRemote(options, "readRef", signal);
          const resolved = resolveReadRef(
            options.repository,
            input.ref,
            "readRef",
          );
          const revision = await resolveCommit(
            options,
            resolved.ref,
            "readRef",
            signal,
          );
          return commitReference(options.repository, resolved.name, revision);
        },
        context,
      ),

    createBranch: (input, context) =>
      executeProviderOperation(
        provider,
        "createBranch",
        "createBranch",
        async ({ signal }) => {
          validateRepositoryInput(options, input.repository, "createBranch");
          const branch = requireInputBranch(
            input.branch,
            options.repository,
            "createBranch",
          );
          await assertRepository(options, "createBranch", signal);
          await fetchRemote(options, "createBranch", signal);
          await assertNoControlState(options, "createBranch", signal);
          const status = await gitSuccess(
            options,
            ["status", "--porcelain=v1", "--untracked-files=all"],
            "createBranch",
            signal,
            "request",
          );
          if (status.length > 0) throw requestFailure("createBranch");
          const base = await resolveCommit(
            options,
            remoteBranchRef(options.repository, options.repository.baseBranch),
            "createBranch",
            signal,
          );
          const local = await localBranchRevision(
            options,
            branch,
            "createBranch",
            signal,
          );
          const remote = await remoteBranchRevision(
            options,
            branch,
            "createBranch",
            signal,
          );
          if (local && remote && local !== remote) {
            throw requestFailure("createBranch");
          }
          const existing = local ?? remote;
          if (existing) {
            if (
              !(await isAncestor(
                options,
                base,
                existing,
                "createBranch",
                signal,
              ))
            ) {
              throw requestFailure("createBranch");
            }
            if (!local) {
              await gitSuccess(
                options,
                ["switch", "--no-guess", "--create", branch, existing],
                "createBranch",
                signal,
                "request",
              );
            } else {
              const currentBranch = await gitSuccess(
                options,
                ["branch", "--show-current"],
                "createBranch",
                signal,
                "request",
              );
              if (currentBranch !== branch) {
                await gitSuccess(
                  options,
                  ["switch", "--no-guess", branch],
                  "createBranch",
                  signal,
                  "request",
                );
              }
            }
            return branchReference(options.repository, branch, existing);
          }
          await gitSuccess(
            options,
            ["switch", "--no-guess", "--create", branch, base],
            "createBranch",
            signal,
            "request",
          );
          return branchReference(options.repository, branch, base);
        },
        context,
      ),

    commit: (input, context) =>
      executeProviderOperation(
        provider,
        "commit",
        "commit",
        async ({ signal }) => {
          if (!options.repository.permissions.commit) {
            throw requestFailure("commit");
          }
          validateRepositoryInput(options, input.repository, "commit");
          const branch = requireInputBranch(
            input.branch,
            options.repository,
            "commit",
          );
          const message = assertSafeText(
            input.message,
            MAX_MESSAGE_LENGTH,
            "commit",
          );
          await assertRepository(options, "commit", signal);
          await assertNoControlState(options, "commit", signal);
          const currentBranch = await gitSuccess(
            options,
            ["branch", "--show-current"],
            "commit",
            signal,
            "request",
          );
          if (currentBranch !== branch) throw requestFailure("commit");
          const status = await gitSuccess(
            options,
            ["status", "--porcelain=v1", "--untracked-files=all"],
            "commit",
            signal,
            "request",
          );
          if (status.length === 0) throw requestFailure("commit");
          const unresolved = await gitSuccess(
            options,
            ["diff", "--name-only", "--diff-filter=U"],
            "commit",
            signal,
            "request",
          );
          if (unresolved.length > 0) throw requestFailure("commit");
          await gitSuccess(
            options,
            ["add", "--all", "--", "."],
            "commit",
            signal,
          );
          await gitSuccess(
            options,
            ["commit", "-m", message],
            "commit",
            signal,
            "request",
          );
          const revision = await gitSuccess(
            options,
            ["rev-parse", "--verify", "HEAD^{commit}"],
            "commit",
            signal,
          );
          if (!FULL_COMMIT.test(revision)) throw protocolFailure("commit");
          return commitReference(
            options.repository,
            branch,
            revision.toLowerCase(),
          );
        },
        context,
      ),

    push: (input, context) =>
      executeProviderOperation(
        provider,
        "push",
        "push",
        async ({ signal }) => {
          if (!options.repository.permissions.push) {
            throw requestFailure("push");
          }
          validateRepositoryInput(options, input.repository, "push");
          const branch = requireInputBranch(
            input.ref,
            options.repository,
            "push",
          );
          await assertRepository(options, "push", signal);
          await fetchRemote(options, "push", signal);
          const local = await localBranchRevision(
            options,
            branch,
            "push",
            signal,
          );
          if (!local) throw requestFailure("push");
          const remote = await remoteBranchRevision(
            options,
            branch,
            "push",
            signal,
          );
          if (remote === local)
            return branchReference(options.repository, branch, local);
          if (
            remote &&
            !(await isAncestor(options, remote, local, "push", signal))
          ) {
            throw requestFailure("push");
          }
          await gitSuccess(
            options,
            [
              "push",
              "--no-follow-tags",
              options.repository.remote,
              `refs/heads/${branch}:refs/heads/${branch}`,
            ],
            "push",
            signal,
            "request",
          );
          return branchReference(options.repository, branch, local);
        },
        context,
      ),

    createDraftPullRequest: (input, context) =>
      executeProviderOperation(
        provider,
        "createDraftPullRequest",
        "createDraftPullRequest",
        async ({ signal }) => {
          if (!options.repository.permissions.pullRequest) {
            throw requestFailure("createDraftPullRequest");
          }
          validateRepositoryInput(
            options,
            input.repository,
            "createDraftPullRequest",
          );
          const head = requireInputBranch(
            input.head,
            options.repository,
            "createDraftPullRequest",
          );
          const base = requireRequestString(
            input.base,
            options.repository.branchPolicy.maxLength,
            "createDraftPullRequest",
          );
          if (base !== options.repository.baseBranch) {
            throw requestFailure("createDraftPullRequest");
          }
          const title = assertSafeText(
            input.title,
            MAX_PULL_REQUEST_TITLE_LENGTH,
            "createDraftPullRequest",
          );
          const body =
            input.body === undefined
              ? undefined
              : assertSafeText(
                  input.body,
                  MAX_PULL_REQUEST_BODY_LENGTH,
                  "createDraftPullRequest",
                );
          await assertRepository(options, "createDraftPullRequest", signal);
          await fetchRemote(options, "createDraftPullRequest", signal);
          await assertRemoteBranchMatchesLocal(
            options,
            head,
            "createDraftPullRequest",
            signal,
          );

          const response = await githubRequest("createDraftPullRequest", () =>
            options.github.rest.pulls.list({
              owner: options.repository.owner,
              repo: options.repository.name,
              head: `${options.repository.owner}:${head}`,
              state: "open",
              per_page: 100,
              request: { signal },
            }),
          );
          const openMatches = response.data.filter(
            (pullRequest) =>
              pullRequest.state === "open" &&
              pullRequest.head.ref === head &&
              pullRequest.head.label === `${options.repository.owner}:${head}`,
          );
          const exactMatches = openMatches.filter(
            (pullRequest) => pullRequest.base.ref === base,
          );
          if (
            openMatches.some((pullRequest) => pullRequest.base.ref !== base)
          ) {
            throw requestFailure("createDraftPullRequest");
          }
          if (exactMatches.length > 1) {
            throw requestFailure("createDraftPullRequest");
          }
          if (exactMatches.length === 1) {
            return pullRequestArtifact(
              options.repository,
              exactMatches[0].number,
              title,
              "createDraftPullRequest",
            );
          }

          const created = await githubRequest("createDraftPullRequest", () =>
            options.github.rest.pulls.create({
              owner: options.repository.owner,
              repo: options.repository.name,
              head,
              base,
              title,
              ...(body === undefined ? {} : { body }),
              draft: true,
              request: { signal },
            }),
          );
          if (created.data.draft !== true) {
            throw protocolFailure("createDraftPullRequest");
          }
          return pullRequestArtifact(
            options.repository,
            created.data.number,
            title,
            "createDraftPullRequest",
          );
        },
        context,
      ),

    collectArtifact: (input, context) =>
      executeProviderOperation(
        provider,
        "collectArtifact",
        "collectArtifact",
        async ({ signal }) => {
          validateRepositoryInput(options, input.repository, "collectArtifact");
          const ref = requireRequestString(input.ref, 512, "collectArtifact");
          if (FULL_COMMIT.test(ref)) {
            await assertRepository(options, "collectArtifact", signal);
            await fetchRemote(options, "collectArtifact", signal);
            const revision = await resolveCommit(
              options,
              ref,
              "collectArtifact",
              signal,
            );
            return {
              kind: "commit",
              ref: revision,
              uri: commitUri(options.repository, revision),
            };
          }
          const resolved = resolveReadRef(
            options.repository,
            ref,
            "collectArtifact",
          );
          if (resolved.ref.startsWith("refs/tags/")) {
            throw requestFailure("collectArtifact");
          }
          const branch = resolved.name;
          if (
            branch !== options.repository.baseBranch &&
            !options.repository.branchPolicy.allowedPrefixes.some((prefix) =>
              branch.startsWith(prefix),
            )
          ) {
            throw requestFailure("collectArtifact");
          }
          await assertRepository(options, "collectArtifact", signal);
          await fetchRemote(options, "collectArtifact", signal);
          await resolveCommit(options, resolved.ref, "collectArtifact", signal);
          return {
            kind: "branch",
            ref: branch,
            uri: branchUri(options.repository, branch),
          };
        },
        context,
      ),
  };

  return Object.freeze(provider);
}

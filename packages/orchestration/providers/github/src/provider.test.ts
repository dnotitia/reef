import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";
import type { ProviderError } from "@reef/orchestrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  GITHUB_SCM_PROVIDER_ID,
  GITHUB_SCM_PROVIDER_VERSION,
  type GithubScmProviderOptions,
  createGithubScmProvider,
} from "./index.js";

const execFileAsync = promisify(execFile);
const PATH = process.env.PATH ?? "/usr/bin:/bin";
const GIT_ENVIRONMENT = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  PATH,
};

interface PullRequestFixture {
  readonly number: number;
  readonly state: "open" | "closed";
  draft: boolean;
  readonly head: { readonly ref: string; readonly label: string };
  readonly base: { readonly ref: string };
  readonly title?: string;
}

interface MockGithubState {
  pulls: PullRequestFixture[];
  nextNumber: number;
  listStatus: number | undefined;
  createStatus: number | undefined;
  listRequests: number;
  createRequests: number;
  lastCreateBody: Record<string, unknown> | undefined;
}

interface MockGithub {
  readonly state: MockGithubState;
  readonly client: Octokit;
  readonly close: () => Promise<void>;
}

interface RepositoryFixture {
  readonly root: string;
  readonly repository: string;
  readonly remote: string;
  readonly firstCommit: string;
  readonly api: MockGithub;
  readonly close: () => Promise<void>;
}

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await execFileAsync("git", [...args], {
    cwd,
    env: GIT_ENVIRONMENT,
    maxBuffer: 256 * 1024,
  });
  return result.stdout.trim();
};

const expectProviderCode = async (
  operation: Promise<unknown> | unknown,
  code: ProviderError["code"],
): Promise<void> => {
  await expect(Promise.resolve(operation)).rejects.toMatchObject({
    name: "ProviderError",
    code,
  });
};

const jsonResponse = (
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
};

const startMockGithub = async (): Promise<MockGithub> => {
  const state: MockGithubState = {
    pulls: [],
    nextNumber: 1,
    listStatus: undefined,
    createStatus: undefined,
    listRequests: 0,
    createRequests: 0,
    lastCreateBody: undefined,
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      request.method === "GET" &&
      /\/repos\/[^/]+\/[^/]+\/pulls$/u.test(url.pathname)
    ) {
      state.listRequests += 1;
      if (state.listStatus !== undefined) {
        jsonResponse(response, state.listStatus, {
          message: "fixture token=transport-secret-value /private/worktree",
        });
        return;
      }
      jsonResponse(response, 200, state.pulls);
      return;
    }
    if (
      request.method === "POST" &&
      /\/repos\/[^/]+\/[^/]+\/pulls$/u.test(url.pathname)
    ) {
      state.createRequests += 1;
      if (state.createStatus !== undefined) {
        jsonResponse(response, state.createStatus, {
          message: "fixture token=transport-secret-value /private/worktree",
        });
        return;
      }
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as Record<string, unknown>;
        state.lastCreateBody = body;
        const pull: PullRequestFixture = {
          number: state.nextNumber++,
          state: "open",
          draft: body.draft === true,
          head: {
            ref: String(body.head),
            label: `example-owner:${String(body.head)}`,
          },
          base: { ref: String(body.base) },
          title: String(body.title),
        };
        state.pulls.push(pull);
        jsonResponse(response, 201, pull);
      });
      return;
    }
    jsonResponse(response, 404, { message: "not found" });
  });
  await new Promise<void>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveServer());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("mock GitHub server did not expose a port");
  }
  const client = new Octokit({
    auth: "fixture-auth",
    baseUrl: `http://127.0.0.1:${address.port}`,
  });
  return {
    state,
    client,
    close: () => closeServer(server),
  };
};

const closeServer = async (server: Server): Promise<void> => {
  if (!server.listening) return;
  await new Promise<void>((resolveServer, reject) => {
    server.close((error) => (error ? reject(error) : resolveServer()));
  });
};

const createRepository = async (): Promise<RepositoryFixture> => {
  const root = await mkdtemp(join(tmpdir(), "github-scm-provider-"));
  const repository = join(root, "repository");
  const remote = join(root, "remote.git");
  await mkdir(repository);
  await git(root, ["init", "--bare", "--quiet", remote]);
  await git(root, ["init", "--quiet", repository]);
  await git(repository, ["config", "user.name", "SCM Provider Fixture"]);
  await git(repository, ["config", "user.email", "scm-provider@example.test"]);
  await writeFile(join(repository, "README.md"), "initial\n");
  await git(repository, ["add", "--", "README.md"]);
  await git(repository, ["commit", "--quiet", "-m", "initial"]);
  await git(repository, ["branch", "--move", "main"]);
  await git(repository, ["remote", "add", "origin", remote]);
  await git(repository, ["push", "--quiet", "origin", "main"]);
  const firstCommit = await git(repository, ["rev-parse", "HEAD"]);
  const api = await startMockGithub();
  return {
    root,
    repository,
    remote,
    firstCommit,
    api,
    close: async () => {
      await api.close();
      await rm(root, { recursive: true, force: true });
    },
  };
};

const providerOptions = (
  fixture: RepositoryFixture,
  overrides: Partial<GithubScmProviderOptions["repository"]> = {},
  providerOverrides: Partial<GithubScmProviderOptions> = {},
): GithubScmProviderOptions => ({
  repository: {
    id: "repo-1",
    owner: "example-owner",
    name: "example-repo",
    workingTree: fixture.repository,
    remote: "origin",
    remoteUrl: fixture.remote,
    baseBranch: "main",
    branchPolicy: { allowedPrefixes: ["run/"] },
    permissions: { commit: true, push: true, pullRequest: true },
    ...overrides,
  },
  github: fixture.api.client,
  ...providerOverrides,
});

const createProvider = (
  fixture: RepositoryFixture,
  overrides: Partial<GithubScmProviderOptions["repository"]> = {},
  providerOverrides: Partial<GithubScmProviderOptions> = {},
) =>
  createGithubScmProvider(
    providerOptions(fixture, overrides, providerOverrides),
  );

const prepareChange = async (
  fixture: RepositoryFixture,
  branch: string,
  fileName: string,
  content: string,
): Promise<void> => {
  await writeFile(join(fixture.repository, fileName), content);
  expect(await git(fixture.repository, ["branch", "--show-current"])).toBe(
    branch,
  );
};

const pushDivergentCommit = async (
  fixture: RepositoryFixture,
  branch: string,
): Promise<void> => {
  const clone = join(
    fixture.root,
    `clone-${basename(branch).replaceAll("/", "-")}`,
  );
  const remoteBranch = await git(fixture.root, [
    "ls-remote",
    "--heads",
    fixture.remote,
    branch,
  ]);
  await git(fixture.root, ["clone", "--quiet", fixture.remote, clone]);
  await git(clone, ["config", "user.name", "Divergent Fixture"]);
  await git(clone, ["config", "user.email", "divergent@example.test"]);
  await git(clone, [
    "switch",
    "--quiet",
    "--create",
    branch,
    remoteBranch.length > 0 ? `origin/${branch}` : "origin/main",
  ]);
  await writeFile(join(clone, "divergent.txt"), "remote\n");
  await git(clone, ["add", "--", "divergent.txt"]);
  await git(clone, ["commit", "--quiet", "-m", "remote divergence"]);
  await git(clone, ["push", "--quiet", "origin", branch]);
};

const fixtures: RepositoryFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("GitHub SCM provider", () => {
  it("exposes scm identity, all seven capabilities, and the package-root contract", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);

    expect(provider.kind).toBe("scm");
    expect(provider.id).toBe(GITHUB_SCM_PROVIDER_ID);
    expect(provider.version).toBe(GITHUB_SCM_PROVIDER_VERSION);
    expect(provider.capabilities).toEqual([
      "readBase",
      "readRef",
      "createBranch",
      "commit",
      "push",
      "createDraftPullRequest",
      "collectArtifact",
    ]);
    expect(Object.keys(provider)).toEqual(
      expect.arrayContaining([
        "readBase",
        "readRef",
        "createBranch",
        "commit",
        "push",
        "createDraftPullRequest",
        "collectArtifact",
      ]),
    );
  });

  it("resolves the configured base and remote branch to full commits and canonical HTTPS commit URIs", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);

    const base = await provider.readBase({ repository: "repo-1" }, {});
    const ref = await provider.readRef(
      { repository: "repo-1", ref: "refs/heads/main" },
      {},
    );

    expect(base).toEqual({
      name: "main",
      revision: fixture.firstCommit,
      uri: `https://github.com/example-owner/example-repo/commit/${fixture.firstCommit}`,
    });
    expect(ref).toEqual(base);
  });

  it("rejects missing, ambiguous-or-unsafe, non-commit refs and remote identity mismatch before mutation", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);

    await expectProviderCode(
      provider.readRef({ repository: "repo-1", ref: "run/missing" }, {}),
      "request",
    );
    await expectProviderCode(
      provider.readRef({ repository: "repo-1", ref: "main^{commit}" }, {}),
      "request",
    );
    const blob = await git(fixture.repository, [
      "hash-object",
      "-w",
      "README.md",
    ]);
    await git(fixture.repository, [
      "update-ref",
      "refs/remotes/origin/blob-ref",
      blob,
    ]);
    await expectProviderCode(
      provider.readRef(
        { repository: "repo-1", ref: "refs/remotes/origin/blob-ref" },
        {},
      ),
      "request",
    );

    await git(fixture.repository, [
      "remote",
      "set-url",
      "origin",
      join(fixture.root, "other.git"),
    ]);
    await expectProviderCode(
      provider.readBase({ repository: "repo-1" }, {}),
      "configuration",
    );
    expect(await git(fixture.repository, ["rev-parse", "HEAD"])).toBe(
      fixture.firstCommit,
    );
  });

  it("creates and checks out a deterministic branch, reuses its same-history local state, and fails closed on local-remote collision", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);

    const created = await provider.createBranch(
      { repository: "repo-1", branch: "run/collision" },
      {},
    );
    expect(created.revision).toBe(fixture.firstCommit);
    expect(await git(fixture.repository, ["branch", "--show-current"])).toBe(
      "run/collision",
    );
    const reused = await provider.createBranch(
      { repository: "repo-1", branch: "run/collision" },
      {},
    );
    expect(reused).toEqual(created);

    await pushDivergentCommit(fixture, "run/collision");
    await expectProviderCode(
      provider.createBranch(
        { repository: "repo-1", branch: "run/collision" },
        {},
      ),
      "request",
    );
    expect(await git(fixture.repository, ["branch", "--show-current"])).toBe(
      "run/collision",
    );
  });

  it("enforces commit permission, exact branch, clean control state, non-empty changes, and secret-safe messages", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);
    await provider.createBranch(
      { repository: "repo-1", branch: "run/commit" },
      {},
    );

    const before = await git(fixture.repository, ["rev-parse", "HEAD"]);
    await expectProviderCode(
      provider.commit(
        { repository: "repo-1", branch: "run/commit", message: "empty" },
        {},
      ),
      "request",
    );
    await writeFile(join(fixture.repository, "change.txt"), "change\n");
    await expectProviderCode(
      provider.commit(
        {
          repository: "repo-1",
          branch: "run/commit",
          message: "token=redaction-test-value",
        },
        {},
      ),
      "request",
    );
    expect(await git(fixture.repository, ["rev-parse", "HEAD"])).toBe(before);
    expect(
      await git(fixture.repository, ["status", "--porcelain=v1"]),
    ).not.toBe("");

    const denied = createProvider(fixture, {
      permissions: { commit: false, push: true, pullRequest: true },
    });
    await expectProviderCode(
      denied.commit(
        { repository: "repo-1", branch: "run/commit", message: "safe" },
        {},
      ),
      "request",
    );
  });

  it("commits one non-empty exact-branch change and returns only a full commit reference", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);
    await provider.createBranch(
      { repository: "repo-1", branch: "run/commit" },
      {},
    );
    await prepareChange(fixture, "run/commit", "change.txt", "change\n");

    const result = await provider.commit(
      { repository: "repo-1", branch: "run/commit", message: "record change" },
      {},
    );
    expect(result.revision).toMatch(/^[0-9a-f]{40}$/u);
    expect(result.revision).not.toBe(fixture.firstCommit);
    expect(result.uri).toBe(
      `https://github.com/example-owner/example-repo/commit/${result.revision}`,
    );
    expect(JSON.stringify(result)).not.toContain(fixture.repository);
    expect(await git(fixture.repository, ["status", "--porcelain=v1"])).toBe(
      "",
    );
  });

  it("pushes only fast-forward branch refs, treats the same remote SHA as a no-op, and rejects default, tag, force, and refspec inputs", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);
    await provider.createBranch(
      { repository: "repo-1", branch: "run/push" },
      {},
    );
    await writeFile(join(fixture.repository, "push.txt"), "local\n");
    await git(fixture.repository, ["add", "--", "push.txt"]);
    await git(fixture.repository, ["commit", "--quiet", "-m", "push local"]);
    const localRevision = await git(fixture.repository, ["rev-parse", "HEAD"]);

    const pushed = await provider.push(
      { repository: "repo-1", ref: "run/push" },
      {},
    );
    expect(pushed.revision).toBe(localRevision);
    expect(
      await git(fixture.repository, [
        "ls-remote",
        fixture.remote,
        "refs/heads/run/push",
      ]),
    ).toContain(localRevision);
    const requestCountBeforeNoOp = await git(fixture.repository, [
      "rev-parse",
      "--verify",
      "refs/remotes/origin/run/push",
    ]);
    expect(
      await provider.push({ repository: "repo-1", ref: "run/push" }, {}),
    ).toEqual(pushed);
    expect(
      await git(fixture.repository, [
        "rev-parse",
        "--verify",
        "refs/remotes/origin/run/push",
      ]),
    ).toBe(requestCountBeforeNoOp);

    await pushDivergentCommit(fixture, "run/push");
    await expectProviderCode(
      provider.push({ repository: "repo-1", ref: "run/push" }, {}),
      "request",
    );
    await expectProviderCode(
      provider.push({ repository: "repo-1", ref: "main" }, {}),
      "request",
    );
    await expectProviderCode(
      provider.push({ repository: "repo-1", ref: "refs/tags/v1" }, {}),
      "request",
    );
    await expectProviderCode(
      provider.push(
        { repository: "repo-1", ref: "run/push:refs/heads/main" },
        {},
      ),
      "request",
    );
  });

  it("creates one draft pull request, reuses an exact open draft, and leaves an existing ready PR unchanged", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);
    await provider.createBranch({ repository: "repo-1", branch: "run/pr" }, {});
    await writeFile(join(fixture.repository, "pr.txt"), "pr\n");
    await git(fixture.repository, ["add", "--", "pr.txt"]);
    await git(fixture.repository, ["commit", "--quiet", "-m", "pr"]);
    await provider.push({ repository: "repo-1", ref: "run/pr" }, {});

    const created = await provider.createDraftPullRequest(
      {
        repository: "repo-1",
        head: "run/pr",
        base: "main",
        title: "Draft change",
        body: "Body",
      },
      {},
    );
    expect(created).toEqual({
      kind: "pull_request",
      ref: "1",
      uri: "https://github.com/example-owner/example-repo/pull/1",
      title: "Draft change",
    });
    expect(fixture.api.state.lastCreateBody).toMatchObject({
      head: "run/pr",
      base: "main",
      draft: true,
    });
    const reused = await provider.createDraftPullRequest(
      {
        repository: "repo-1",
        head: "run/pr",
        base: "main",
        title: "Different caller title",
      },
      {},
    );
    expect(reused.ref).toBe("1");
    expect(fixture.api.state.createRequests).toBe(1);
    fixture.api.state.pulls[0].draft = false;
    const ready = await provider.createDraftPullRequest(
      {
        repository: "repo-1",
        head: "run/pr",
        base: "main",
        title: "Ready caller title",
      },
      {},
    );
    expect(ready.ref).toBe("1");
    expect(fixture.api.state.createRequests).toBe(1);
  });

  it("does not reuse closed or mismatched pull requests and rejects multiple open candidates", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);
    await provider.createBranch({ repository: "repo-1", branch: "run/pr" }, {});
    await writeFile(join(fixture.repository, "pr.txt"), "pr\n");
    await git(fixture.repository, ["add", "--", "pr.txt"]);
    await git(fixture.repository, ["commit", "--quiet", "-m", "pr"]);
    await provider.push({ repository: "repo-1", ref: "run/pr" }, {});
    fixture.api.state.pulls.push({
      number: 10,
      state: "closed",
      draft: false,
      head: { ref: "run/pr", label: "example-owner:run/pr" },
      base: { ref: "main" },
    });
    const created = await provider.createDraftPullRequest(
      { repository: "repo-1", head: "run/pr", base: "main", title: "new" },
      {},
    );
    expect(created.ref).toBe("1");
    expect(fixture.api.state.createRequests).toBe(1);

    fixture.api.state.pulls = [
      {
        number: 20,
        state: "open",
        draft: true,
        head: { ref: "run/pr", label: "example-owner:run/pr" },
        base: { ref: "release" },
      },
    ];
    await expectProviderCode(
      provider.createDraftPullRequest(
        {
          repository: "repo-1",
          head: "run/pr",
          base: "main",
          title: "mismatch",
        },
        {},
      ),
      "request",
    );
    fixture.api.state.pulls = [
      {
        number: 21,
        state: "open",
        draft: true,
        head: { ref: "run/pr", label: "example-owner:run/pr" },
        base: { ref: "main" },
      },
      {
        number: 22,
        state: "open",
        draft: true,
        head: { ref: "run/pr", label: "example-owner:run/pr" },
        base: { ref: "main" },
      },
    ];
    await expectProviderCode(
      provider.createDraftPullRequest(
        {
          repository: "repo-1",
          head: "run/pr",
          base: "main",
          title: "multiple",
        },
        {},
      ),
      "request",
    );
  });

  it("distinguishes cancellation and GitHub permission failures while redacting tokens, paths, and raw payloads", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);
    const controller = new AbortController();
    controller.abort();
    const cancellation = provider.readBase(
      { repository: "repo-1" },
      { signal: controller.signal },
    );
    await expectProviderCode(cancellation, "cancelled");
    expect(fixture.api.state.listRequests).toBe(0);

    await provider.createBranch(
      { repository: "repo-1", branch: "run/error" },
      {},
    );
    await writeFile(join(fixture.repository, "error.txt"), "error\n");
    await git(fixture.repository, ["add", "--", "error.txt"]);
    await git(fixture.repository, ["commit", "--quiet", "-m", "error"]);
    await provider.push({ repository: "repo-1", ref: "run/error" }, {});
    fixture.api.state.listStatus = 403;
    const rejected = provider.createDraftPullRequest(
      {
        repository: "repo-1",
        head: "run/error",
        base: "main",
        title: "safe",
      },
      {},
    );
    await expectProviderCode(rejected, "request");
    try {
      await rejected;
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain("transport-secret-value");
      expect(serialized).not.toContain("/private/worktree");
      expect(serialized).not.toContain("fixture token");
    }

    await expectProviderCode(
      provider.createDraftPullRequest(
        {
          repository: "repo-1",
          head: "run/error",
          base: "main",
          title: "token=transport-secret-value",
          body: fixture.repository,
        },
        {},
      ),
      "request",
    );
  });

  it("runs the real fetch-branch-commit-push-draft-PR-artifact flow without external repository mutation", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture);
    const provider = createProvider(fixture);

    const base = await provider.readBase({ repository: "repo-1" }, {});
    const branch = await provider.createBranch(
      { repository: "repo-1", branch: "run/end-to-end" },
      {},
    );
    await writeFile(join(fixture.repository, "flow.txt"), "flow\n");
    const commit = await provider.commit(
      {
        repository: "repo-1",
        branch: "run/end-to-end",
        message: "flow commit",
      },
      {},
    );
    const pushed = await provider.push(
      { repository: "repo-1", ref: "run/end-to-end" },
      {},
    );
    const pullRequest = await provider.createDraftPullRequest(
      {
        repository: "repo-1",
        head: "run/end-to-end",
        base: "main",
        title: "Flow",
      },
      {},
    );
    const branchArtifact = await provider.collectArtifact(
      { repository: "repo-1", ref: "run/end-to-end" },
      {},
    );
    const commitArtifact = await provider.collectArtifact(
      { repository: "repo-1", ref: commit.revision },
      {},
    );

    expect(base.revision).toBe(fixture.firstCommit);
    expect(branch.revision).toBe(fixture.firstCommit);
    expect(commit.revision).toMatch(/^[0-9a-f]{40}$/u);
    expect(pushed.revision).toBe(commit.revision);
    expect(pullRequest.kind).toBe("pull_request");
    expect(branchArtifact).toEqual({
      kind: "branch",
      ref: "run/end-to-end",
      uri: "https://github.com/example-owner/example-repo/tree/run/end-to-end",
    });
    expect(commitArtifact).toEqual({
      kind: "commit",
      ref: commit.revision,
      uri: `https://github.com/example-owner/example-repo/commit/${commit.revision}`,
    });
    expect(
      JSON.stringify({ base, branch, commit, pushed, pullRequest }),
    ).not.toContain(fixture.repository);
    expect(await git(fixture.repository, ["status", "--porcelain=v1"])).toBe(
      "",
    );
    expect(await readFile(join(fixture.repository, "flow.txt"), "utf8")).toBe(
      "flow\n",
    );
  });
});

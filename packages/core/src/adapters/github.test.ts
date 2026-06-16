import { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockOpenTelemetry } from "../agents/tools/__test-helpers__/otelMock";
import { AuthError, GitHubApiError, NotFoundError } from "../errors";
import { createGitHubAdapter, listLabelsForRepo } from "./github";

mockOpenTelemetry();

// ─── listLabelsForRepo ────────────────────────────────────────────────────────

describe("listLabelsForRepo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns RepoLabel[] on happy path", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockResolvedValueOnce([
      { name: "bug", description: "Something isn't working", color: "d73a4a" },
      { name: "enhancement", description: null, color: "a2eeef" },
    ] as never);

    const result = await listLabelsForRepo({
      adapter,
      owner: "owner",
      repo: "repo",
    });

    expect(result).toEqual([
      { name: "bug", description: "Something isn't working", color: "d73a4a" },
      { name: "enhancement", description: null, color: "a2eeef" },
    ]);
  });

  it("caps the result at MAX_REPO_LABELS (200)", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    const allItems = Array.from({ length: 250 }, (_, i) => ({
      name: `label-${i}`,
      description: null,
      color: "ededed",
    }));
    vi.spyOn(adapter.rest, "paginate").mockResolvedValueOnce(allItems as never);

    const result = await listLabelsForRepo({
      adapter,
      owner: "owner",
      repo: "repo",
    });

    expect(result).toHaveLength(200);
    expect(result[0].name).toBe("label-0");
    expect(result[199].name).toBe("label-199");
  });

  it("normalizes undefined description to null", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockResolvedValueOnce([
      { name: "bug", color: "d73a4a" },
    ] as never);

    const result = await listLabelsForRepo({
      adapter,
      owner: "owner",
      repo: "repo",
    });

    expect(result[0].description).toBeNull();
  });

  it("maps 404 → NotFoundError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockRejectedValueOnce({
      status: 404,
      message: "Not Found",
    });

    await expect(
      listLabelsForRepo({ adapter, owner: "missing", repo: "repo" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps 401 → AuthError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockRejectedValueOnce({
      status: 401,
      message: "Bad credentials",
    });

    await expect(
      listLabelsForRepo({ adapter, owner: "owner", repo: "repo" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("maps unknown statuses → GitHubApiError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockRejectedValueOnce({
      status: 500,
      message: "Server error",
    });

    await expect(
      listLabelsForRepo({ adapter, owner: "owner", repo: "repo" }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});

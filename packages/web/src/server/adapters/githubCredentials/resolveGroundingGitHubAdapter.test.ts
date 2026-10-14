// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { GitHubAdapter } from "@/server/adapters/githubAdapter";
import { GitHubApiError } from "@reef/core";
import {
  resolveGitHubAdapter,
  type ResolveGitHubAdapterResult,
} from "./resolveGitHubAdapter";
import { resolveGroundingGitHubAdapter } from "./resolveGroundingGitHubAdapter";

vi.mock("./resolveGitHubAdapter", () => ({ resolveGitHubAdapter: vi.fn() }));

const adapter = { adapter: "sentinel" } as unknown as GitHubAdapter;
const error = new GitHubApiError({
  status: 403,
  message: "installation token request failed",
});

describe("resolveGroundingGitHubAdapter", () => {
  it.each([
    [
      { kind: "adapter", adapter, source: "app" },
      { kind: "adapter", adapter },
    ],
    [
      { kind: "adapter", adapter, source: "server-pat" },
      { kind: "adapter", adapter },
    ],
    [
      {
        kind: "session_invalid",
        response: Response.json({ error: "expired" }, { status: 401 }),
      },
      { kind: "degraded", reason: "session_unverified" },
    ],
    [
      { kind: "github_app_error", error },
      { kind: "degraded", reason: "github_app_error", error },
    ],
    [{ kind: "no_credential" }, { kind: "degraded", reason: "no_credential" }],
  ] satisfies Array<[ResolveGitHubAdapterResult, object]>)(
    "maps resolver outcome %j to grounding outcome",
    async (resolved, expected) => {
      vi.mocked(resolveGitHubAdapter).mockResolvedValueOnce(resolved);
      const request = new Request("http://localhost/api/agents/runs");
      expect(await resolveGroundingGitHubAdapter(request)).toEqual(expected);
      expect(resolveGitHubAdapter).toHaveBeenLastCalledWith(request);
    },
  );
});

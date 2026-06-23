// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isServerGitHubPatConfigured,
  resolveServerGitHubPat,
} from "./serverPat";

describe("server GitHub PAT fallback", () => {
  it("resolves a configured token, trimming surrounding whitespace", () => {
    expect(
      resolveServerGitHubPat({
        NODE_ENV: "test",
        REEF_GITHUB_PAT: "  ghp_dev_token  ",
      }),
    ).toBe("ghp_dev_token");
    expect(
      isServerGitHubPatConfigured({
        NODE_ENV: "test",
        REEF_GITHUB_PAT: "ghp_dev_token",
      }),
    ).toBe(true);
  });

  it("reports disabled when REEF_GITHUB_PAT is unset", () => {
    expect(resolveServerGitHubPat({ NODE_ENV: "test" })).toBeNull();
    expect(isServerGitHubPatConfigured({ NODE_ENV: "test" })).toBe(false);
  });

  it("treats a blank or whitespace-only value as disabled", () => {
    expect(
      resolveServerGitHubPat({ NODE_ENV: "test", REEF_GITHUB_PAT: "   " }),
    ).toBeNull();
    expect(
      isServerGitHubPatConfigured({ NODE_ENV: "test", REEF_GITHUB_PAT: "" }),
    ).toBe(false);
  });
});

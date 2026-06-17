// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/credentials", () => ({
  getGitHubToken: vi.fn(async () => null),
  setGitHubToken: vi.fn(async () => {}),
}));

import { GitHubTokenInput } from "./GitHubTokenInput";

/**
 * REEF-226: the PAT field was the lone input on `focus:ring-brand/40` — a bare
 * `focus:` trigger (rings on mouse click) at a heavier opacity than the rest of
 * the input family. Lock it to the shared keyboard brand/30 ring.
 */
describe("GitHubTokenInput focus ring (REEF-226)", () => {
  it("uses the shared keyboard-only brand ring, not the /40 click outlier", async () => {
    render(<GitHubTokenInput />);
    const input = await screen.findByTestId("onboarding-token-input");
    expect(input.className).toContain("focus-visible:ring-brand/30");
    expect(input.className).not.toContain("focus:ring");
    expect(input.className).not.toContain("ring-brand/40");
  });
});

/**
 * REEF-236: the scope guidance is the shared GithubScopeHint, not bespoke copy,
 * so onboarding and Preferences stay in sync.
 */
describe("GitHubTokenInput scope guidance (REEF-236)", () => {
  it("renders the shared GitHub scope hint above the token input", async () => {
    render(<GitHubTokenInput />);
    expect(await screen.findByTestId("github-scope-hint")).toBeInTheDocument();
  });
});

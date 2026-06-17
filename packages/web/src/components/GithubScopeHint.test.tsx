// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GithubScopeHint } from "./GithubScopeHint";

/**
 * REEF-236: the monitored-repo PAT scope guidance is unified in one component so
 * onboarding and Settings › Preferences cannot drift. The scope copy and the
 * token-creation deep link are the issue's done-check, asserted here once.
 */
describe("GithubScopeHint (REEF-236)", () => {
  it("names the least-privilege scopes for public and private repos, read-only", () => {
    render(<GithubScopeHint />);
    const hint = screen.getByTestId("github-scope-hint");
    expect(hint.textContent).toContain("public_repo");
    expect(hint.textContent).toContain("repo");
    expect(hint.textContent).toMatch(/read-only/i);
  });

  it("links to GitHub's token page with the repo scope preset, opening in a new tab", () => {
    render(<GithubScopeHint />);
    const link = screen.getByRole("link", { name: /create a token/i });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/settings/tokens/new?scopes=repo&description=reef",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("merges a caller className onto the default scale", () => {
    render(<GithubScopeHint className="text-xs" />);
    expect(screen.getByTestId("github-scope-hint").className).toContain(
      "text-xs",
    );
  });
});

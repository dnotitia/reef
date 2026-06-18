import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const signOutOfWorkspace = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/signOut.actions", () => ({
  signOutOfWorkspace: () => signOutOfWorkspace(),
}));

const navigateToSignOutTarget = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/signOutNavigation", () => ({
  navigateToSignOutTarget: (url: string) => navigateToSignOutTarget(url),
}));

const storage = vi.hoisted(() => ({
  clearGitHubToken: vi.fn(),
  getGitHubToken: vi.fn(),
  setGitHubToken: vi.fn(),
}));
vi.mock("@/lib/storage/credentials", () => storage);

vi.mock("@/features/preferences/components/PreferencesSection", () => ({
  PreferencesSection: () => <section>Preferences</section>,
}));

import PreferencesPage from "./page";

describe("PreferencesPage disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getGitHubToken.mockResolvedValue("ghp_token");
    storage.clearGitHubToken.mockResolvedValue(true);
  });

  it("removes only the GitHub token and returns to the token-entry form, without signing out (REEF-247)", async () => {
    const user = userEvent.setup();
    render(<PreferencesPage />);

    await user.click(await screen.findByTestId("disconnect-btn"));

    // The PAT is dropped...
    expect(storage.clearGitHubToken).toHaveBeenCalledOnce();
    // ...but the akb session is untouched: Disconnect should not sign out or
    // redirect (REEF-247 — workspace sign-out is the sidebar account menu).
    expect(signOutOfWorkspace).not.toHaveBeenCalled();
    expect(navigateToSignOutTarget).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();

    // The page stays mounted and shows the token-entry form again.
    expect(
      await screen.findByLabelText("GitHub Personal Access Token"),
    ).toBeInTheDocument();
    expect(screen.getByText("GitHub token removed.")).toBeInTheDocument();
  });

  it("keeps the configured view and warns when local storage is unavailable", async () => {
    // clearGitHubToken returns false when IndexedDB is gone: the PAT may still
    // be present, so the page should not claim removal or drop to the input form.
    storage.clearGitHubToken.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<PreferencesPage />);

    await user.click(await screen.findByTestId("disconnect-btn"));

    expect(storage.clearGitHubToken).toHaveBeenCalledOnce();
    expect(screen.getByText(/Local storage unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("GitHub token removed.")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("GitHub Personal Access Token"),
    ).not.toBeInTheDocument();
  });

  it("hides the decorative status dot from assistive tech (REEF-174)", async () => {
    const { container } = render(<PreferencesPage />);
    await screen.findByText(/GitHub token saved/);
    const dot = container.querySelector(".bg-status-done");
    expect(dot).toHaveAttribute("aria-hidden");
  });
});

describe("PreferencesPage layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getGitHubToken.mockResolvedValue("ghp_token");
  });

  it("is a personal, browser-local group at h2 with the token section at h3", async () => {
    render(<PreferencesPage />);
    expect(
      await screen.findByRole("heading", {
        name: "Your preferences",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "GitHub Access Token", level: 3 }),
    ).toBeInTheDocument();
  });

  it("does not render its own Appearance heading (PreferencesSection owns it)", async () => {
    render(<PreferencesPage />);
    await screen.findByRole("heading", { name: "Your preferences", level: 2 });
    expect(
      screen.queryByRole("heading", { name: "Appearance" }),
    ).not.toBeInTheDocument();
  });

  it("does not mount the Active Workspace selector — Preferences is not workspace-scoped (AC2)", async () => {
    render(<PreferencesPage />);
    await screen.findByRole("heading", { name: "Your preferences", level: 2 });
    expect(
      screen.queryByTestId("active-workspace-section"),
    ).not.toBeInTheDocument();
  });

  it("renders the shared GitHub scope hint while a token is configured (REEF-236)", async () => {
    // getGitHubToken resolves a token here, so the persistent section copy
    // shows instead of the input form. The scope guidance remains present:
    // this is the re-issue moment: a person changing GitHub accounts needs to
    // know the scopes before they Disconnect.
    render(<PreferencesPage />);
    await screen.findByRole("heading", { name: "Your preferences", level: 2 });
    expect(screen.getByTestId("github-scope-hint")).toBeInTheDocument();
  });
});

describe("PreferencesPage GitHub token form (REEF-151)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getGitHubToken.mockResolvedValue(null);
  });

  it("marks the token input with autocomplete=off and a name", async () => {
    render(<PreferencesPage />);
    const input = await screen.findByLabelText("GitHub Personal Access Token");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("name", "github-token");
  });

  it("disables Save Token and shows a spinner while the save is in flight", async () => {
    let resolveSave: ((ok: boolean) => void) | undefined;
    storage.setGitHubToken.mockReturnValue(
      new Promise<boolean>((res) => {
        resolveSave = res;
      }),
    );
    const user = userEvent.setup();
    render(<PreferencesPage />);

    const input = await screen.findByLabelText("GitHub Personal Access Token");
    await user.type(input, "ghp_secret");
    await user.click(screen.getByTestId("save-token-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("save-token-btn")).toBeDisabled(),
    );
    expect(screen.getByTestId("save-token-btn")).toHaveTextContent("Saving…");

    resolveSave?.(true);
    await waitFor(() =>
      expect(screen.getByText("Token saved.")).toBeInTheDocument(),
    );
  });

  it("uses focus-visible (not focus) for the token input ring (REEF-174)", async () => {
    render(<PreferencesPage />);
    const input = await screen.findByLabelText("GitHub Personal Access Token");
    expect(input.className).toContain("focus-visible:ring-2");
    expect(input.className).not.toMatch(/focus:ring/);
  });
});

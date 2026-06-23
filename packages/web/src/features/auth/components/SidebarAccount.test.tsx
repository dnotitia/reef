import type { AkbMeProfile } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface CurrentUserState {
  value: {
    data: AkbMeProfile | null;
    isLoading: boolean;
  };
}

const currentUserState = vi.hoisted<CurrentUserState>(() => ({
  value: {
    data: null,
    isLoading: false,
  },
}));

vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => currentUserState.value,
}));

const signOutOfWorkspace = vi.hoisted(() => vi.fn());
vi.mock("../signOut.actions", () => ({
  signOutOfWorkspace: () => signOutOfWorkspace(),
}));

const navigateToSignOutTarget = vi.hoisted(() => vi.fn());
vi.mock("../signOutNavigation", () => ({
  navigateToSignOutTarget: (url: string) => navigateToSignOutTarget(url),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// Isolate the embedded theme toggle from Dexie/the shared store.
const setThemeMock = vi.hoisted(() => vi.fn(async () => {}));
const themeState = vi.hoisted(() => ({
  value: "system" as "light" | "dark" | "system",
}));
vi.mock("@/features/preferences/hooks/useTheme", () => ({
  useTheme: () => ({ theme: themeState.value, setTheme: setThemeMock }),
}));

import {
  SidebarAccount,
  deriveIdentity,
  releaseNotesUrl,
} from "./SidebarAccount";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  themeState.value = "system";
  currentUserState.value = {
    data: { display_name: "Alice Example", email: "alice@example.com" },
    isLoading: false,
  };
});

describe("deriveIdentity", () => {
  it("prefers display_name and renders a single CJK initial", () => {
    expect(deriveIdentity({ display_name: "홍길동" })).toEqual({
      name: "홍길동",
      email: null,
      secondary: null,
      initials: "홍",
      login: null,
    });
  });

  it("exposes the akb username as the shared identity login (REEF-173)", () => {
    // The account avatar keys off this login so the signed-in user's avatar
    // matches how they render as an assignee elsewhere.
    expect(
      deriveIdentity({ username: "alice", display_name: "Alice Example" })
        .login,
    ).toBe("alice");
    expect(deriveIdentity({ display_name: "Alice Example" }).login).toBeNull();
    expect(deriveIdentity(null).login).toBeNull();
  });

  it("falls back to username, then a neutral Account label", () => {
    expect(deriveIdentity({ username: "alice" }).name).toBe("alice");
    expect(deriveIdentity({ username: "alice" }).initials).toBe("AL");
    expect(deriveIdentity(null).name).toBe("Account");
  });

  it("uses two-word initials for Latin names", () => {
    expect(deriveIdentity({ display_name: "Alice Example" }).initials).toBe(
      "AE",
    );
  });

  it("uses the username as the secondary line when there is no email (REEF-168)", () => {
    expect(
      deriveIdentity({ display_name: "Alice Example", username: "alice" })
        .secondary,
    ).toBe("alice");
  });

  it("prefers email over username for the secondary line (REEF-168)", () => {
    expect(
      deriveIdentity({
        display_name: "Alice Example",
        username: "alice",
        email: "alice@example.com",
      }).secondary,
    ).toBe("alice@example.com");
  });

  it("has no secondary line when the only identity is a username that equals the name", () => {
    // The username becomes the name, so repeating it below would be noise; the
    // row falls back to a single line in this rare (display_name-less) case.
    expect(deriveIdentity({ username: "alice" }).secondary).toBeNull();
  });
});

describe("releaseNotesUrl", () => {
  it("builds the release tag URL from a bare app version", () => {
    expect(releaseNotesUrl("0.4.0")).toBe(
      "https://github.com/dnotitia/reef/releases/tag/v0.4.0",
    );
  });

  it("does not duplicate a leading v in the app version", () => {
    expect(releaseNotesUrl("v0.4.0")).toBe(
      "https://github.com/dnotitia/reef/releases/tag/v0.4.0",
    );
  });
});

describe("SidebarAccount", () => {
  it("shows the identity in the expanded sidebar", () => {
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    expect(
      screen.getByRole("button", { name: "Account menu" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("makes the row full-width so the trailing chevron reaches the right edge (REEF-168)", () => {
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    const trigger = screen.getByRole("button", { name: "Account menu" });
    // The DropdownMenu root should be w-full. Without it the root is inline-block
    // (shrink-to-fit), the trigger's own w-full has nothing to fill, and the
    // chevron lands at a content-dependent x instead of the row's right edge —
    // the misalignment with the workspace row (whose Popover root is already
    // w-full). Pixels are verified in a real browser; this guards the contract.
    expect(trigger.parentElement).toHaveClass("w-full");
  });

  it("gives the trigger a focus-visible ring for keyboard users (REEF-172)", () => {
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    // The Sign out button already had a focus-visible affordance; the trigger
    // did not, so Tab focus was invisible. jsdom has no layout — this guards the
    // canonical button ring token the fix adds.
    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.className).toContain("focus-visible:ring-brand/40");
    expect(trigger.className).toContain("focus-visible:outline-none");
  });

  it("falls back to the username on the row's second line when there is no email, keeping the row two lines tall (REEF-168)", () => {
    currentUserState.value = {
      data: { display_name: "Alice Example", username: "alice" },
      isLoading: false,
    };
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("hides the name and email when collapsed", () => {
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={true} />));

    expect(screen.queryByText("Alice Example")).not.toBeInTheDocument();
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
    // The trigger still exposes the name via its title for hover discovery.
    expect(
      screen.getByRole("button", { name: "Account menu" }),
    ).toHaveAttribute("title", "Alice Example");
  });

  it("falls back to an Account label when there is no session", () => {
    currentUserState.value = { data: null, isLoading: false };
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    expect(screen.getAllByText("Account").length).toBeGreaterThan(0);
  });

  it("signs out and redirects to /login on success", async () => {
    signOutOfWorkspace.mockResolvedValue({});
    const user = userEvent.setup();
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByTestId("account-signout"));

    expect(signOutOfWorkspace).toHaveBeenCalledOnce();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login"));
  });

  it("navigates to the returned SSO logout URL when available", async () => {
    signOutOfWorkspace.mockResolvedValue({
      redirectUrl: "/api/auth/akb/sso/logout?nonce=logout-nonce",
    });
    const user = userEvent.setup();
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByTestId("account-signout"));

    await waitFor(() =>
      expect(navigateToSignOutTarget).toHaveBeenCalledWith(
        "/api/auth/akb/sso/logout?nonce=logout-nonce",
      ),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps global shortcuts out of the account identity row (REEF-170)", () => {
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    expect(
      screen.queryByRole("button", { name: "Keyboard shortcuts" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeVisible();
  });

  it("renders only the account control when collapsed (REEF-170)", () => {
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={true} />));

    expect(
      screen.queryByRole("button", { name: "Keyboard shortcuts" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveClass(
      "justify-center",
    );
  });

  it("switches theme from the menu and keeps the menu open (REEF-095)", async () => {
    themeState.value = "light";
    const user = userEvent.setup();
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    // Current preference is reflected, and the toggle lives inside the menu.
    expect(screen.getByTestId("account-theme-light")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(screen.getByTestId("account-theme-dark"));

    expect(setThemeMock).toHaveBeenCalledWith("dark");
    // Selecting a theme should not dismiss the menu — the version row is still there.
    expect(screen.getByTestId("account-version")).toBeInTheDocument();
  });

  it("links What's new to the app version's GitHub release tag", async () => {
    const user = userEvent.setup();
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    const releaseLink = screen.getByTestId("account-release-notes");
    expect(releaseLink).toHaveAttribute(
      "href",
      "https://github.com/dnotitia/reef/releases/tag/v0.4.0",
    );
    expect(releaseLink).toHaveAttribute("target", "_blank");
    expect(releaseLink).toHaveAttribute("rel", "noreferrer");
    expect(releaseLink).toHaveTextContent("What's new");
    expect(
      within(releaseLink).getByTestId("account-version"),
    ).toHaveTextContent("v0.4.0");
  });

  it("surfaces an error message when sign-out fails, keeping the menu open", async () => {
    signOutOfWorkspace.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(wrap(<SidebarAccount appVersion="0.4.0" collapsed={false} />));

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByTestId("account-signout"));

    await waitFor(() =>
      expect(screen.getByText(/couldn't sign out/i)).toBeInTheDocument(),
    );
    expect(router.push).not.toHaveBeenCalled();
  });
});

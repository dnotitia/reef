import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type VaultsState = {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  data?: Array<{ name: string; has_reef_config: boolean }>;
};

const { paramsRef, notFoundMock, syncMock, vaultsRef } = vi.hoisted(() => ({
  paramsRef: {
    current: { vault: "reef-acme" } as Record<string, string | string[]>,
  },
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  syncMock: vi.fn(),
  vaultsRef: { current: {} as VaultsState },
}));

vi.mock("next/navigation", () => ({
  useParams: () => paramsRef.current,
  notFound: notFoundMock,
}));
vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({
  useAuthRedirect: vi.fn(),
}));
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useSyncActiveVaultFromUrl: syncMock,
}));
vi.mock("@/features/settings/hooks/useVaults", () => ({
  useVaults: () => vaultsRef.current,
}));
vi.mock("./DashboardShell", () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="dashboard-shell">{children}</div>
  ),
}));
vi.mock("./WorkspaceAccessDenied", () => ({
  WorkspaceAccessDenied: ({ vault }: { vault: string }) => (
    <div data-testid="workspace-access-denied">{vault}</div>
  ),
}));

import { WorkspaceGuard } from "./WorkspaceGuard";

describe("WorkspaceGuard (REEF-315)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paramsRef.current = { vault: "reef-acme" };
    vaultsRef.current = {
      isPending: false,
      isSuccess: true,
      isError: false,
      data: [{ name: "reef-acme", has_reef_config: true }],
    };
  });

  it("renders the DashboardShell for a member's workspace and syncs the URL vault", () => {
    render(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );
    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    expect(screen.getByTestId("page")).toBeInTheDocument();
    expect(syncMock).toHaveBeenCalledWith("reef-acme");
  });

  it("404s a malformed vault segment", () => {
    paramsRef.current = { vault: "Bad_Vault" }; // uppercase → fails VAULT_NAME_RE
    expect(() =>
      render(
        <WorkspaceGuard appVersion="1.0.0">
          <span />
        </WorkspaceGuard>,
      ),
    ).toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders the shell optimistically while the vault list is loading, without persisting the unconfirmed vault", () => {
    vaultsRef.current = { isPending: true, isSuccess: false, isError: false };
    render(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );
    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-access-denied"),
    ).not.toBeInTheDocument();
    // Membership is unconfirmed → do not poison the "last viewed" default yet.
    expect(syncMock).toHaveBeenCalledWith("");
    expect(syncMock).not.toHaveBeenCalledWith("reef-acme");
  });

  it("shows the access-denied surface for a non-member and does not persist the denied vault", () => {
    vaultsRef.current = {
      isPending: false,
      isSuccess: true,
      isError: false,
      data: [{ name: "reef-other", has_reef_config: true }],
    };
    render(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );
    expect(screen.getByTestId("workspace-access-denied")).toHaveTextContent(
      "reef-acme",
    );
    expect(screen.queryByTestId("dashboard-shell")).not.toBeInTheDocument();
    // A denied deep link must never overwrite the browser default (autoreview).
    expect(syncMock).toHaveBeenCalledWith("");
    expect(syncMock).not.toHaveBeenCalledWith("reef-acme");
  });

  it("treats a bare AKB vault (member but no reef config) as not-a-workspace", () => {
    vaultsRef.current = {
      isPending: false,
      isSuccess: true,
      isError: false,
      data: [{ name: "reef-acme", has_reef_config: false }],
    };
    render(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );
    expect(screen.getByTestId("workspace-access-denied")).toBeInTheDocument();
    expect(syncMock).toHaveBeenCalledWith("");
    expect(syncMock).not.toHaveBeenCalledWith("reef-acme");
  });

  it("degrades open (renders the shell) when the vault list fails to load", () => {
    vaultsRef.current = { isPending: false, isSuccess: false, isError: true };
    render(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );
    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-access-denied"),
    ).not.toBeInTheDocument();
  });
});

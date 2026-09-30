import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type VaultsState = {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  data?: Array<{
    name: string;
    installation_status: "ready" | "not_installed";
  }>;
};

const {
  authStatusRef,
  establishedSessionRef,
  paramsRef,
  pathnameRef,
  notFoundMock,
  syncMock,
  vaultsMock,
  vaultsRef,
} = vi.hoisted(() => ({
  authStatusRef: {
    current: "active" as "checking" | "active" | "inactive" | "unavailable",
  },
  establishedSessionRef: { current: true },
  paramsRef: {
    current: { vault: "reef-acme" } as Record<string, string | string[]>,
  },
  pathnameRef: { current: "/workspace/reef-acme/issues" },
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  syncMock: vi.fn(),
  vaultsMock: vi.fn(),
  vaultsRef: { current: {} as VaultsState },
}));

vi.mock("next/navigation", () => ({
  useParams: () => paramsRef.current,
  usePathname: () => pathnameRef.current,
  useSearchParams: () => new URLSearchParams(),
  notFound: notFoundMock,
}));
vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({
  useAuthRedirect: () => authStatusRef.current,
  retryAuthSession: vi.fn(async () => undefined),
}));
vi.mock("@/lib/akb/authCoordinator", () => ({
  hasEstablishedAuthSession: () => establishedSessionRef.current,
}));
vi.mock("@/features/auth/components/AuthVerificationFallback", () => ({
  AuthVerificationFallback: ({
    mode,
    onRetry,
  }: {
    mode: "blocking" | "inline";
    onRetry: () => void;
  }) => (
    <div
      data-testid={
        mode === "blocking"
          ? "auth-verification-unavailable"
          : "auth-revalidation-status"
      }
    >
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  ),
}));
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useSyncActiveVaultFromUrl: syncMock,
}));
vi.mock("@/features/settings/hooks/useVaults", () => ({
  useVaults: ({ enabled = true }: { enabled?: boolean } = {}) => {
    if (enabled) vaultsMock();
    return enabled
      ? vaultsRef.current
      : { isPending: false, isSuccess: false, isError: false };
  },
}));
vi.mock("./WorkspaceAuthPendingSkeleton", () => ({
  WorkspaceAuthPendingSkeleton: () => <div data-testid="auth-loading-shell" />,
}));
vi.mock(
  "@/features/issues/components/detail/IssueDetailAuthPendingSkeleton",
  () => ({
    IssueDetailAuthPendingSkeleton: ({ issueId }: { issueId: string }) => (
      <div data-testid="issue-entry-handoff-shell">{issueId}</div>
    ),
  }),
);
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
import { useIssueDetailEntryHandoff } from "@/features/issues/components/detail/IssueDetailEntryHandoff";

function HandoffReadyPage() {
  const completeHandoff = useIssueDetailEntryHandoff();
  return (
    <button
      type="button"
      data-testid="handoff-ready"
      onClick={() => completeHandoff?.()}
    >
      Ready
    </button>
  );
}

describe("WorkspaceGuard (REEF-315)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStatusRef.current = "active";
    establishedSessionRef.current = true;
    paramsRef.current = { vault: "reef-acme" };
    pathnameRef.current = "/workspace/reef-acme/issues";
    vaultsRef.current = {
      isPending: false,
      isSuccess: true,
      isError: false,
      data: [{ name: "reef-acme", installation_status: "ready" }],
    };
  });

  it("does not mount workspace data queries until the session is verified", () => {
    authStatusRef.current = "checking";
    establishedSessionRef.current = false;

    render(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );

    expect(screen.getByTestId("auth-loading-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page")).not.toBeInTheDocument();
    expect(vaultsMock).not.toHaveBeenCalled();
  });

  it("keeps the static issue detail frame over the authenticated tree until the Sheet is ready", () => {
    authStatusRef.current = "checking";
    establishedSessionRef.current = false;
    pathnameRef.current = "/workspace/reef-acme/issues/REEF-001";
    const { rerender } = render(
      <WorkspaceGuard appVersion="1.0.0">
        <HandoffReadyPage />
      </WorkspaceGuard>,
    );
    expect(screen.getByTestId("auth-loading-shell")).toBeInTheDocument();

    authStatusRef.current = "active";
    establishedSessionRef.current = true;
    rerender(
      <WorkspaceGuard appVersion="1.0.0">
        <HandoffReadyPage />
      </WorkspaceGuard>,
    );

    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    expect(screen.getByTestId("issue-entry-handoff-shell")).toHaveTextContent(
      "REEF-001",
    );
    fireEvent.click(screen.getByTestId("handoff-ready"));
    expect(screen.queryByTestId("issue-entry-handoff-shell")).toBeNull();
  });

  it("keeps the established shell and mounted page content when revalidation is unavailable", () => {
    const { rerender } = render(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );
    const page = screen.getByTestId("page");

    authStatusRef.current = "unavailable";
    rerender(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );

    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    expect(screen.getByTestId("page")).toBe(page);
    expect(screen.getByTestId("auth-revalidation-status")).toBeInTheDocument();
    expect(vaultsMock).toHaveBeenCalled();
  });

  it("keeps the protected tree hidden on an unavailable first visit and offers retry", () => {
    authStatusRef.current = "unavailable";
    establishedSessionRef.current = false;

    render(
      <WorkspaceGuard appVersion="1.0.0">
        <span data-testid="page" />
      </WorkspaceGuard>,
    );

    expect(
      screen.getByTestId("auth-verification-unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page")).not.toBeInTheDocument();
    expect(vaultsMock).not.toHaveBeenCalled();
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
      data: [{ name: "reef-other", installation_status: "ready" }],
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
    // A denied deep link should leave the browser default (autoreview).
    expect(syncMock).toHaveBeenCalledWith("");
    expect(syncMock).not.toHaveBeenCalledWith("reef-acme");
  });

  it("treats a bare AKB vault (member but no reef config) as not-a-workspace", () => {
    vaultsRef.current = {
      isPending: false,
      isSuccess: true,
      isError: false,
      data: [{ name: "reef-acme", installation_status: "not_installed" }],
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

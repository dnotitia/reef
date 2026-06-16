import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "reef-acme", isLoading: false }),
}));

const { mockUseWorkspaceAccess } = vi.hoisted(() => ({
  mockUseWorkspaceAccess: vi.fn(),
}));
vi.mock("@/features/settings/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => mockUseWorkspaceAccess(),
}));

// Stub the section so the page test stays focused on the page's own wiring
// (scope echo, admin gating, vault branch) rather than the roster internals.
vi.mock("@/features/settings/components/members/MembersSection", () => ({
  MembersSection: ({
    vault,
    canManage,
  }: {
    vault: string;
    canManage: boolean;
  }) => (
    <div
      data-testid="members-section-stub"
      data-vault={vault}
      data-can-manage={String(canManage)}
    />
  ),
}));

import WorkspaceMembersPage from "./page";

describe("Workspace › Members settings page (REEF-179)", () => {
  it("renders the Members group scoped to the active workspace and mounts the section for an admin", () => {
    mockUseWorkspaceAccess.mockReturnValue({
      role: "admin",
      canEditWorkspace: true,
      isResolving: false,
    });
    render(<WorkspaceMembersPage />);

    expect(
      screen.getByRole("heading", { name: "Members", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-group-scope")).toHaveTextContent(
      "reef-acme",
    );
    const stub = screen.getByTestId("members-section-stub");
    expect(stub).toHaveAttribute("data-vault", "reef-acme");
    expect(stub).toHaveAttribute("data-can-manage", "true");
    // An admin gets the "you can edit" affordance.
    expect(screen.getByTestId("access-badge-editable")).toBeInTheDocument();
  });

  it("gates management off and shows view-only for a reader", () => {
    mockUseWorkspaceAccess.mockReturnValue({
      role: "reader",
      canEditWorkspace: false,
      isResolving: false,
    });
    render(<WorkspaceMembersPage />);

    expect(screen.getByTestId("members-section-stub")).toHaveAttribute(
      "data-can-manage",
      "false",
    );
    expect(screen.getByTestId("access-badge-view-only")).toBeInTheDocument();
  });
});

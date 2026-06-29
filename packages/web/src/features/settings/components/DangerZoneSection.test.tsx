import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  current: { role: "owner", isResolving: false } as {
    role: string | null;
    isResolving: boolean;
  },
}));
const deleteMutate = vi.hoisted(() => vi.fn());
const detachMutate = vi.hoisted(() => vi.fn());

vi.mock("@/features/settings/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => access.current,
}));

vi.mock("@/features/settings/hooks/useWorkspaceTeardown", () => ({
  useWorkspaceTeardown: () => ({
    deleteWorkspace: { mutate: deleteMutate, isPending: false },
    detachReef: { mutate: detachMutate, isPending: false },
  }),
}));

import { DangerZoneSection } from "./DangerZoneSection";

function renderSection() {
  return render(
    <IntlTestProvider>
      <DangerZoneSection vault="reef-acme" />
    </IntlTestProvider>,
  );
}

beforeEach(() => {
  access.current = { role: "owner", isResolving: false };
  deleteMutate.mockClear();
  detachMutate.mockClear();
});

describe("DangerZoneSection", () => {
  it("shows both destructive actions for the owner", () => {
    renderSection();
    expect(screen.getByTestId("danger-zone-section")).toBeInTheDocument();
    expect(screen.getByTestId("danger-zone-detach")).toBeInTheDocument();
    expect(screen.getByTestId("danger-zone-delete")).toBeInTheDocument();
  });

  it("renders nothing for a non-owner (admin)", () => {
    access.current = { role: "admin", isResolving: false };
    renderSection();
    expect(screen.queryByTestId("danger-zone-section")).not.toBeInTheDocument();
  });

  it("renders nothing while the role is still resolving", () => {
    access.current = { role: null, isResolving: true };
    renderSection();
    expect(screen.queryByTestId("danger-zone-section")).not.toBeInTheDocument();
  });

  it("detach opens a one-step confirm with no typing gate", () => {
    renderSection();
    fireEvent.click(screen.getByTestId("danger-zone-detach"));

    expect(screen.getByTestId("workspace-destructive-dialog")).toHaveAttribute(
      "data-mode",
      "detach",
    );
    expect(
      screen.queryByTestId("workspace-delete-confirm-input"),
    ).not.toBeInTheDocument();

    const confirm = screen.getByTestId("workspace-destructive-confirm");
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(detachMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("delete stays disabled until the workspace name is typed exactly", () => {
    renderSection();
    fireEvent.click(screen.getByTestId("danger-zone-delete"));

    expect(screen.getByTestId("workspace-destructive-dialog")).toHaveAttribute(
      "data-mode",
      "delete",
    );
    const confirm = screen.getByTestId("workspace-destructive-confirm");
    expect(confirm).toBeDisabled();

    const input = screen.getByTestId("workspace-delete-confirm-input");
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "reef-acme" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(detachMutate).not.toHaveBeenCalled();
  });
});

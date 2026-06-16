import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActiveVaultMock = vi.fn();
const useVaultsMock = vi.fn();
const useStatusMock = vi.fn();
const useApplyMock = vi.fn();

vi.mock("../hooks/useActiveVault", () => ({
  useActiveVault: () => useActiveVaultMock(),
}));
vi.mock("../hooks/useVaults", () => ({
  useVaults: () => useVaultsMock(),
}));
vi.mock("../hooks/useWorkspaceSkillStatus", () => ({
  useWorkspaceSkillStatus: () => useStatusMock(),
  useApplyWorkspaceSkillUpdate: () => useApplyMock(),
}));

import { WorkspaceSkillSection } from "./WorkspaceSkillSection";

const OUTDATED = {
  installed_version: 0,
  current_version: 1,
  up_to_date: false,
  synced_at: null,
};

interface SetupOptions {
  role?: string;
  status?: unknown;
  statusLoading?: boolean;
  apply?: Record<string, unknown>;
}

function setup({
  role = "owner",
  status = OUTDATED,
  statusLoading = false,
  apply = {},
}: SetupOptions = {}) {
  useActiveVaultMock.mockReturnValue({
    vault: "reef-acme",
    isLoading: false,
    refetch: vi.fn(),
  });
  useVaultsMock.mockReturnValue({
    data: [{ name: "reef-acme", role }],
    isLoading: false,
  });
  useStatusMock.mockReturnValue({
    data: statusLoading ? undefined : status,
    isLoading: statusLoading,
    isError: false,
  });
  const mutate = vi.fn();
  useApplyMock.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    ...apply,
  });
  return { mutate };
}

describe("WorkspaceSkillSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an up-to-date state with the last synced date in en-US format", () => {
    setup({
      status: {
        installed_version: 1,
        current_version: 1,
        up_to_date: true,
        synced_at: "2026-06-09T00:00:00.000Z",
      },
    });

    render(<WorkspaceSkillSection />);

    // The date should follow the app's fixed en-US format alongside the rest of
    // the English-hardcoded section, does not the viewer's system locale.
    expect(
      screen.getByText(/Up to date · last synced Jun 9/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("update-skill-btn")).not.toBeInTheDocument();
  });

  it("renders just 'Up to date' with no date when synced_at is null", () => {
    setup({
      status: {
        installed_version: 1,
        current_version: 1,
        up_to_date: true,
        synced_at: null,
      },
    });

    render(<WorkspaceSkillSection />);

    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.queryByText(/last synced/)).not.toBeInTheDocument();
  });

  it("offers an update when newer instructions exist and the user can write", () => {
    setup({ role: "writer" });

    render(<WorkspaceSkillSection />);

    expect(
      screen.getByText("Newer AI instructions are available."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("update-skill-btn")).toBeInTheDocument();
  });

  it("hides the action for a reader and explains who can apply it", () => {
    setup({ role: "reader" });

    render(<WorkspaceSkillSection />);

    expect(screen.getByText(/edit access/)).toBeInTheDocument();
    expect(screen.queryByTestId("update-skill-btn")).not.toBeInTheDocument();
  });

  it("requires an inline confirm that warns about the overwrite before applying", () => {
    const { mutate } = setup({ role: "owner" });

    render(<WorkspaceSkillSection />);

    fireEvent.click(screen.getByTestId("update-skill-btn"));

    expect(screen.getByText(/overwrites manual edits/)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-skill-update"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state while the status is in flight", () => {
    setup({ statusLoading: true });

    render(<WorkspaceSkillSection />);

    expect(
      screen.getByText("Checking workspace instructions…"),
    ).toBeInTheDocument();
  });
});

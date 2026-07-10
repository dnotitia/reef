import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useVaultsMock = vi.fn();
vi.mock("./useVaults", () => ({ useVaults: () => useVaultsMock() }));

import { useWorkspaceAccess } from "./useWorkspaceAccess";

function setVaults(data: unknown, isPending = false) {
  useVaultsMock.mockReturnValue({ data, isPending });
}

describe("useWorkspaceAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grants workspace edit to writer, admin, and owner", () => {
    for (const role of ["writer", "admin", "owner"]) {
      setVaults([{ name: "v", role }]);
      const { result } = renderHook(() => useWorkspaceAccess("v"));
      expect(result.current.canEditWorkspace).toBe(true);
    }
  });

  it("denies workspace edit to a reader (matches akb's writer floor)", () => {
    setVaults([{ name: "v", role: "reader" }]);
    const { result } = renderHook(() => useWorkspaceAccess("v"));
    expect(result.current.canEditWorkspace).toBe(false);
    expect(result.current.canManageExecution).toBe(false);
    expect(result.current.role).toBe("reader");
  });

  it("restricts execution management to admin and owner", () => {
    for (const role of ["reader", "writer", "admin", "owner"]) {
      setVaults([{ name: "v", role }]);
      const { result } = renderHook(() => useWorkspaceAccess("v"));
      expect(result.current.canManageExecution).toBe(
        role === "admin" || role === "owner",
      );
    }
  });

  it("resolves a null role (no edit) when no vault is selected", () => {
    setVaults([{ name: "v", role: "owner" }]);
    const { result } = renderHook(() => useWorkspaceAccess(""));
    expect(result.current.role).toBeNull();
    expect(result.current.canEditWorkspace).toBe(false);
  });

  it("reports resolving while the vault list is pending", () => {
    setVaults(undefined, true);
    const { result } = renderHook(() => useWorkspaceAccess("v"));
    expect(result.current.isResolving).toBe(true);
  });
});

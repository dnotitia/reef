import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replaceMock, pathnameRef, searchRef, getActiveVaultMock } = vi.hoisted(
  () => ({
    replaceMock: vi.fn(),
    pathnameRef: { current: "/issues" },
    searchRef: { current: new URLSearchParams() },
    getActiveVaultMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathnameRef.current,
  useSearchParams: () => searchRef.current,
}));
vi.mock("@/lib/storage/config", () => ({
  getActiveVault: getActiveVaultMock,
}));
vi.mock("@/components/AppShellSkeleton", () => ({
  AppShellSkeleton: () => <div data-testid="app-shell-skeleton" />,
}));

import { LegacyRedirect } from "./LegacyRedirect";

describe("LegacyRedirect (REEF-315 AC4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/issues";
    searchRef.current = new URLSearchParams();
  });

  it("forwards a legacy deep link to its vault-scoped path, preserving the query", async () => {
    pathnameRef.current = "/issues/REEF-1";
    searchRef.current = new URLSearchParams("view=list");
    getActiveVaultMock.mockResolvedValue("reef-acme");

    render(<LegacyRedirect />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues/REEF-1?view=list",
      ),
    );
  });

  it("forwards a bare legacy path with no query", async () => {
    pathnameRef.current = "/planning";
    getActiveVaultMock.mockResolvedValue("reef-acme");

    render(<LegacyRedirect />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/workspace/reef-acme/planning"),
    );
  });

  it("sends the user to onboarding when there is no remembered workspace", async () => {
    getActiveVaultMock.mockResolvedValue("");

    render(<LegacyRedirect />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/onboarding"),
    );
  });
});

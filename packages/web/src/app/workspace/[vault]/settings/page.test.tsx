import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  notFound,
}));

import SettingsPage from "./page";

describe("SettingsPage section root (REEF-183)", () => {
  beforeEach(() => {
    redirect.mockClear();
    notFound.mockClear();
  });

  it("redirects a bare settings hit to the vault-scoped Workspace tab", async () => {
    await SettingsPage({ params: Promise.resolve({ vault: "reef-acme" }) });
    expect(redirect).toHaveBeenCalledWith(
      "/workspace/reef-acme/settings/workspace",
    );
  });

  it("404s a malformed vault segment instead of redirecting (REEF-315 AC5)", async () => {
    await expect(
      SettingsPage({ params: Promise.resolve({ vault: "Bad_Vault" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

import SettingsPage from "./page";

describe("SettingsPage section root (REEF-183)", () => {
  it("redirects a bare settings hit to the vault-scoped Workspace tab", async () => {
    await SettingsPage({ params: Promise.resolve({ vault: "reef-acme" }) });
    expect(redirect).toHaveBeenCalledWith(
      "/workspace/reef-acme/settings/workspace",
    );
  });
});

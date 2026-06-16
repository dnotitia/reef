import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

import SettingsPage from "./page";

describe("SettingsPage section root (REEF-183)", () => {
  it("redirects a bare /settings hit to the default Workspace tab", () => {
    SettingsPage();
    expect(redirect).toHaveBeenCalledWith("/settings/workspace");
  });
});

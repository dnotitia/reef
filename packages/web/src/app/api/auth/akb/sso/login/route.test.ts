// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("retired delegated SSO login route", () => {
  it("returns 410 without contacting AKB or reflecting a redirect", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("__reef_sso_start=");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

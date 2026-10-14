// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "./locale";

function clearCookies() {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

describe("applyLocale", () => {
  beforeEach(() => {
    document.documentElement.lang = "";
    clearCookies();
  });
  afterEach(clearCookies);

  it("sets <html lang> to the locale for immediate feedback", () => {
    applyLocale("ko");
    expect(document.documentElement.lang).toBe("ko");
    applyLocale("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("mirrors the locale into the readable NEXT_LOCALE cookie (AC2)", () => {
    applyLocale("ko");
    // The cookie is non-httpOnly by construction: it was written via
    // document.cookie, so document.cookie can read it back.
    expect(document.cookie).toContain("NEXT_LOCALE=ko");
  });

  it("persists the cookie for roughly a year (long-lived preference)", () => {
    const cookie = vi.spyOn(document, "cookie", "set");
    applyLocale("ko");
    expect(cookie).toHaveBeenCalledWith(
      "NEXT_LOCALE=ko; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    cookie.mockRestore();
  });
});

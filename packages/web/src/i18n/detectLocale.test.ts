// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveLocale } from "./detectLocale";

describe("resolveLocale — detection chain (cookie → Accept-Language → en)", () => {
  it("uses a valid cookie locale over everything else (AC1)", () => {
    expect(resolveLocale("ko", "en-US,en;q=0.9")).toBe("ko");
    expect(resolveLocale("en", "ko-KR,ko;q=0.9")).toBe("en");
  });

  it("ignores an unsupported or malformed cookie value and falls through", () => {
    expect(resolveLocale("fr", "ko-KR,ko;q=0.9")).toBe("ko");
    expect(resolveLocale("", "ko;q=0.9")).toBe("ko");
    expect(resolveLocale(undefined, "ko")).toBe("ko");
  });

  it("matches Accept-Language by primary subtag when no cookie", () => {
    expect(resolveLocale(undefined, "ko-KR,ko;q=0.9,en;q=0.8")).toBe("ko");
    expect(resolveLocale(undefined, "en-GB,en;q=0.9")).toBe("en");
  });

  it("honors Accept-Language quality ordering", () => {
    // ko has higher q than en → ko wins despite en appearing first.
    expect(resolveLocale(undefined, "en;q=0.5,ko;q=0.9")).toBe("ko");
    // unsupported highest-q is skipped; the next supported entry wins.
    expect(resolveLocale(undefined, "fr;q=1.0,ko;q=0.7,en;q=0.6")).toBe("ko");
  });

  it("skips q=0 entries (explicitly not acceptable)", () => {
    expect(resolveLocale(undefined, "ko;q=0,en;q=0.4")).toBe("en");
  });

  it("falls back to base (en) when nothing matches or the header is absent", () => {
    expect(resolveLocale(undefined, "fr-FR,de;q=0.9")).toBe("en");
    expect(resolveLocale(undefined, null)).toBe("en");
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale(undefined, "")).toBe("en");
  });
});

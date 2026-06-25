// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scanSource } from "./scanLiterals";

/**
 * Unit coverage for the pure scanner heuristic. The ratchet itself (diff against
 * the committed baseline) lives in `i18nGuard.test.ts`; here we pin the two
 * behaviors REEF-299 added — toast-message detection (AC3) and the boundaries
 * that keep it free of false positives (AC4) — plus the original JSX behavior so
 * it has regression coverage.
 */

const texts = (file: string, src: string): string[] =>
  scanSource(file, src).map((v) => v.text);

describe("scanSource — JSX (REEF-293, unchanged)", () => {
  it("flags JSX text copy", () => {
    expect(texts("a.tsx", "const A = () => <span>Issues</span>;")).toContain(
      "Issues",
    );
  });

  it("flags a user-facing attribute literal but not a routed one", () => {
    expect(
      texts("a.tsx", 'const A = () => <button aria-label="Close" />;'),
    ).toContain("Close");
    expect(
      texts("a.tsx", 'const A = () => <button aria-label={t("close")} />;'),
    ).toEqual([]);
  });
});

describe("scanSource — toast (REEF-299, AC3)", () => {
  it("flags a hardcoded toast message literal", () => {
    expect(texts("a.tsx", 'toast.success("Saved the issue.");')).toEqual([
      "Saved the issue.",
    ]);
  });

  it("flags any toast.* method and the bare toast() call", () => {
    expect(texts("a.tsx", 'toast("Plain message.");')).toEqual([
      "Plain message.",
    ]);
    expect(texts("a.tsx", 'toast.error("Boom happened.");')).toEqual([
      "Boom happened.",
    ]);
    expect(texts("a.tsx", 'toast.warning("Careful now.");')).toEqual([
      "Careful now.",
    ]);
  });

  it("is invisible once the message is routed through t()", () => {
    expect(texts("a.tsx", 'toast.success(t("saved"));')).toEqual([]);
    // The translation key (an argument to t()) is not flagged.
    expect(texts("a.tsx", 'toast.error(t("err", { id: issue.id }));')).toEqual(
      [],
    );
  });

  it("catches an inline literal fallback inside a ternary", () => {
    expect(
      texts(
        "a.tsx",
        'toast.error(err instanceof Error ? err.message : "Save failed.");',
      ),
    ).toEqual(["Save failed."]);
  });

  it("catches the static copy of a template-literal message", () => {
    expect(texts("a.tsx", "toast.success(`Issue ${id} created`);")).toContain(
      "Issue created",
    );
  });

  it("catches a nested literal fallback inside a template interpolation", () => {
    expect(
      texts(
        "a.tsx",
        'toast.success(`${id} moved to ${to ?? "the new status"}`);',
      ),
    ).toContain("the new status");
  });

  it("scans toast calls in plain .ts modules too", () => {
    expect(texts("hook.ts", 'toast("No new activity to show.");')).toEqual([
      "No new activity to show.",
    ]);
  });
});

describe("scanSource — toast boundaries (REEF-299, AC4: no false positives)", () => {
  it("ignores option-object strings (id/className), only the message", () => {
    const out = texts(
      "a.tsx",
      'toast.success("Done now.", { id: "sticky-toast" });',
    );
    expect(out).toEqual(["Done now."]);
    expect(out).not.toContain("sticky-toast");
  });

  it("ignores literals passed to non-toast calls", () => {
    expect(texts("a.tsx", 'logger.info("A diagnostic line here.");')).toEqual(
      [],
    );
  });

  it("does NOT apply a heuristic to arbitrary .ts data structures", () => {
    // Column-header / label arrays are kept copy-free by review, not by the
    // scanner — proving the scan stays narrow (JSX + toast) and quiet.
    expect(
      texts(
        "columns.ts",
        'export const C = ["ID", "Title", "Status"] as const;',
      ),
    ).toEqual([]);
  });

  it("respects an i18n-exempt line comment on a toast literal", () => {
    expect(texts("a.tsx", 'toast.success("Acme"); // i18n-exempt')).toEqual([]);
  });
});

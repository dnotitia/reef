import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Hardcoded user-facing string scanner — the engine behind the i18n regression
 * guard (REEF-293, extended in REEF-299). It walks `.ts` / `.tsx` sources and
 * reports English copy living directly in code instead of routing through the
 * message catalog (`useTranslations`):
 *
 * - JSX **text** nodes that contain letters (`<span>Issues</span>`).
 * - A small set of **user-facing attributes** whose value is a static string
 *   literal (`aria-label="Collapse sidebar"`, `title`, `placeholder`, `alt`).
 * - The **message argument** of a `toast(...)` / `toast.success(...)` call — the
 *   first argument, where the user-facing copy lives. Options like `id` /
 *   `className` (2nd arg) are deliberately out of reach so the scan stays free of
 *   false positives (REEF-299, AC4); a toast `description` option is migrated by
 *   review, not auto-caught.
 *
 * A value driven through `t(...)` is a call expression, not a string literal, so
 * a migrated `aria-label={t("collapseSidebar")}` or `toast.success(t("saved"))`
 * is invisible to the scanner — exactly the point. The scan is deliberately
 * narrow: JSX + the bounded toast pattern. It does NOT apply a literal-vs-key
 * heuristic to arbitrary `.ts` data structures (column-header / field-label
 * arrays, etc.) — that would be far noisier than useful, so those are kept
 * copy-free by the review checklist in `packages/web/AGENTS.md` instead (the
 * REEF-299 AC3 alternative).
 *
 * The scanner is pure (no baseline knowledge). `i18nGuard.test.ts` diffs its
 * output against the committed baseline to enforce the ratchet.
 */

/** Attributes whose string value is user-facing copy worth translating. */
const USER_FACING_ATTRS = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "title",
  "placeholder",
  "alt",
  "label",
]);

/** Directories / suffixes skipped by the guard. */
const SKIP_DIR_SEGMENTS = ["components/ui", "i18n"];
const SKIP_SUFFIXES = [
  ".test.tsx",
  ".test.ts",
  ".stories.tsx",
  ".stories.ts",
  ".testSupport.tsx",
  ".testSupport.ts",
];

/** A line carrying this marker opts its JSX literal out of the guard. */
const EXEMPT_MARKER = "i18n-exempt";

export interface Violation {
  /** Path relative to the scan root, POSIX separators. */
  file: string;
  /** Whitespace-normalized literal text (the stable baseline key). */
  text: string;
  /** 1-based line number, for human-facing failure output. */
  line: number;
  kind: "jsx-text" | "attr" | "toast";
}

/** `toast(...)` or `toast.<method>(...)` — the callee shapes sonner exposes. */
function isToastCallee(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) return expr.text === "toast";
  if (ts.isPropertyAccessExpression(expr)) {
    return ts.isIdentifier(expr.expression) && expr.expression.text === "toast";
  }
  return false;
}

/** Collapse internal whitespace/newlines so multi-line JSX text keys are stable. */
function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Letters present → it is copy, not punctuation/entities/symbols. */
function isTranslatableCopy(value: string): boolean {
  const normalized = normalize(value);
  return normalized.length >= 2 && /[A-Za-z]/.test(normalized);
}

/** Resolve a JSX attribute initializer to its static string literal, if any. */
function staticStringLiteral(
  initializer: ts.JsxAttribute["initializer"],
): string | null {
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    ts.isStringLiteralLike(initializer.expression)
  ) {
    return initializer.expression.text;
  }
  return null;
}

/** Scan a single source file's text. Exposed for unit testing the heuristic. */
export function scanSource(relFile: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(
    relFile,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    // Parse `.ts` as TS so generics/assertions aren't misread as JSX; `.tsx`
    // as TSX. A `.ts` file has no JSX nodes, so the toast scan handles it.
    relFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = source.split("\n");
  const violations: Violation[] = [];

  const lineExempt = (lineIndex: number): boolean =>
    lines[lineIndex]?.includes(EXEMPT_MARKER) ?? false;

  const recordAt = (pos: number, text: string, kind: Violation["kind"]) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
    if (lineExempt(line)) return;
    violations.push({
      file: relFile,
      text: normalize(text),
      line: line + 1,
      kind,
    });
  };

  // Record translatable literals inside a toast message argument. Descends
  // through ternaries/`??` (an inline `err.message : "Failed."` fallback) and
  // template expressions (static parts + nested string literals), so a migrated
  // `t(...)` call — having no literal — is invisible, exactly as in JSX.
  const collectToastLiterals = (node: ts.Node): void => {
    // A call expression in the message position means the copy is produced by a
    // function (`t(...)`, a formatter helper) — its string arguments are keys or
    // identifiers, not raw copy — so stop here. This is what makes a migrated
    // `toast.success(t("saved"))` invisible while `toast.success("Saved")` is
    // still caught; ternary/`??` branches are descended so an inline literal
    // fallback is not missed.
    if (ts.isCallExpression(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (isTranslatableCopy(node.text)) {
        recordAt(node.getStart(sourceFile), node.text, "toast");
      }
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const staticText = [
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      ].join(" ");
      if (isTranslatableCopy(staticText)) {
        recordAt(node.getStart(sourceFile), staticText, "toast");
      }
      for (const span of node.templateSpans) {
        collectToastLiterals(span.expression);
      }
      return;
    }
    ts.forEachChild(node, collectToastLiterals);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isToastCallee(node.expression)) {
      // Message argument; options like `id`/`className` are exempt.
      const message = node.arguments[0];
      if (message) collectToastLiterals(message);
    }
    if (ts.isJsxText(node)) {
      if (
        !node.containsOnlyTriviaWhiteSpaces &&
        isTranslatableCopy(node.text)
      ) {
        // Attribute the violation to the line of the first non-whitespace
        // character (where the copy actually reads), not the line of the
        // preceding `>`. That makes line numbers and `i18n-exempt` placement
        // line up with what a human sees.
        const raw = source.slice(node.pos, node.end);
        const leadingWhitespace = raw.length - raw.trimStart().length;
        recordAt(node.pos + leadingWhitespace, node.text, "jsx-text");
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (USER_FACING_ATTRS.has(name)) {
        const literal = staticStringLiteral(node.initializer);
        if (literal !== null && isTranslatableCopy(literal)) {
          recordAt(node.getStart(sourceFile), literal, "attr");
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function shouldSkip(relPath: string): boolean {
  // `.tsx` carries the JSX scan; `.ts` is scanned for the toast pattern
  // (REEF-299). `.d.ts` declarations have neither, so skip them.
  if (!relPath.endsWith(".ts") && !relPath.endsWith(".tsx")) return true;
  if (relPath.endsWith(".d.ts")) return true;
  if (SKIP_SUFFIXES.some((suffix) => relPath.endsWith(suffix))) return true;
  return SKIP_DIR_SEGMENTS.some(
    (segment) =>
      relPath === segment ||
      relPath.startsWith(`${segment}/`) ||
      relPath.includes(`/${segment}/`),
  );
}

function shouldSkipDirectory(relPath: string): boolean {
  return SKIP_DIR_SEGMENTS.some(
    (segment) =>
      relPath === segment ||
      relPath.startsWith(`${segment}/`) ||
      relPath.includes(`/${segment}/`),
  );
}

/** Recursively collect scannable `.ts` / `.tsx` files under `rootDir`. */
function collectFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        if (shouldSkipDirectory(rel)) continue;
        walk(abs);
        continue;
      }
      if (!shouldSkip(rel)) out.push(abs);
    }
  };
  walk(rootDir);
  return out.sort();
}

/**
 * Scan every source file under `rootDir` and return a baseline-shaped map:
 * `{ "<relPath>": ["<normalized literal>", ...] }`, each list sorted and
 * de-duplicated. This is the exact shape persisted in `baseline.json`.
 */
export function scanTree(rootDir: string): Record<string, string[]> {
  const map: Record<string, Set<string>> = {};
  for (const abs of collectFiles(rootDir)) {
    const rel = path.relative(rootDir, abs).split(path.sep).join("/");
    const source = fs.readFileSync(abs, "utf8");
    for (const violation of scanSource(rel, source)) {
      let set = map[rel];
      if (!set) {
        set = new Set();
        map[rel] = set;
      }
      set.add(violation.text);
    }
  }
  const result: Record<string, string[]> = {};
  for (const rel of Object.keys(map).sort()) {
    result[rel] = [...map[rel]].sort();
  }
  return result;
}

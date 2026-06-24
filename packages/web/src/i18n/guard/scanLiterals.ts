import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Hardcoded user-facing JSX string scanner — the engine behind the i18n
 * regression guard (REEF-293, AC2). It walks `.tsx` sources and reports JSX
 * constructs that put English copy directly in the markup instead of routing it
 * through the message catalog (`useTranslations`):
 *
 * - JSX **text** nodes that contain letters (`<span>Issues</span>`).
 * - A small set of **user-facing attributes** whose value is a static string
 *   literal (`aria-label="Collapse sidebar"`, `title`, `placeholder`, `alt`).
 *
 * A value driven through `t(...)` is a call expression, not a string literal, so
 * a migrated `aria-label={t("collapseSidebar")}` is invisible to the scanner —
 * exactly the point. The guard is intentionally JSX-only: AC2 is phrased as "a
 * new hardcoded literal added to JSX", and a literal-vs-key heuristic over bare
 * `.ts` modules would be far noisier than it is useful.
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

/** Directories / suffixes the guard never scans. */
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
  kind: "jsx-text" | "attr";
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
    ts.ScriptKind.TSX,
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

  const visit = (node: ts.Node): void => {
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
  if (!relPath.endsWith(".tsx")) return true;
  if (SKIP_SUFFIXES.some((suffix) => relPath.endsWith(suffix))) return true;
  return SKIP_DIR_SEGMENTS.some(
    (segment) =>
      relPath === segment ||
      relPath.startsWith(`${segment}/`) ||
      relPath.includes(`/${segment}/`),
  );
}

/** Recursively collect scannable `.tsx` files under `rootDir`. */
export function collectFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(abs);
        continue;
      }
      const rel = path.relative(rootDir, abs).split(path.sep).join("/");
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

/**
 * Minimal dependency-free text diff for the inline enrichment review UI.
 *
 * Titles diff at word granularity (`wordDiff`), bodies at line granularity
 * (`lineDiff`). Both run a standard LCS over tokens — fine at these sizes
 * (titles ≤ 200 chars, bodies a few KB). No `diff` package is pulled in.
 */

export interface DiffSegment {
  readonly type: "equal" | "add" | "remove";
  readonly text: string;
}

/** LCS-based token diff. Equal tokens are kept; the rest become remove/add. */
function diffTokens(
  before: readonly string[],
  after: readonly string[],
): DiffSegment[] {
  const n = before.length;
  const m = after.length;
  // dp[i][j] = LCS length of before[i:] and after[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        before[i] === after[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ type: "equal", text: before[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "remove", text: before[i] });
      i++;
    } else {
      out.push({ type: "add", text: after[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "remove", text: before[i] });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: after[j] });
    j++;
  }
  return out;
}

/** Merge runs of same-type segments, re-joining tokens with `joiner`. */
function mergeAdjacent(segments: DiffSegment[], joiner: string): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) {
      merged[merged.length - 1] = {
        type: last.type,
        text: `${last.text}${joiner}${seg.text}`,
      };
    } else {
      merged.push(seg);
    }
  }
  return merged;
}

export function wordDiff(before: string, after: string): DiffSegment[] {
  const tokenize = (text: string): string[] =>
    text.split(/\s+/).filter((token) => token.length > 0);
  return mergeAdjacent(diffTokens(tokenize(before), tokenize(after)), " ");
}

export function lineDiff(before: string, after: string): DiffSegment[] {
  // Treat an empty string as zero lines, not a single empty line, so an empty
  // "before" renders as a pure addition.
  const toLines = (text: string): string[] =>
    text.length === 0 ? [] : text.split("\n");
  return mergeAdjacent(diffTokens(toLines(before), toLines(after)), "\n");
}

/**
 * A dependency-free remark plugin that turns `REEF-\d+` tokens into links for
 * ids the caller recognizes — the "loaded issue list" rule (REEF-361
 * AC3). Unknown ids are left as plain text. It is surface-agnostic: the chat
 * renderer uses it now, and the editor autolink (REEF-348) can reuse the same
 * rule.
 *
 * Working on the mdast (not a raw-string pass) means code spans and fenced code
 * are skipped for free — their content lives in `inlineCode`/`code` nodes with a
 * `value`, outside the `text` nodes this walk rewrites — and existing links stay
 * flat. Each matched id becomes an mdast `link` carrying a
 * `data-reef-id` hint the renderer keys on to open the issue in-app instead of
 * routing through the external-link confirmation.
 */

/** Matches a reef issue token on a word boundary so mid-identifier hits (e.g. `xREEF-1`, `REEF-1a`) are ignored. */
export const REEF_ID_PATTERN = /\bREEF-\d+\b/gi;

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: MdastNode[];
}

export interface ReefMentionOptions {
  /** True when `id` (uppercase) resolves to a known issue and should link. */
  isKnown: (id: string) => boolean;
  /** Builds the in-app href for a known id (typically vault-scoped). */
  hrefFor: (id: string) => string;
}

export function remarkReefMentions(options: ReefMentionOptions) {
  return (tree: MdastNode): void => {
    transform(tree);
  };

  function transform(node: MdastNode): void {
    const children = node.children;
    if (!children) return;
    // Skip linkifying inside an existing link — no nested anchors.
    if (node.type === "link") return;

    const next: MdastNode[] = [];
    for (const child of children) {
      if (child.type === "text" && typeof child.value === "string") {
        next.push(...splitText(child.value, options));
      } else {
        transform(child);
        next.push(child);
      }
    }
    node.children = next;
  }
}

function splitText(value: string, options: ReefMentionOptions): MdastNode[] {
  const out: MdastNode[] = [];
  let last = 0;
  // A fresh regex per call keeps the shared global pattern's lastIndex clean
  // across concurrent renders.
  const pattern = new RegExp(REEF_ID_PATTERN.source, REEF_ID_PATTERN.flags);
  for (const match of value.matchAll(pattern)) {
    const raw = match[0];
    const id = raw.toUpperCase();
    if (!options.isKnown(id)) continue;
    const start = match.index ?? 0;
    if (start > last)
      out.push({ type: "text", value: value.slice(last, start) });
    out.push({
      type: "link",
      url: options.hrefFor(id),
      data: { hProperties: { "data-reef-id": id } },
      children: [{ type: "text", value: raw }],
    });
    last = start + raw.length;
  }
  if (out.length === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

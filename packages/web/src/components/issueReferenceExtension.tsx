import { StatusIcon } from "@/components/ui/status-icon";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import type { IssueListItem } from "@reef/core";
import {
  Node,
  type MarkdownParseHelpers,
  type MarkdownToken,
  type MarkdownTokenizer,
} from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import {
  Suggestion,
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";

/** Mutable loaded-list reference used by the lazy editor without rebuilding it. */
export interface IssueReferenceExtensionOptions {
  issuesRef: { current: readonly IssueListItem[] };
  currentIssueId: string;
  vault: string;
  suggestionsLabel: string;
  issueOptionLabel: (issue: IssueListItem) => string;
  onCommit?: (issueId: string) => void;
}

const INTERNAL_ISSUE_PATTERN = /\[@issue\s+id="([A-Z][A-Z0-9_]*-\d+)"\]/u;
const REEF_ID_PATTERN = /\b[A-Z][A-Z0-9_]*-\d+\b/giu;

function issueId(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function issueMap(
  issues: readonly IssueListItem[],
): Map<string, IssueListItem> {
  return new Map(issues.map((issue) => [issue.id.toUpperCase(), issue]));
}

/**
 * Turn only known, standalone ids into an internal shortcode before Tiptap
 * parses Markdown. The shortcode is an implementation detail: its renderer
 * writes the original plain id back to Markdown. Fences, inline code, and
 * existing links are intentionally left byte-for-byte untouched.
 */
export function prepareIssueReferenceMarkdown(
  markdown: string,
  issues: readonly IssueListItem[],
): string {
  const known = issueMap(issues);
  const replacements: Array<{ start: number; end: number; id: string }> = [];
  let inFence = false;
  let fenceMarker = "";
  let inlineCode = false;
  let cursor = 0;
  let skipUntil = -1;

  const isStandalone = (start: number, length: number) => {
    const before = markdown[start - 1] ?? "";
    const after = markdown[start + length] ?? "";
    return !/[\p{L}\p{N}_-]/u.test(before) && !/[\p{L}\p{N}_-]/u.test(after);
  };

  while (cursor < markdown.length) {
    if (cursor < skipUntil) {
      cursor += 1;
      continue;
    }
    const lineStart = cursor === 0 || markdown[cursor - 1] === "\n";
    if (lineStart) {
      const fence = markdown.slice(cursor).match(/^\s*(`{3,}|~{3,})/u)?.[1];
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceMarker = fence[0];
        } else if (fenceMarker === fence[0]) {
          inFence = false;
          fenceMarker = "";
        }
      }
    }
    const current = markdown[cursor];
    if (!inFence && current === "`") {
      inlineCode = !inlineCode;
      cursor += 1;
      continue;
    }
    if (inFence || inlineCode) {
      cursor += 1;
      continue;
    }
    if (current === "[") {
      const labelEnd = markdown.indexOf("]", cursor + 1);
      if (labelEnd >= 0 && markdown[labelEnd + 1] === "(") {
        let depth = 1;
        let end = labelEnd + 2;
        while (end < markdown.length && depth > 0) {
          if (markdown[end] === "(") depth += 1;
          if (markdown[end] === ")") depth -= 1;
          end += 1;
        }
        skipUntil = end;
        cursor += 1;
        continue;
      }
      cursor += 1;
      continue;
    }
    REEF_ID_PATTERN.lastIndex = cursor;
    const match = REEF_ID_PATTERN.exec(markdown);
    if (!match || match.index !== cursor) {
      cursor += 1;
      continue;
    }
    const raw = match[0];
    const id = issueId(raw);
    if (known.has(id) && isStandalone(cursor, raw.length)) {
      replacements.push({ start: cursor, end: cursor + raw.length, id });
    }
    cursor += raw.length;
  }
  if (replacements.length === 0) return markdown;
  let result = "";
  let last = 0;
  for (const replacement of replacements) {
    result += markdown.slice(last, replacement.start);
    result += `[@issue id="${replacement.id}"]`;
    last = replacement.end;
  }
  return result + markdown.slice(last);
}

function parseIssueReference(
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
) {
  const attributes = token.attributes as { id?: unknown } | undefined;
  return helpers.createNode("reefIssueReference", {
    id: issueId(attributes?.id),
  });
}

function createIssueReferenceTokenizer(): MarkdownTokenizer {
  return {
    name: "reefIssueReference",
    level: "inline",
    start(source) {
      return source.match(INTERNAL_ISSUE_PATTERN)?.index ?? -1;
    },
    tokenize(source) {
      const match = source.match(/^\[@issue\s+id="([A-Z][A-Z0-9_]*-\d+)"\]/u);
      if (!match?.[1]) return undefined;
      return {
        type: "reefIssueReference",
        raw: match[0],
        text: match[0],
        attributes: { id: match[1] },
      };
    },
  };
}

function issueReferenceLabel(issue: IssueListItem): string {
  return `${issue.id} — ${issue.title}`;
}

interface IssueSuggestionListProps {
  items: readonly IssueListItem[];
  selectedIndex: number;
  listboxId: string;
  suggestionsLabel: string;
  issueOptionLabel: (issue: IssueListItem) => string;
  onSelect: (issue: IssueListItem) => void;
}

function IssueSuggestionList({
  items,
  selectedIndex,
  listboxId,
  suggestionsLabel,
  issueOptionLabel,
  onSelect,
}: IssueSuggestionListProps) {
  if (items.length === 0) return null;
  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={suggestionsLabel}
      className="max-h-64 min-w-64 max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-elevated p-1 shadow-lg"
    >
      {items.map((issue, index) => (
        <button
          key={issue.id}
          id={`${listboxId}-${index}`}
          type="button"
          tabIndex={-1}
          role="option"
          aria-selected={index === selectedIndex}
          aria-label={issueOptionLabel(issue)}
          className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover aria-selected:bg-surface-hover"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect(issue);
          }}
        >
          <StatusIcon status={issue.status} size={13} decorative />
          <span
            translate="no"
            className="shrink-0 font-mono text-muted-foreground"
          >
            {issue.id}
          </span>
          <span className="min-w-0 truncate">{issue.title}</span>
        </button>
      ))}
    </div>
  );
}

const ISSUE_REFERENCE_QUERY_PATTERN =
  /(?:^|[\s([])(#?[A-Za-z][A-Za-z0-9_]*-\d*)$/u;

function findIssueReferenceSuggestionMatch({
  $position,
}: Parameters<
  NonNullable<SuggestionOptions<IssueListItem>["findSuggestionMatch"]>
>[0]) {
  const text = $position.nodeBefore?.isText
    ? ($position.nodeBefore.text ?? "")
    : "";
  if (!text) return null;
  const match = text.match(ISSUE_REFERENCE_QUERY_PATTERN);
  const raw = match?.[1];
  if (!raw) return null;
  return {
    range: {
      from: $position.pos - raw.length,
      to: $position.pos,
    },
    query: raw.startsWith("#") ? raw.slice(1) : raw,
    text: raw,
  };
}

function setSuggestionAria(
  editor: SuggestionProps["editor"],
  listboxId: string,
  selectedIndex: number,
  open: boolean,
) {
  const element = editor.view.dom;
  if (!open) {
    if (element.getAttribute("aria-controls") === listboxId) {
      element.removeAttribute("aria-controls");
      element.removeAttribute("aria-activedescendant");
    }
    element.setAttribute("aria-expanded", "false");
    return;
  }
  element.setAttribute("aria-autocomplete", "list");
  element.setAttribute("aria-controls", listboxId);
  element.setAttribute("aria-expanded", "true");
  element.setAttribute(
    "aria-activedescendant",
    `${listboxId}-${Math.max(0, selectedIndex)}`,
  );
}

function createIssueReferenceSuggestion(
  options: IssueReferenceExtensionOptions,
): Omit<SuggestionOptions<IssueListItem>, "editor"> {
  let renderer: ReactRenderer | null = null;
  let unmount: (() => void) | undefined;
  let selectedIndex = 0;
  let items: IssueListItem[] = [];
  let command: ((attrs: IssueListItem) => void) | undefined;
  const listboxId = `reef-issue-reference-list-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  function updateRenderer(props: SuggestionProps<IssueListItem>) {
    items = props.items;
    selectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));
    command = props.command;
    setSuggestionAria(props.editor, listboxId, selectedIndex, items.length > 0);
    renderer?.updateProps({
      items,
      selectedIndex,
      listboxId,
      suggestionsLabel: options.suggestionsLabel,
      issueOptionLabel: options.issueOptionLabel,
      onSelect: (issue: IssueListItem) => command?.(issue),
    });
  }

  return {
    pluginKey: new PluginKey("reefIssueReferenceSuggestion"),
    // The matcher supports both the documented plain `REEF-…` flow and the
    // earlier `#REEF-…` affordance without requiring a separate suggestion
    // plugin (and therefore without duplicate keyed-plugin state).
    char: "",
    allowedPrefixes: null,
    findSuggestionMatch: findIssueReferenceSuggestionMatch,
    allow: ({ editor }) => !editor.view.composing,
    items: ({ query }) => {
      const normalizedQuery = query.toLocaleLowerCase();
      return options.issuesRef.current
        .filter(
          (issue) =>
            issue.id.toUpperCase() !== options.currentIssueId.toUpperCase(),
        )
        .filter((issue) => {
          const id = issue.id.toLocaleLowerCase();
          const title = issue.title.toLocaleLowerCase();
          return (
            normalizedQuery.length === 0 ||
            id.includes(normalizedQuery) ||
            title.includes(normalizedQuery)
          );
        })
        .slice(0, 8);
    },
    command: ({ editor, range, props }) => {
      const id = issueId(props.id);
      if (!id) return;
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "reefIssueReference", attrs: { id } },
          { type: "text", text: " " },
        ])
        .run();
      options.onCommit?.(id);
    },
    render: () => ({
      onStart: (props) => {
        selectedIndex = 0;
        items = props.items;
        command = props.command;
        renderer = new ReactRenderer(IssueSuggestionList, {
          editor: props.editor,
          className: "reef-issue-reference-popup",
          props: {
            items,
            selectedIndex,
            listboxId,
            suggestionsLabel: options.suggestionsLabel,
            issueOptionLabel: options.issueOptionLabel,
            onSelect: (issue: IssueListItem) => command?.(issue),
          },
        });
        unmount = props.mount(renderer.element);
        setSuggestionAria(
          props.editor,
          listboxId,
          selectedIndex,
          items.length > 0,
        );
      },
      onUpdate: updateRenderer,
      onExit: ({ editor }) => {
        setSuggestionAria(editor, listboxId, selectedIndex, false);
        unmount?.();
        unmount = undefined;
        renderer?.destroy();
        renderer = null;
        items = [];
        command = undefined;
        selectedIndex = 0;
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.isComposing) return false;
        if (event.key === "ArrowDown" && items.length > 0) {
          event.preventDefault();
          selectedIndex = (selectedIndex + 1) % items.length;
          renderer?.updateProps({ selectedIndex });
          return true;
        }
        if (event.key === "ArrowUp" && items.length > 0) {
          event.preventDefault();
          selectedIndex = (selectedIndex - 1 + items.length) % items.length;
          renderer?.updateProps({ selectedIndex });
          return true;
        }
        if (
          (event.key === "Enter" || event.key === "Tab") &&
          items.length > 0
        ) {
          event.preventDefault();
          const selected = items[selectedIndex];
          if (!selected) return false;
          command?.(selected);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          return false;
        }
        return false;
      },
    }),
  };
}

function renderIssueReference(
  node: { attrs?: Record<string, unknown> },
  options: IssueReferenceExtensionOptions,
): DOMOutputSpec {
  const id = issueId(node.attrs?.id);
  const issue = issueMap(options.issuesRef.current).get(id);
  if (!issue) return ["span", { "data-reef-issue-id": id }, id];
  const href = buildOpenIssueHref(options.vault, id, new URLSearchParams());
  return [
    "a",
    {
      "data-reef-issue-id": id,
      "data-reef-status": issue.status,
      href,
      tabindex: 0,
      title: issue.title,
      "aria-label": issueReferenceLabel(issue),
    },
    [
      "span",
      {
        "data-reef-status-icon": issue.status,
        "aria-hidden": "true",
      },
      "●",
    ],
    ["span", { translate: "no", class: "font-mono" }, id],
    ["span", { class: "reef-issue-reference-title" }, issue.title],
  ];
}

export function createIssueReferenceExtension(
  options: IssueReferenceExtensionOptions,
) {
  const suggestion = createIssueReferenceSuggestion(options);
  return Node.create({
    name: "reefIssueReference",
    inline: true,
    group: "inline",
    atom: true,
    selectable: false,
    addAttributes() {
      return { id: { default: "" } };
    },
    parseHTML() {
      return [{ tag: "span[data-reef-issue-id]" }];
    },
    renderHTML({ node }) {
      return renderIssueReference(node, options);
    },
    renderText({ node }) {
      return issueId(node.attrs.id);
    },
    markdownTokenizer: createIssueReferenceTokenizer(),
    parseMarkdown: parseIssueReference,
    renderMarkdown: (node) => issueId(node.attrs?.id),
    addProseMirrorPlugins() {
      return [Suggestion({ ...suggestion, editor: this.editor })];
    },
  });
}

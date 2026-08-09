import { PersonOption } from "@/components/fields/PersonOption";
import {
  formatMentionToken,
  parseMentionTokens,
  type VaultMember,
} from "@reef/core";
import {
  mergeAttributes,
  type MarkdownParseHelpers,
  type MarkdownToken,
  type MarkdownTokenizer,
} from "@tiptap/core";
import Mention, { type MentionNodeAttrs } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import { findSuggestionMatch } from "@tiptap/suggestion";

export interface IssueBodyMentionExtensionOptions {
  /** Mutable so the lazy editor can observe roster refreshes without rebuilding. */
  membersRef: { current: readonly VaultMember[] };
  suggestionsLabel: string;
  mentionOptionLabel: (username: string) => string;
}

interface MentionSuggestionListProps {
  items: readonly VaultMember[];
  selectedIndex: number;
  listboxId: string;
  suggestionsLabel: string;
  mentionOptionLabel: (username: string) => string;
  onSelect: (member: VaultMember) => void;
}

function MentionSuggestionList({
  items,
  selectedIndex,
  listboxId,
  suggestionsLabel,
  mentionOptionLabel,
  onSelect,
}: MentionSuggestionListProps) {
  if (items.length === 0) return null;

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={suggestionsLabel}
      className="max-h-64 min-w-64 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
    >
      {items.map((member, index) => (
        <button
          key={member.username}
          id={`${listboxId}-${index}`}
          type="button"
          tabIndex={-1}
          role="option"
          aria-selected={index === selectedIndex}
          aria-label={mentionOptionLabel(member.username)}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted aria-selected:bg-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(member)}
        >
          <PersonOption
            login={member.username}
            name={member.display_name ?? null}
            avatarUrl={null}
            currentLogin={null}
          />
        </button>
      ))}
    </div>
  );
}

function mentionLabel(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

function setEditorMentionAria(
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

function parseIssueBodyMention(
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
) {
  const attributes = token.attributes as Record<string, unknown> | undefined;
  const encodedId = mentionLabel(attributes?.id);
  let id = encodedId;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    // Keep a malformed shortcode visible rather than failing the whole body.
  }
  return helpers.createNode("mention", { id, label: id });
}

const INTERNAL_MENTION_PATTERN = /\[@\s+id="([^"]+)"(?:\s+label="([^"]*)")?\]/u;

function createIssueBodyMentionTokenizer(): MarkdownTokenizer {
  return {
    name: "mention",
    level: "inline",
    start(source) {
      return source.match(INTERNAL_MENTION_PATTERN)?.index ?? -1;
    },
    tokenize(source): MarkdownToken | undefined {
      const match = source.match(
        /^\[@\s+id="([^"]+)"(?:\s+label="([^"]*)")?\]/u,
      );
      if (!match) return undefined;
      const encodedId = match[1];
      if (!encodedId) return undefined;
      return {
        type: "mention",
        raw: match[0],
        text: match[0],
        attributes: {
          id: encodedId,
          label: match[2] ?? encodedId,
        },
      };
    },
  };
}

/**
 * Marked recursively tokenizes link labels, so canonical `@...` syntax cannot
 * be recognized there without changing Markdown's link semantics. The core
 * parser already knows which regions are Markdown-owned; only its resolved
 * tokens are converted to the official Mention shortcode before parsing.
 */
export function prepareIssueBodyMentionMarkdown(
  markdown: string,
  members: readonly VaultMember[],
): string {
  const roster = new Set(members.map((member) => member.username));
  const tokens = parseMentionTokens(markdown).filter((token) =>
    roster.has(token.username),
  );
  if (tokens.length === 0) return markdown;

  let cursor = 0;
  let prepared = "";
  for (const token of tokens) {
    prepared += markdown.slice(cursor, token.start);
    const encoded = encodeURIComponent(token.username);
    prepared += `[@ id="${encoded}" label="${encoded}"]`;
    cursor = token.end;
  }
  return prepared + markdown.slice(cursor);
}

function renderIssueBodyMention(node: { attrs?: Record<string, unknown> }) {
  return formatMentionToken(mentionLabel(node.attrs?.id ?? node.attrs?.label));
}

function createIssueBodyMentionSuggestion(
  options: IssueBodyMentionExtensionOptions,
): Omit<SuggestionOptions<VaultMember, MentionNodeAttrs>, "editor"> {
  let renderer: ReactRenderer | null = null;
  let unmount: (() => void) | undefined;
  let selectedIndex = 0;
  let items: VaultMember[] = [];
  let command: ((attrs: MentionNodeAttrs) => void) | undefined;
  const listboxId = `reef-issue-body-mention-list-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  function updateRenderer(
    props: SuggestionProps<VaultMember, MentionNodeAttrs>,
  ) {
    items = props.items;
    selectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));
    command = props.command;
    setEditorMentionAria(
      props.editor,
      listboxId,
      selectedIndex,
      items.length > 0,
    );
    renderer?.updateProps({
      items,
      selectedIndex,
      listboxId,
      suggestionsLabel: options.suggestionsLabel,
      mentionOptionLabel: options.mentionOptionLabel,
      onSelect: (member: VaultMember) =>
        command?.({ id: member.username, label: member.username }),
    });
  }

  return {
    char: "@",
    allowedPrefixes: null,
    findSuggestionMatch: (config) => {
      const match = findSuggestionMatch({ ...config, allowedPrefixes: null });
      if (!match) return null;

      const before = config.$position.doc.textBetween(
        0,
        match.range.from,
        "\n",
      );
      const previous = Array.from(before).at(-1);
      if (previous && /[\p{L}\p{N}@]/u.test(previous)) return null;

      let backslashes = 0;
      for (let index = before.length - 1; index >= 0; index -= 1) {
        if (before[index] !== "\\") break;
        backslashes += 1;
      }
      return backslashes % 2 === 1 ? null : match;
    },
    decorationClass: "reef-issue-body-mention-suggestion",
    allow: ({ editor }) => !editor.view.composing,
    items: ({ query }) => {
      const normalizedQuery = query.toLocaleLowerCase();
      return options.membersRef.current
        .filter((member) => {
          const username = member.username.toLocaleLowerCase();
          const displayName = member.display_name?.toLocaleLowerCase() ?? "";
          return (
            normalizedQuery.length === 0 ||
            username.includes(normalizedQuery) ||
            displayName.includes(normalizedQuery)
          );
        })
        .slice(0, 8);
    },
    command: ({ editor, range, props }) => {
      const username = mentionLabel(props.id ?? props.label);
      if (!username) return;
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: "mention",
            attrs: {
              id: username,
              label: username,
              mentionSuggestionChar: "@",
            },
          },
          { type: "text", text: " " },
        ])
        .run();
    },
    render: () => ({
      onStart: (props) => {
        selectedIndex = 0;
        items = props.items;
        command = props.command;
        renderer = new ReactRenderer(MentionSuggestionList, {
          editor: props.editor,
          className: "reef-issue-body-mention-popup",
          props: {
            items,
            selectedIndex,
            listboxId,
            suggestionsLabel: options.suggestionsLabel,
            mentionOptionLabel: options.mentionOptionLabel,
            onSelect: (member: VaultMember) =>
              command?.({ id: member.username, label: member.username }),
          },
        });
        unmount = props.mount(renderer.element);
        setEditorMentionAria(
          props.editor,
          listboxId,
          selectedIndex,
          items.length > 0,
        );
      },
      onUpdate: updateRenderer,
      onExit: ({ editor }) => {
        setEditorMentionAria(editor, listboxId, selectedIndex, false);
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
          command?.({ id: selected.username, label: selected.username });
          return true;
        }
        return false;
      },
    }),
  };
}

export function createIssueBodyMentionExtension(
  options: IssueBodyMentionExtensionOptions,
) {
  const suggestion = createIssueBodyMentionSuggestion(options);
  return Mention.extend({
    markdownTokenizer: createIssueBodyMentionTokenizer(),
    parseMarkdown: parseIssueBodyMention,
    renderMarkdown: renderIssueBodyMention,
  }).configure({
    HTMLAttributes: { class: "reef-issue-body-mention" },
    renderText: ({ node }) =>
      `@${mentionLabel(node.attrs.label ?? node.attrs.id)}`,
    renderHTML: ({ node, options: mentionOptions }) => [
      "span",
      mergeAttributes(
        { "data-type": "mention", "data-reef-mention": "true" },
        mentionOptions.HTMLAttributes,
      ),
      `@${mentionLabel(node.attrs.label ?? node.attrs.id)}`,
    ],
    suggestion,
  });
}

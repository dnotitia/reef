import { DocumentOptionRow } from "@/components/fields/DocumentOptionRow";
import { IssueOptionRow } from "@/components/fields/IssueOptionRow";
import { PersonOption } from "@/components/fields/PersonOption";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { rankIssueOptions } from "@/features/issues/lib/rankIssueOptions";
import { akbDocumentSlugTitle } from "@/lib/akb/documentUri";
import {
  formatMentionToken,
  parseMentionTokens,
  type DocumentSearchHit,
  type IssueListItem,
  type VaultMember,
} from "@reef/core";
import {
  mergeAttributes,
  type Editor,
  type MarkdownParseHelpers,
  type MarkdownToken,
  type MarkdownTokenizer,
  type Range,
} from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import { exitSuggestion, findSuggestionMatch } from "@tiptap/suggestion";

export type IssueBodyReferenceCandidate =
  | { kind: "person"; member: VaultMember }
  | { kind: "issue"; issue: IssueListItem }
  | { kind: "document"; hit: DocumentSearchHit };

export type IssueBodyDocumentSearch = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly DocumentSearchHit[]>;

// Mention creates a private key when it builds its Suggestion plugin. Keep an
// explicit key so the Radix capture-phase Escape handoff can exit this picker.
const ISSUE_BODY_MENTION_PLUGIN_KEY = new PluginKey(
  "reefIssueBodyMentionSuggestion",
);

export interface IssueBodyMentionExtensionOptions {
  /** Mutable so the lazy editor can observe roster refreshes without rebuilding. */
  membersRef: { current: readonly VaultMember[] };
  /** Mutable for the current issue list; omitted outside issue-body surfaces. */
  issuesRef?: { current: readonly IssueListItem[] };
  /** Mutable so a vault change does not rebuild the Tiptap extension. */
  searchDocumentsRef?: { current: IssueBodyDocumentSearch | undefined };
  /** Static seam used by direct extension consumers and focused tests. */
  searchDocuments?: IssueBodyDocumentSearch;
  suggestionsLabel: string;
  mentionOptionLabel: (username: string) => string;
  peopleSectionLabel: string;
  issuesSectionLabel: string;
  documentsSectionLabel: string;
  issueOptionLabel: (issue: IssueListItem) => string;
  documentOptionLabel: (hit: DocumentSearchHit) => string;
  documentSearchLoadingLabel: string;
  documentSearchErrorLabel: string;
  documentSearchEmptyLabel: string;
  /** Keeps the surrounding Sheet/Dialog from dismissing an open picker. */
  onOpenChange?: (open: boolean, dismiss?: () => void) => void;
}

type DocumentSearchStatus = "idle" | "loading" | "ready" | "empty" | "error";

interface MentionSuggestionListProps {
  candidates: readonly IssueBodyReferenceCandidate[];
  selectedIndex: number;
  listboxId: string;
  suggestionsLabel: string;
  mentionOptionLabel: (username: string) => string;
  peopleSectionLabel: string;
  issuesSectionLabel: string;
  documentsSectionLabel: string;
  issueOptionLabel: (issue: IssueListItem) => string;
  documentOptionLabel: (hit: DocumentSearchHit) => string;
  documentSearchStatus: DocumentSearchStatus;
  documentSearchLoadingLabel: string;
  documentSearchErrorLabel: string;
  documentSearchEmptyLabel: string;
  onSelect: (candidate: IssueBodyReferenceCandidate) => void;
}

function candidateKey(candidate: IssueBodyReferenceCandidate): string {
  if (candidate.kind === "person") return `person:${candidate.member.username}`;
  if (candidate.kind === "issue") return `issue:${candidate.issue.id}`;
  return `document:${candidate.hit.uri}`;
}

function candidateLabel(
  candidate: IssueBodyReferenceCandidate,
  options: Pick<
    MentionSuggestionListProps,
    "mentionOptionLabel" | "issueOptionLabel" | "documentOptionLabel"
  >,
): string {
  if (candidate.kind === "person") {
    return options.mentionOptionLabel(candidate.member.username);
  }
  if (candidate.kind === "issue") {
    return options.issueOptionLabel(candidate.issue);
  }
  return options.documentOptionLabel(candidate.hit);
}

export function MentionSuggestionList({
  candidates,
  selectedIndex,
  listboxId,
  suggestionsLabel,
  mentionOptionLabel,
  peopleSectionLabel,
  issuesSectionLabel,
  documentsSectionLabel,
  issueOptionLabel,
  documentOptionLabel,
  documentSearchStatus,
  documentSearchLoadingLabel,
  documentSearchErrorLabel,
  documentSearchEmptyLabel,
  onSelect,
}: MentionSuggestionListProps) {
  const currentLogin = useCurrentUserLogin();
  const people = candidates.filter((candidate) => candidate.kind === "person");
  const issues = candidates.filter((candidate) => candidate.kind === "issue");
  const documents = candidates.filter(
    (candidate) => candidate.kind === "document",
  );
  const hasDocumentStatus = documentSearchStatus !== "idle";
  if (candidates.length === 0 && !hasDocumentStatus) return null;

  const renderCandidate = (
    candidate: IssueBodyReferenceCandidate,
    index: number,
  ) => {
    const selected = index === selectedIndex;
    const label = candidateLabel(candidate, {
      mentionOptionLabel,
      issueOptionLabel,
      documentOptionLabel,
    });
    return (
      <button
        key={candidateKey(candidate)}
        id={`${listboxId}-${index}`}
        type="button"
        tabIndex={-1}
        role="option"
        aria-selected={selected}
        aria-label={label}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted aria-selected:bg-muted"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(candidate)}
      >
        {candidate.kind === "person" ? (
          <PersonOption
            login={candidate.member.username}
            name={candidate.member.display_name ?? null}
            avatarUrl={null}
            currentLogin={currentLogin}
          />
        ) : candidate.kind === "issue" ? (
          <IssueOptionRow issue={candidate.issue} />
        ) : (
          <DocumentOptionRow hit={candidate.hit} />
        )}
      </button>
    );
  };

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={suggestionsLabel}
      className="max-h-64 min-w-64 overflow-y-auto rounded-md border border-border bg-surface-page p-1 shadow-lg"
    >
      {people.length > 0 ? (
        <div
          role="group"
          aria-label={peopleSectionLabel}
          data-reference-section="people"
        >
          <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {peopleSectionLabel}
          </div>
          {people.map(renderCandidate)}
        </div>
      ) : null}
      {issues.length > 0 ? (
        <div
          role="group"
          aria-label={issuesSectionLabel}
          data-reference-section="issues"
        >
          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {issuesSectionLabel}
          </div>
          {issues.map((candidate, index) =>
            renderCandidate(candidate, people.length + index),
          )}
        </div>
      ) : null}
      {documents.length > 0 || hasDocumentStatus ? (
        <div
          role="group"
          aria-label={documentsSectionLabel}
          data-reference-section="documents"
        >
          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {documentsSectionLabel}
          </div>
          {documents.map((candidate, index) =>
            renderCandidate(candidate, people.length + issues.length + index),
          )}
          {documentSearchStatus === "loading" ? (
            <div
              role="status"
              className="px-2 py-1.5 text-xs text-muted-foreground"
            >
              {documentSearchLoadingLabel}
            </div>
          ) : null}
          {documentSearchStatus === "error" ? (
            <div
              role="alert"
              className="px-2 py-1.5 text-xs text-destructive-text"
            >
              {documentSearchErrorLabel}
            </div>
          ) : null}
          {documentSearchStatus === "empty" ? (
            <div
              role="status"
              className="px-2 py-1.5 text-xs text-muted-foreground"
            >
              {documentSearchEmptyLabel}
            </div>
          ) : null}
        </div>
      ) : null}
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
  hasActiveOption: boolean,
) {
  const element = editor.view.dom;
  if (!open) {
    if (element.getAttribute("aria-controls") === listboxId) {
      element.removeAttribute("aria-controls");
    }
    element.removeAttribute("aria-activedescendant");
    element.setAttribute("aria-expanded", "false");
    return;
  }

  element.setAttribute("aria-autocomplete", "list");
  element.setAttribute("aria-controls", listboxId);
  element.setAttribute("aria-expanded", "true");
  if (hasActiveOption) {
    element.setAttribute(
      "aria-activedescendant",
      `${listboxId}-${Math.max(0, selectedIndex)}`,
    );
  } else {
    element.removeAttribute("aria-activedescendant");
  }
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
 * Marked recursively tokenizes link labels, so canonical `@...` syntax does not
 * be recognized there without changing Markdown's link semantics. The core
 * parser already knows which regions are Markdown-owned; its resolved
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

function filterPeople(
  members: readonly VaultMember[],
  query: string,
  limit: number,
): IssueBodyReferenceCandidate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return members
    .filter((member) => {
      const username = member.username.toLocaleLowerCase();
      const displayName = member.display_name?.toLocaleLowerCase() ?? "";
      return (
        normalizedQuery.length === 0 ||
        username.includes(normalizedQuery) ||
        displayName.includes(normalizedQuery)
      );
    })
    .slice(0, limit)
    .map((member) => ({ kind: "person", member }));
}

/**
 * Build the deterministic local portion of the unified reference list. The
 * section order is part of the issue-body contract: people, then issues.
 */
export function filterIssueBodyMentionCandidates(
  members: readonly VaultMember[],
  issues: readonly IssueListItem[],
  query: string,
  limit = 8,
): IssueBodyReferenceCandidate[] {
  return [
    ...filterPeople(members, query, limit),
    ...rankIssueOptions(issues, query, limit).map(({ issue }) => ({
      kind: "issue" as const,
      issue,
    })),
  ];
}

function mergeCandidates(
  localCandidates: readonly IssueBodyReferenceCandidate[],
  documentHits: readonly DocumentSearchHit[],
): IssueBodyReferenceCandidate[] {
  const documents = new Set<string>();
  const documentCandidates: IssueBodyReferenceCandidate[] = [];
  for (const hit of documentHits) {
    if (documents.has(hit.uri)) continue;
    documents.add(hit.uri);
    documentCandidates.push({ kind: "document", hit });
  }
  return [...localCandidates, ...documentCandidates];
}

function trailingBackslashCount(value: string): number {
  let count = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== "\\") break;
    count += 1;
  }
  return count;
}

/**
 * Reuse the plain-Markdown mention parser for the live trigger prefix. The
 * editor may not have materialized an inline mark or code block yet while a
 * user is typing its opening fence, so probing with a safe token also catches
 * those incomplete Markdown-owned regions before the suggestion plugin opens.
 */
function isMentionTriggerAllowed(before: string): boolean {
  if (trailingBackslashCount(before) > 0) return false;
  const probe = `${before}@a`;
  return parseMentionTokens(probe).some(
    (token) => token.start === before.length,
  );
}

/** Insert a selected reference while keeping the stored body plain Markdown. */
export function insertIssueBodyReference(
  editor: Editor,
  range: Range,
  candidate: IssueBodyReferenceCandidate,
): void {
  if (candidate.kind === "person") {
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        {
          type: "mention",
          attrs: {
            id: candidate.member.username,
            label: candidate.member.username,
            mentionSuggestionChar: "@",
          },
        },
        { type: "text", text: " " },
      ])
      .run();
    return;
  }
  if (candidate.kind === "issue") {
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: "text", text: `${candidate.issue.id} ` },
      ])
      .run();
    return;
  }
  const title = candidate.hit.title ?? akbDocumentSlugTitle(candidate.hit.uri);
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        type: "text",
        text: title,
        marks: [{ type: "link", attrs: { href: candidate.hit.uri } }],
      },
      { type: "text", text: " " },
    ])
    .run();
}

function createIssueBodyMentionSuggestion(
  options: IssueBodyMentionExtensionOptions,
): Omit<
  SuggestionOptions<IssueBodyReferenceCandidate, IssueBodyReferenceCandidate>,
  "editor"
> {
  let renderer: ReactRenderer | null = null;
  let unmount: (() => void) | undefined;
  let selectedIndex = 0;
  let candidates: IssueBodyReferenceCandidate[] = [];
  let command: ((candidate: IssueBodyReferenceCandidate) => void) | undefined;
  let documentSearchStatus: DocumentSearchStatus = "idle";
  let previousQuery = "";
  const listboxId = `reef-issue-body-mention-list-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  function getSearchDocuments(): IssueBodyDocumentSearch | undefined {
    return options.searchDocumentsRef
      ? options.searchDocumentsRef.current
      : options.searchDocuments;
  }

  function getLocalCandidates(query: string) {
    return filterIssueBodyMentionCandidates(
      options.membersRef.current,
      options.issuesRef?.current ?? [],
      query,
    );
  }

  function getVisibleCandidates(
    query: string,
    sourceCandidates: readonly IssueBodyReferenceCandidate[],
  ) {
    const local = getLocalCandidates(query);
    return mergeCandidates(
      local,
      sourceCandidates
        .filter(
          (
            candidate,
          ): candidate is Extract<
            IssueBodyReferenceCandidate,
            { kind: "document" }
          > => candidate.kind === "document",
        )
        .map((candidate) => candidate.hit),
    );
  }

  function updateRenderer(
    props: SuggestionProps<
      IssueBodyReferenceCandidate,
      IssueBodyReferenceCandidate
    >,
  ) {
    if (props.query !== previousQuery) {
      previousQuery = props.query;
      documentSearchStatus =
        props.query.trim() && getSearchDocuments() ? "loading" : "idle";
    }
    candidates = getVisibleCandidates(
      props.query,
      documentSearchStatus === "loading" ? [] : props.items,
    );
    selectedIndex = Math.min(selectedIndex, Math.max(candidates.length - 1, 0));
    command = props.command;
    const hasDocumentStatus = documentSearchStatus !== "idle";
    const open = candidates.length > 0 || hasDocumentStatus;
    setEditorMentionAria(
      props.editor,
      listboxId,
      selectedIndex,
      open,
      candidates.length > 0,
    );
    renderer?.updateProps({
      candidates,
      selectedIndex,
      listboxId,
      suggestionsLabel: options.suggestionsLabel,
      mentionOptionLabel: options.mentionOptionLabel,
      peopleSectionLabel: options.peopleSectionLabel,
      issuesSectionLabel: options.issuesSectionLabel,
      documentsSectionLabel: options.documentsSectionLabel,
      issueOptionLabel: options.issueOptionLabel,
      documentOptionLabel: options.documentOptionLabel,
      documentSearchStatus,
      documentSearchLoadingLabel: options.documentSearchLoadingLabel,
      documentSearchErrorLabel: options.documentSearchErrorLabel,
      documentSearchEmptyLabel: options.documentSearchEmptyLabel,
      onSelect: (candidate: IssueBodyReferenceCandidate) =>
        command?.(candidate),
    });
  }

  return {
    pluginKey: ISSUE_BODY_MENTION_PLUGIN_KEY,
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

      if (!isMentionTriggerAllowed(before)) return null;
      return match;
    },
    decorationClass: "reef-issue-body-mention-suggestion",
    // Resolve the active modal at mount time. Keeping the popup inside its
    // Radix content avoids both outside-dismiss handling and equal-z-index
    // hit-test races while retaining body mounting for non-modal editors.
    container:
      '[data-slot="sheet-content"][data-state="open"], [data-slot="dialog-content"][data-state="open"]',
    allow: ({ editor }) =>
      !editor.view.composing &&
      !editor.isActive("code") &&
      !editor.isActive("codeBlock") &&
      !editor.isActive("link"),
    debounce: 250,
    items: async ({ query, signal }) => {
      const localCandidates = getLocalCandidates(query);
      const searchDocuments = getSearchDocuments();
      if (!query.trim() || !searchDocuments) {
        documentSearchStatus = "idle";
        return localCandidates;
      }

      documentSearchStatus = "loading";
      renderer?.updateProps({
        candidates: localCandidates,
        selectedIndex,
        documentSearchStatus,
      });
      try {
        const hits = await searchDocuments(query.trim(), signal);
        if (signal.aborted) return localCandidates;
        documentSearchStatus = hits.length > 0 ? "ready" : "empty";
        return mergeCandidates(localCandidates, hits);
      } catch {
        if (signal.aborted) return localCandidates;
        documentSearchStatus = "error";
        renderer?.updateProps({
          candidates: localCandidates,
          selectedIndex,
          documentSearchStatus,
        });
        return localCandidates;
      }
    },
    command: ({ editor, range, props }) => {
      insertIssueBodyReference(editor, range, props);
    },
    render: () => ({
      onStart: (props) => {
        options.onOpenChange?.(true, () =>
          exitSuggestion(props.editor.view, ISSUE_BODY_MENTION_PLUGIN_KEY),
        );
        selectedIndex = 0;
        previousQuery = props.query;
        candidates = getVisibleCandidates(props.query, props.items);
        command = props.command;
        const searchDocuments = getSearchDocuments();
        documentSearchStatus =
          props.query.trim() && searchDocuments ? "loading" : "idle";
        renderer = new ReactRenderer(MentionSuggestionList, {
          editor: props.editor,
          className: "reef-issue-body-mention-popup",
          props: {
            candidates,
            selectedIndex,
            listboxId,
            suggestionsLabel: options.suggestionsLabel,
            mentionOptionLabel: options.mentionOptionLabel,
            peopleSectionLabel: options.peopleSectionLabel,
            issuesSectionLabel: options.issuesSectionLabel,
            documentsSectionLabel: options.documentsSectionLabel,
            issueOptionLabel: options.issueOptionLabel,
            documentOptionLabel: options.documentOptionLabel,
            documentSearchStatus,
            documentSearchLoadingLabel: options.documentSearchLoadingLabel,
            documentSearchErrorLabel: options.documentSearchErrorLabel,
            documentSearchEmptyLabel: options.documentSearchEmptyLabel,
            onSelect: (candidate: IssueBodyReferenceCandidate) =>
              command?.(candidate),
          },
        });
        unmount = props.mount(renderer.element);
        setEditorMentionAria(
          props.editor,
          listboxId,
          selectedIndex,
          candidates.length > 0 || documentSearchStatus !== "idle",
          candidates.length > 0,
        );
      },
      onUpdate: updateRenderer,
      onExit: ({ editor }) => {
        options.onOpenChange?.(false);
        setEditorMentionAria(editor, listboxId, selectedIndex, false, false);
        unmount?.();
        unmount = undefined;
        renderer?.destroy();
        renderer = null;
        candidates = [];
        command = undefined;
        documentSearchStatus = "idle";
        previousQuery = "";
        selectedIndex = 0;
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.isComposing) return false;
        if (event.key === "ArrowDown" && candidates.length > 0) {
          event.preventDefault();
          selectedIndex = (selectedIndex + 1) % candidates.length;
          renderer?.updateProps({ selectedIndex });
          return true;
        }
        if (event.key === "ArrowUp" && candidates.length > 0) {
          event.preventDefault();
          selectedIndex =
            (selectedIndex - 1 + candidates.length) % candidates.length;
          renderer?.updateProps({ selectedIndex });
          return true;
        }
        if (
          (event.key === "Enter" || event.key === "Tab") &&
          candidates.length > 0
        ) {
          event.preventDefault();
          const selected = candidates[selectedIndex];
          if (!selected) return false;
          command?.(selected);
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
    suggestion: suggestion as unknown as Omit<SuggestionOptions, "editor">,
  });
}

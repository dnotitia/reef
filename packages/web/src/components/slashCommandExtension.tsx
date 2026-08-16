import { cn } from "@/lib/utils";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { exitSuggestion, Suggestion } from "@tiptap/suggestion";
import {
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import { findSuggestionMatch } from "@tiptap/suggestion";

export type SlashCommandCategory = "text" | "lists" | "structure";

export type SlashCommandId =
  | "heading1"
  | "heading2"
  | "heading3"
  | "quote"
  | "bulletList"
  | "numberedList"
  | "taskList"
  | "table"
  | "codeBlock"
  | "divider";

export interface SlashCommandMessages {
  header: string;
  escapeHint: string;
  sections: Record<SlashCommandCategory, string>;
  footer: {
    navigation: string;
    insert: string;
    close: string;
  };
  empty: string;
  commands: Record<
    SlashCommandId,
    {
      label: string;
      description: string;
    }
  >;
}

export const DEFAULT_SLASH_COMMAND_MESSAGES: SlashCommandMessages = {
  header: "Insert block",
  escapeHint: "Esc",
  sections: {
    text: "TEXT",
    lists: "LISTS",
    structure: "STRUCTURE",
  },
  footer: {
    navigation: "↑↓ Navigate",
    insert: "↵ Insert",
    close: "Esc Close",
  },
  empty: "No matching blocks.",
  commands: {
    heading1: { label: "Heading 1", description: "Large section heading" },
    heading2: { label: "Heading 2", description: "Medium section heading" },
    heading3: { label: "Heading 3", description: "Small section heading" },
    quote: { label: "Quote", description: "Call out a quotation" },
    bulletList: {
      label: "Bullet list",
      description: "Create an unordered list",
    },
    numberedList: {
      label: "Numbered list",
      description: "Create an ordered list",
    },
    taskList: { label: "Task list", description: "Track work with checkboxes" },
    table: { label: "Table", description: "Insert a basic 3 × 2 table" },
    codeBlock: { label: "Code block", description: "Add a fenced code block" },
    divider: { label: "Divider", description: "Separate sections with a rule" },
  },
};

export interface SlashCommandDefinition {
  id: SlashCommandId;
  category: SlashCommandCategory;
  icon: LucideIcon;
  keywords: readonly string[];
  action: (editor: Editor, range: Range) => void;
}

export interface LocalizedSlashCommand extends SlashCommandDefinition {
  label: string;
  description: string;
}

const slashCommandPluginKey = new PluginKey("reefSlashCommand");

const replaceTrigger = (
  editor: Editor,
  range: Range,
  command: (chain: ReturnType<Editor["chain"]>) => void,
) => {
  const chain = editor.chain().focus().deleteRange(range);
  command(chain);
  chain.run();
};

/**
 * The command registry is deliberately data-first. Adding a block means
 * adding one definition here, including its category, icon, keywords, and
 * action; rendering and filtering consume the same registry.
 */
export const SLASH_COMMAND_DEFINITIONS: readonly SlashCommandDefinition[] = [
  {
    id: "heading1",
    category: "text",
    icon: Heading1,
    keywords: ["heading", "h1", "title", "제목", "큰 제목"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.setHeading({ level: 1 })),
  },
  {
    id: "heading2",
    category: "text",
    icon: Heading2,
    keywords: ["heading", "h2", "subtitle", "제목", "중간 제목"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.setHeading({ level: 2 })),
  },
  {
    id: "heading3",
    category: "text",
    icon: Heading3,
    keywords: ["heading", "h3", "subtitle", "제목", "작은 제목"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.setHeading({ level: 3 })),
  },
  {
    id: "quote",
    category: "text",
    icon: Quote,
    keywords: ["quote", "blockquote", "인용", "인용문"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.toggleBlockquote()),
  },
  {
    id: "bulletList",
    category: "lists",
    icon: List,
    keywords: ["bullet", "bulleted", "unordered", "list", "글머리", "목록"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.toggleBulletList()),
  },
  {
    id: "numberedList",
    category: "lists",
    icon: ListOrdered,
    keywords: ["number", "numbered", "ordered", "list", "번호", "순서", "목록"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.toggleOrderedList()),
  },
  {
    id: "taskList",
    category: "lists",
    icon: CheckSquare,
    keywords: ["task", "todo", "checklist", "checkbox", "할 일", "체크리스트"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.toggleTaskList()),
  },
  {
    id: "table",
    category: "structure",
    icon: Table2,
    keywords: ["table", "grid", "표", "테이블"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) =>
        chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }),
      ),
  },
  {
    id: "codeBlock",
    category: "structure",
    icon: Code2,
    keywords: ["code", "pre", "fence", "코드", "코드 블록"],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.setCodeBlock()),
  },
  {
    id: "divider",
    category: "structure",
    icon: Minus,
    keywords: [
      "divider",
      "separator",
      "rule",
      "horizontal",
      "구분선",
      "수평선",
    ],
    action: (editor, range) =>
      replaceTrigger(editor, range, (chain) => chain.setHorizontalRule()),
  },
] as const;

const SLASH_COMMAND_CATEGORY_ORDER: readonly SlashCommandCategory[] = [
  "text",
  "lists",
  "structure",
];

export function createLocalizedSlashCommandRegistry(
  messages: SlashCommandMessages,
): readonly LocalizedSlashCommand[] {
  return SLASH_COMMAND_DEFINITIONS.map((definition) => ({
    ...definition,
    label: messages.commands[definition.id].label,
    description: messages.commands[definition.id].description,
  }));
}

interface SlashCommandMenuProps {
  items: readonly LocalizedSlashCommand[];
  selectedIndex: number;
  listboxId: string;
  messages: SlashCommandMessages;
  onSelect: (command: LocalizedSlashCommand) => void;
}

function SlashCommandMenu({
  items,
  selectedIndex,
  listboxId,
  messages,
  onSelect,
}: SlashCommandMenuProps) {
  const selectedId = items[selectedIndex]?.id;

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={messages.header}
      data-testid="slash-command-menu"
      className="reef-slash-command-menu"
    >
      <div className="reef-slash-command-header">
        <span className="font-medium text-foreground">{messages.header}</span>
        <kbd className="reef-slash-command-escape">{messages.escapeHint}</kbd>
      </div>

      <div className="reef-slash-command-options">
        {SLASH_COMMAND_CATEGORY_ORDER.map((category) => {
          const categoryItems = items.filter(
            (item) => item.category === category,
          );
          if (categoryItems.length === 0) return null;

          return (
            <section
              key={category}
              aria-label={messages.sections[category]}
              data-slash-section={category}
              className="reef-slash-command-section"
            >
              <div className="reef-slash-command-section-label">
                {messages.sections[category]}
              </div>
              {categoryItems.map((item) => {
                const itemIndex = items.findIndex(
                  (candidate) => candidate.id === item.id,
                );
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    id={`${listboxId}-${item.id}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selectedId === item.id}
                    aria-label={`${item.label}: ${item.description}`}
                    data-slash-command={item.id}
                    className={cn(
                      "reef-slash-command-option",
                      selectedId === item.id &&
                        "reef-slash-command-option-selected",
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelect(items[itemIndex] ?? item)}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="reef-slash-command-label">
                        {item.label}
                      </span>
                      <span className="reef-slash-command-description">
                        {item.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}

        {items.length === 0 && (
          <div
            role="status"
            data-testid="slash-command-empty"
            className="reef-slash-command-empty"
          >
            {messages.empty}
          </div>
        )}
      </div>

      <div className="reef-slash-command-footer" aria-hidden="true">
        <span>{messages.footer.navigation}</span>
        <span>{messages.footer.insert}</span>
        <span>{messages.footer.close}</span>
      </div>
    </div>
  );
}

function setSlashAria(
  editor: Editor,
  listboxId: string,
  selectedId: SlashCommandId | undefined,
  itemCount: number,
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
  if (itemCount === 0) {
    element.removeAttribute("aria-activedescendant");
  } else {
    element.setAttribute("aria-activedescendant", `${listboxId}-${selectedId}`);
  }
}

export function filterSlashCommands(
  commands: readonly LocalizedSlashCommand[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...commands];

  return commands.filter((command) => {
    const haystack = [command.label, command.description, ...command.keywords]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(normalized);
  });
}

function positionSlashMenu(
  menu: HTMLElement,
  editor: Editor,
  data: { x: number; y: number; strategy: "absolute" | "fixed" },
  anchor: DOMRect | null,
) {
  const editorRoot =
    editor.view.dom.closest<HTMLElement>('[data-testid="markdown-editor"]') ??
    editor.view.dom;
  const editorRect = editorRoot.getBoundingClientRect();
  const viewportInset = 8;
  const boundaryLeft = Math.max(viewportInset, editorRect.left + viewportInset);
  const boundaryRight = Math.min(
    window.innerWidth - viewportInset,
    editorRect.right - viewportInset,
  );
  const boundaryTop = Math.max(viewportInset, editorRect.top + viewportInset);
  const boundaryBottom = Math.min(
    window.innerHeight - viewportInset,
    editorRect.bottom - viewportInset,
  );
  const menuRect = menu.getBoundingClientRect();
  const availableWidth = Math.max(0, boundaryRight - boundaryLeft);
  const width = Math.min(
    menuRect.width || 360,
    availableWidth > 0 ? availableWidth : 360,
  );
  if (availableWidth > 0) {
    menu.style.width = `${width}px`;
  }
  const availableHeight = Math.max(0, boundaryBottom - boundaryTop);
  const height = Math.min(
    menuRect.height || 280,
    availableHeight > 0 ? availableHeight : 280,
  );
  if (availableHeight > 0) {
    menu.style.maxHeight = `${availableHeight}px`;
    const options = menu.querySelector<HTMLElement>(
      ".reef-slash-command-options",
    );
    if (options) {
      options.style.maxHeight = `${Math.max(64, availableHeight - 92)}px`;
    }
  }
  const maxLeft = Math.max(boundaryLeft, boundaryRight - width);
  const left = Math.min(Math.max(data.x, boundaryLeft), maxLeft);

  let top = data.y;
  if (top + height > boundaryBottom && anchor) {
    top = anchor.top - height - 4;
  }
  const maxTop = Math.max(boundaryTop, boundaryBottom - height);
  top = Math.min(Math.max(top, boundaryTop), maxTop);

  Object.assign(menu.style, {
    position: data.strategy,
    left: `${left}px`,
    top: `${top}px`,
    visibility: "visible",
  });
}

export interface SlashCommandExtensionOptions {
  messages?: SlashCommandMessages;
}

function createSlashSuggestion(
  options: SlashCommandExtensionOptions,
): Omit<
  SuggestionOptions<LocalizedSlashCommand, LocalizedSlashCommand>,
  "editor"
> {
  const messages = options.messages ?? DEFAULT_SLASH_COMMAND_MESSAGES;
  const commands = createLocalizedSlashCommandRegistry(messages);
  let renderer: ReactRenderer<unknown, SlashCommandMenuProps> | null = null;
  let unmount: (() => void) | undefined;
  let selectedIndex = 0;
  let items: LocalizedSlashCommand[] = [];
  let command: ((item: LocalizedSlashCommand) => void) | undefined;
  let activeEditor: Editor | null = null;
  const listboxId = `reef-slash-command-list-${Math.random().toString(36).slice(2, 10)}`;

  function updateRenderer(
    props: SuggestionProps<LocalizedSlashCommand, LocalizedSlashCommand>,
  ) {
    items = props.items;
    selectedIndex = 0;
    command = props.command;
    setSlashAria(
      props.editor,
      listboxId,
      items[selectedIndex]?.id,
      items.length,
      true,
    );
    renderer?.updateProps({
      items,
      selectedIndex,
      listboxId,
      messages,
      onSelect: (item: LocalizedSlashCommand) => command?.(item),
    });
  }

  return {
    pluginKey: slashCommandPluginKey,
    char: "/",
    allowSpaces: true,
    allowedPrefixes: null,
    startOfLine: true,
    placement: "bottom-start" as const,
    flip: true,
    decorationClass: "reef-slash-command-suggestion",
    allow: ({ editor }) => {
      if (editor.state.selection.$from.parent.type.name !== "paragraph") {
        return false;
      }
      return !editor.view.composing && !editor.isActive("code");
    },
    findSuggestionMatch: (config) => {
      const match = findSuggestionMatch({
        ...config,
        allowedPrefixes: null,
        startOfLine: true,
      });
      if (!match) return null;
      const parent = config.$position.parent;
      if (parent.type.name !== "paragraph") return null;
      const paragraphStart = config.$position.start();
      const before = config.$position.doc.textBetween(
        paragraphStart,
        match.range.from,
        "\n",
      );
      return before.length === 0 ? match : null;
    },
    items: ({ query }: { query: string }) =>
      filterSlashCommands(commands, query),
    command: ({
      editor,
      range,
      props,
    }: {
      editor: Editor;
      range: Range;
      props: LocalizedSlashCommand;
    }) => {
      props.action(editor, range);
    },
    render: () => ({
      onStart: (
        props: SuggestionProps<LocalizedSlashCommand, LocalizedSlashCommand>,
      ) => {
        activeEditor = props.editor;
        selectedIndex = 0;
        items = props.items;
        command = props.command;
        renderer = new ReactRenderer(SlashCommandMenu, {
          editor: props.editor,
          className: "reef-slash-command-popup",
          props: {
            items,
            selectedIndex,
            listboxId,
            messages,
            onSelect: (item: LocalizedSlashCommand) => command?.(item),
          },
        });
        renderer.element.dataset.testid = "slash-command-popup";
        unmount = props.mount(renderer.element, {
          onPosition: (data) =>
            positionSlashMenu(
              renderer?.element ?? document.body,
              props.editor,
              data,
              props.clientRect?.() ?? null,
            ),
        });
        setSlashAria(
          props.editor,
          listboxId,
          items[selectedIndex]?.id,
          items.length,
          true,
        );
      },
      onUpdate: updateRenderer,
      onExit: ({
        editor,
      }: SuggestionProps<LocalizedSlashCommand, LocalizedSlashCommand>) => {
        setSlashAria(editor, listboxId, undefined, items.length, false);
        unmount?.();
        unmount = undefined;
        renderer?.destroy();
        renderer = null;
        items = [];
        command = undefined;
        selectedIndex = 0;
        activeEditor = null;
      },
      onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
        if (event.isComposing) return false;
        if (event.key === "ArrowDown" && items.length > 0) {
          event.preventDefault();
          selectedIndex = (selectedIndex + 1) % items.length;
          renderer?.updateProps({ selectedIndex });
          if (activeEditor) {
            setSlashAria(
              activeEditor,
              listboxId,
              items[selectedIndex]?.id,
              items.length,
              true,
            );
          }
          return true;
        }
        if (event.key === "ArrowUp" && items.length > 0) {
          event.preventDefault();
          selectedIndex = (selectedIndex - 1 + items.length) % items.length;
          renderer?.updateProps({ selectedIndex });
          if (activeEditor) {
            setSlashAria(
              activeEditor,
              listboxId,
              items[selectedIndex]?.id,
              items.length,
              true,
            );
          }
          return true;
        }
        if (event.key === "Enter" && items.length > 0) {
          event.preventDefault();
          const selected = items[selectedIndex];
          if (!selected) return false;
          command?.(selected);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          exitSuggestion(view, slashCommandPluginKey);
          return true;
        }
        return false;
      },
    }),
  };
}

export function createSlashCommandExtension(
  options: SlashCommandExtensionOptions,
) {
  const suggestion = createSlashSuggestion(options);
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [Suggestion({ ...suggestion, editor: this.editor })];
    },
  });
}

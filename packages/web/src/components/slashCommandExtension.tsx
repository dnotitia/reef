import { ReactRenderer } from "@tiptap/react";
import {
  findSuggestionMatch,
  Suggestion,
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { Extension, type Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";

export type SlashCommandId =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "table"
  | "codeBlock"
  | "blockquote"
  | "divider";

export interface SlashCommandItem {
  id: SlashCommandId;
  label: string;
  keywords: readonly string[];
}

export interface SlashCommandExtensionOptions {
  suggestionsLabel: string;
  commands: readonly SlashCommandItem[];
}

interface SlashSuggestionListProps {
  items: readonly SlashCommandItem[];
  selectedIndex: number;
  listboxId: string;
  suggestionsLabel: string;
  onSelect: (item: SlashCommandItem) => void;
}

function SlashSuggestionList({
  items,
  selectedIndex,
  listboxId,
  suggestionsLabel,
  onSelect,
}: SlashSuggestionListProps) {
  if (items.length === 0) return null;
  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={suggestionsLabel}
      className="max-h-64 min-w-56 max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-elevated p-1 shadow-lg"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          id={`${listboxId}-${index}`}
          type="button"
          tabIndex={-1}
          role="option"
          aria-selected={index === selectedIndex}
          className="flex w-full min-w-0 items-center rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover aria-selected:bg-surface-hover"
          onPointerDown={(event) => {
            // Keep the ProseMirror range active until click. Floating UI's
            // outside-pointer dismissal otherwise exits the suggestion before
            // the command can consume the button click.
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
            onSelect(item);
          }}
        >
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function setSlashAria(
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

function runSlashCommand(editor: Editor, id: SlashCommandId) {
  const chain = editor.chain().focus();
  switch (id) {
    case "heading1":
      chain.toggleHeading({ level: 1 }).run();
      break;
    case "heading2":
      chain.toggleHeading({ level: 2 }).run();
      break;
    case "heading3":
      chain.toggleHeading({ level: 3 }).run();
      break;
    case "bulletList":
      chain.toggleBulletList().run();
      break;
    case "orderedList":
      chain.toggleOrderedList().run();
      break;
    case "taskList":
      chain.toggleTaskList().run();
      break;
    case "table":
      chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
      break;
    case "codeBlock":
      chain.toggleCodeBlock().run();
      break;
    case "blockquote":
      chain.toggleBlockquote().run();
      break;
    case "divider":
      chain.setHorizontalRule().run();
      break;
  }
}

function createSlashSuggestion(
  options: SlashCommandExtensionOptions,
): Omit<SuggestionOptions<SlashCommandItem>, "editor"> {
  let renderer: ReactRenderer | null = null;
  let unmount: (() => void) | undefined;
  let selectedIndex = 0;
  let items: SlashCommandItem[] = [];
  let command: ((item: SlashCommandItem) => void) | undefined;
  const listboxId = `reef-slash-command-list-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  function updateRenderer(props: SuggestionProps<SlashCommandItem>) {
    items = props.items;
    selectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));
    command = props.command;
    setSlashAria(props.editor, listboxId, selectedIndex, items.length > 0);
    renderer?.updateProps({
      items,
      selectedIndex,
      listboxId,
      suggestionsLabel: options.suggestionsLabel,
      onSelect: (item: SlashCommandItem) => command?.(item),
    });
  }

  return {
    pluginKey: new PluginKey("reefSlashCommandSuggestion"),
    char: "/",
    startOfLine: true,
    allowedPrefixes: null,
    findSuggestionMatch: (config) =>
      findSuggestionMatch({
        ...config,
        startOfLine: true,
        allowedPrefixes: null,
      }),
    allow: ({ editor }) => {
      if (editor.view.composing) return false;
      const parent = editor.state.selection.$from.parent;
      return parent.type.name === "paragraph";
    },
    items: ({ query }) => {
      const normalizedQuery = query.toLocaleLowerCase();
      return options.commands
        .filter((item) => {
          if (!normalizedQuery) return true;
          return [item.label, ...item.keywords].some((value) =>
            value.toLocaleLowerCase().includes(normalizedQuery),
          );
        })
        .slice(0, 10);
    },
    command: ({ editor, range, props }) => {
      editor.chain().focus().deleteRange(range).run();
      runSlashCommand(editor, props.id);
    },
    render: () => ({
      onStart: (props) => {
        selectedIndex = 0;
        items = props.items;
        command = props.command;
        renderer = new ReactRenderer(SlashSuggestionList, {
          editor: props.editor,
          className: "reef-slash-command-popup",
          props: {
            items,
            selectedIndex,
            listboxId,
            suggestionsLabel: options.suggestionsLabel,
            onSelect: (item: SlashCommandItem) => command?.(item),
          },
        });
        unmount = props.mount(renderer.element);
        setSlashAria(props.editor, listboxId, selectedIndex, items.length > 0);
      },
      onUpdate: updateRenderer,
      onExit: ({ editor }) => {
        setSlashAria(editor, listboxId, selectedIndex, false);
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

export function createSlashCommandExtension(
  options: SlashCommandExtensionOptions,
) {
  const suggestion = createSlashSuggestion(options);
  return Extension.create({
    name: "reefSlashCommand",
    addProseMirrorPlugins() {
      return [Suggestion({ ...suggestion, editor: this.editor })];
    },
  });
}

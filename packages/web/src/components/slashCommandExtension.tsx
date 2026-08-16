import { cn } from "@/lib/utils";
import { scrollOptionIntoView } from "@/lib/scrollOptionIntoView";
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
  SuggestionPositionData,
  SuggestionProps,
} from "@tiptap/suggestion";
import { findSuggestionMatch } from "@tiptap/suggestion";
import { useEffect, useRef } from "react";

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
  onActiveChange: (index: number) => void;
  onSelect: (command: LocalizedSlashCommand) => void;
}

function SlashCommandMenu({
  items,
  selectedIndex,
  listboxId,
  messages,
  onActiveChange,
  onSelect,
}: SlashCommandMenuProps) {
  const optionsRef = useRef<HTMLDivElement>(null);
  const selectedId = items[selectedIndex]?.id;

  useEffect(() => {
    const options = optionsRef.current;
    if (!options) return;
    // Dialog scroll locks listen on document and cancel wheel events from
    // portaled children. Keep the options viewport as the sole wheel owner.
    const stopWheelPropagation = (event: WheelEvent) => event.stopPropagation();
    options.addEventListener("wheel", stopWheelPropagation);
    return () => options.removeEventListener("wheel", stopWheelPropagation);
  }, []);

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

      <div ref={optionsRef} className="reef-slash-command-options">
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
                    onMouseEnter={() => onActiveChange(itemIndex)}
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

const SLASH_MENU_VIEWPORT_INSET = 8;
const SLASH_MENU_OFFSET = 4;
const SLASH_MENU_NOMINAL_WIDTH = 360;
const SLASH_MENU_DEFAULT_HEIGHT = 280;
const SLASH_MENU_MAX_HEIGHT = 420;
const SLASH_MENU_OPTIONS_MAX_HEIGHT = 320;

export interface SlashMenuBoundary {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface ResolvedSlashMenuPosition {
  visible: boolean;
  left: number;
  top: number;
}

function isClippingOverflow(value: string): boolean {
  return ["auto", "clip", "hidden", "overlay", "scroll"].includes(value);
}

function hasPositiveArea(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
) {
  return rect.right > rect.left && rect.bottom > rect.top;
}

function hasAnchorArea(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
) {
  return rect.right > rect.left || rect.bottom > rect.top;
}

function intersectBoundary(
  boundary: SlashMenuBoundary,
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
) {
  if (!hasPositiveArea(rect)) return;
  boundary.left = Math.max(
    boundary.left,
    rect.left + SLASH_MENU_VIEWPORT_INSET,
  );
  boundary.right = Math.min(
    boundary.right,
    rect.right - SLASH_MENU_VIEWPORT_INSET,
  );
  boundary.top = Math.max(boundary.top, rect.top + SLASH_MENU_VIEWPORT_INSET);
  boundary.bottom = Math.min(
    boundary.bottom,
    rect.bottom - SLASH_MENU_VIEWPORT_INSET,
  );
}

/**
 * Resolve the visible editor/dialog clipping rectangle for the portaled menu.
 * Only elements that actually clip or scroll their contents are boundaries;
 * layout wrappers around the editor must not shrink the menu to their height.
 * Every clipping ancestor is intersected so a dialog that is being scrolled
 * cannot leave a stale popup behind.
 */
export function getSlashMenuBoundary(
  editorRoot: HTMLElement,
): SlashMenuBoundary {
  const boundary: SlashMenuBoundary = {
    left: SLASH_MENU_VIEWPORT_INSET,
    right: Math.max(
      SLASH_MENU_VIEWPORT_INSET,
      window.innerWidth - SLASH_MENU_VIEWPORT_INSET,
    ),
    top: SLASH_MENU_VIEWPORT_INSET,
    bottom: Math.max(
      SLASH_MENU_VIEWPORT_INSET,
      window.innerHeight - SLASH_MENU_VIEWPORT_INSET,
    ),
  };

  let current: HTMLElement | null = editorRoot;
  while (current && current !== document.body) {
    const styles = getComputedStyle(current);
    if (
      isClippingOverflow(styles.overflowX) ||
      isClippingOverflow(styles.overflowY)
    ) {
      intersectBoundary(boundary, current.getBoundingClientRect());
    }
    current = current.parentElement;
  }

  return boundary;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute placement in the same coordinate space as Floating UI's strategy.
 * The trigger is kept clear when either side has room; if neither side fits,
 * the menu is clamped to the available boundary and its own options scroll.
 */
export function resolveSlashMenuPosition({
  anchor,
  boundary,
  menuWidth,
  menuHeight,
  data,
}: {
  anchor: DOMRect | null;
  boundary: SlashMenuBoundary;
  menuWidth: number;
  menuHeight: number;
  data: SuggestionPositionData;
}): ResolvedSlashMenuPosition {
  const width = Math.max(0, menuWidth);
  const height = Math.max(0, menuHeight);
  const scrollX = data.strategy === "absolute" ? window.scrollX : 0;
  const scrollY = data.strategy === "absolute" ? window.scrollY : 0;
  const boundaryLeft = boundary.left + scrollX;
  const boundaryRight = boundary.right + scrollX;
  const boundaryTop = boundary.top + scrollY;
  const boundaryBottom = boundary.bottom + scrollY;
  const maxLeft = Math.max(boundaryLeft, boundaryRight - width);
  const maxTop = Math.max(boundaryTop, boundaryBottom - height);
  const left = clamp(data.x, boundaryLeft, maxLeft);

  // jsdom and a few browser layout transitions can briefly expose a zero-area
  // caret rect. Keep the managed popup alive for that frame and let the next
  // Floating UI update supply the real anchor; a null rect still closes it.
  if (!anchor) {
    return { visible: false, left, top: clamp(data.y, boundaryTop, maxTop) };
  }
  if (!hasAnchorArea(anchor)) {
    return { visible: true, left, top: clamp(data.y, boundaryTop, maxTop) };
  }

  const anchorVisible =
    anchor.right >= boundary.left &&
    anchor.left <= boundary.right &&
    anchor.bottom > boundary.top &&
    anchor.top < boundary.bottom;
  if (!anchorVisible) {
    return { visible: false, left, top: clamp(data.y, boundaryTop, maxTop) };
  }

  const anchorTop = anchor.top + scrollY;
  const anchorBottom = anchor.bottom + scrollY;
  const belowTop = anchorBottom + SLASH_MENU_OFFSET;
  const aboveTop = anchorTop - height - SLASH_MENU_OFFSET;
  const belowFits = belowTop + height <= boundaryBottom;
  const aboveFits = aboveTop >= boundaryTop;
  const belowSpace = Math.max(0, boundaryBottom - belowTop);
  const aboveSpace = Math.max(0, aboveTop + height - boundaryTop);

  let top: number;
  if (belowFits) {
    top = belowTop;
  } else if (aboveFits) {
    top = aboveTop;
  } else {
    top = belowSpace >= aboveSpace ? belowTop : aboveTop;
    top = clamp(top, boundaryTop, maxTop);
  }

  return { visible: true, left, top };
}

export function ensureSlashOptionVisible(
  listboxId: string,
  selectedId: SlashCommandId | undefined,
) {
  if (!selectedId) return;
  const option = document.getElementById(`${listboxId}-${selectedId}`);
  const options = option?.closest<HTMLElement>(".reef-slash-command-options");
  if (!option || !options) return;
  scrollOptionIntoView(options, option);
}

function getSlashAnchorRect(
  editor: Editor,
  fallback: (() => DOMRect | null) | null | undefined,
): DOMRect | null {
  const decoration = editor.view.dom.querySelector<HTMLElement>(
    ".reef-slash-command-suggestion[data-decoration-id]",
  );
  const decorationRect = decoration?.getBoundingClientRect();
  if (decorationRect && hasAnchorArea(decorationRect)) {
    return decorationRect;
  }
  return fallback?.() ?? null;
}

function positionSlashMenu(
  menu: HTMLElement,
  editor: Editor,
  data: SuggestionPositionData,
  anchor: DOMRect | null,
): boolean {
  const editorRoot =
    editor.view.dom.closest<HTMLElement>('[data-testid="markdown-editor"]') ??
    editor.view.dom;
  const boundary = getSlashMenuBoundary(editorRoot);
  const availableWidth = Math.max(0, boundary.right - boundary.left);
  const availableHeight = Math.max(0, boundary.bottom - boundary.top);
  const measuredRect = menu.getBoundingClientRect();
  const belowSpace = anchor
    ? Math.max(0, boundary.bottom - anchor.bottom - SLASH_MENU_OFFSET)
    : availableHeight;
  const aboveSpace = anchor
    ? Math.max(0, anchor.top - boundary.top - SLASH_MENU_OFFSET)
    : availableHeight;
  const sideHeight =
    anchor && hasAnchorArea(anchor)
      ? Math.max(belowSpace, aboveSpace)
      : availableHeight;
  const maxMenuHeight = Math.min(
    SLASH_MENU_MAX_HEIGHT,
    availableHeight || SLASH_MENU_MAX_HEIGHT,
    sideHeight || availableHeight || SLASH_MENU_MAX_HEIGHT,
  );
  const nominalWidth =
    measuredRect.width ||
    Number.parseFloat(getComputedStyle(menu).width) ||
    SLASH_MENU_NOMINAL_WIDTH;
  const width = Math.min(nominalWidth, availableWidth || nominalWidth);
  if (availableWidth > 0) {
    menu.style.width = `${width}px`;
  }

  if (availableHeight > 0) {
    menu.style.maxHeight = `${maxMenuHeight}px`;
    const options = menu.querySelector<HTMLElement>(
      ".reef-slash-command-options",
    );
    if (options) {
      const headerHeight =
        menu
          .querySelector<HTMLElement>(".reef-slash-command-header")
          ?.getBoundingClientRect().height || 36;
      const footerHeight =
        menu
          .querySelector<HTMLElement>(".reef-slash-command-footer")
          ?.getBoundingClientRect().height || 30;
      options.style.maxHeight = `${Math.min(
        SLASH_MENU_OPTIONS_MAX_HEIGHT,
        Math.max(0, maxMenuHeight - headerHeight - footerHeight),
      )}px`;
    }
  }

  // Re-measure after applying the boundary-owned dimensions so the flip/clamp
  // decision reflects the actual bounded menu rather than its natural height.
  const boundedRect = menu.getBoundingClientRect();
  const height = Math.min(
    boundedRect.height || measuredRect.height || SLASH_MENU_DEFAULT_HEIGHT,
    availableHeight || SLASH_MENU_MAX_HEIGHT,
  );
  const resolved = resolveSlashMenuPosition({
    anchor,
    boundary,
    menuWidth: width,
    menuHeight: height,
    data,
  });

  if (!resolved.visible) {
    menu.style.visibility = "hidden";
    return false;
  }

  Object.assign(menu.style, {
    position: data.strategy,
    left: `${resolved.left}px`,
    top: `${resolved.top}px`,
    visibility: "visible",
  });
  return true;
}

export interface SlashCommandExtensionOptions {
  messages?: SlashCommandMessages;
  /** Keeps a surrounding Dialog/Sheet open while the menu consumes Escape. */
  onOpenChange?: (open: boolean, dismiss?: () => void) => void;
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
      onActiveChange: setActiveIndex,
      onSelect: (item: LocalizedSlashCommand) => command?.(item),
    });
    const options = renderer?.element.querySelector<HTMLElement>(
      ".reef-slash-command-options",
    );
    if (options) options.scrollTop = 0;
    queueMicrotask(() =>
      ensureSlashOptionVisible(listboxId, items[selectedIndex]?.id),
    );
  }

  function setActiveIndex(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= items.length) return;
    selectedIndex = nextIndex;
    renderer?.updateProps({ selectedIndex });
    queueMicrotask(() =>
      ensureSlashOptionVisible(listboxId, items[selectedIndex]?.id),
    );
    if (activeEditor) {
      setSlashAria(
        activeEditor,
        listboxId,
        items[selectedIndex]?.id,
        items.length,
        true,
      );
    }
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
        options.onOpenChange?.(true, () =>
          exitSuggestion(props.editor.view, slashCommandPluginKey),
        );
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
            onActiveChange: setActiveIndex,
            onSelect: (item: LocalizedSlashCommand) => command?.(item),
          },
        });
        renderer.element.dataset.testid = "slash-command-popup";
        unmount = props.mount(renderer.element, {
          onPosition: (data) => {
            const positioned = positionSlashMenu(
              renderer?.element ?? document.body,
              props.editor,
              data,
              getSlashAnchorRect(props.editor, props.clientRect),
            );
            if (!positioned) {
              exitSuggestion(props.editor.view, slashCommandPluginKey);
            }
          },
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
        options.onOpenChange?.(false);
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
          setActiveIndex((selectedIndex + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp" && items.length > 0) {
          event.preventDefault();
          setActiveIndex((selectedIndex - 1 + items.length) % items.length);
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
          event.stopPropagation();
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

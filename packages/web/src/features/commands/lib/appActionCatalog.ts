export type AppActionSurface = "palette" | "shortcut" | "cheatsheet";
export type AppActionScope = "global" | "list" | "board" | "backlog" | "detail";
export type AppActionGroup =
  | "navigation"
  | "views"
  | "issues"
  | "preferences"
  | "ai"
  | "misc";
export type CommandPage =
  | "root"
  | "navigation"
  | "view"
  | "theme"
  | "locale"
  | "status"
  | "assignee"
  | "priority";
export type CommandParentPage = Exclude<CommandPage, "root">;
export type PaletteFocusPolicy = "restore" | "navigate" | "handoff";

export interface CommandPageDescriptor {
  page: CommandParentPage;
  searchAliases: ReadonlyArray<string>;
}

export interface AppActionKeySpec {
  key: string;
  code?: string;
  modKey?: boolean;
  primaryModKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface AppActionShortcut {
  keys: ReadonlyArray<string>;
  alternateKeys?: ReadonlyArray<ReadonlyArray<string>>;
  firefoxKeys?: ReadonlyArray<string>;
  scope: AppActionScope;
  bindings: ReadonlyArray<{
    keys: ReadonlyArray<AppActionKeySpec>;
    chordPrefix?: string;
    allowEditableTarget?: boolean;
    allowInteractiveTarget?: boolean;
  }>;
}

export interface AppActionDescriptor {
  id: string;
  /** Stable key below `commands.actions.*`. */
  labelKey: string;
  /** Stable keys below `commands.aliases.*`. */
  aliasKeys: ReadonlyArray<string>;
  /** Locale-independent terms projected directly into command search. */
  searchAliases?: ReadonlyArray<string>;
  group: AppActionGroup;
  scopes: ReadonlyArray<AppActionScope>;
  surfaces: ReadonlyArray<AppActionSurface>;
  page?: CommandPage;
  parentPage?: CommandParentPage;
  focusPolicy: PaletteFocusPolicy;
  shortcut?: AppActionShortcut;
}

const action = (descriptor: AppActionDescriptor): AppActionDescriptor =>
  descriptor;

export const COMMAND_PAGE_CATALOG: Readonly<
  Record<CommandParentPage, CommandPageDescriptor>
> = {
  navigation: {
    page: "navigation",
    searchAliases: ["go to", "navigate", "이동", "탐색"],
  },
  view: {
    page: "view",
    searchAliases: ["view", "layout", "보기", "화면"],
  },
  theme: {
    page: "theme",
    searchAliases: ["theme", "appearance", "테마", "화면 모드"],
  },
  locale: {
    page: "locale",
    searchAliases: ["language", "locale", "언어", "로케일"],
  },
  status: {
    page: "status",
    searchAliases: ["status", "state", "상태"],
  },
  assignee: {
    page: "assignee",
    searchAliases: ["assignee", "owner", "담당자"],
  },
  priority: {
    page: "priority",
    searchAliases: ["priority", "importance", "우선순위"],
  },
};

export function getCommandPageDescriptor(
  page: CommandParentPage,
): CommandPageDescriptor {
  return COMMAND_PAGE_CATALOG[page];
}

const NAVIGATION_SEARCH_ALIASES = {
  issues: ["issues", "이슈"],
  myWork: ["my work", "내 작업"],
  reports: ["reports", "리포트", "보고서"],
  planning: ["planning", "플래닝", "계획"],
  settings: ["settings", "설정"],
} as const;

const VIEW_SEARCH_ALIASES = {
  board: ["board", "kanban", "보드", "칸반"],
  list: ["list", "table", "리스트", "표"],
  timeline: ["timeline", "schedule", "타임라인", "일정"],
  backlog: ["backlog", "triage", "백로그", "트리아지"],
} as const;

const THEME_SEARCH_ALIASES = {
  light: ["light", "라이트", "밝게"],
  dark: ["dark", "다크", "어둡게"],
  system: ["system", "시스템", "자동"],
} as const;

const LOCALE_SEARCH_ALIASES = {
  en: ["english", "영어"],
  ko: ["korean", "한국어"],
} as const;

const STATUS_SEARCH_ALIASES = {
  backlog: ["backlog", "백로그"],
  todo: ["todo", "open", "할 일"],
  in_progress: ["in progress", "started", "진행 중"],
  in_review: ["in review", "review", "검토 중"],
  done: ["done", "completed", "완료"],
  closed: ["closed", "종료"],
} as const;

const PRIORITY_SEARCH_ALIASES = {
  critical: ["critical", "urgent", "긴급"],
  high: ["high", "높음"],
  medium: ["medium", "보통"],
  low: ["low", "낮음"],
  none: ["no priority", "none", "우선순위 없음"],
} as const;

export const APP_ACTION_CATALOG: ReadonlyArray<AppActionDescriptor> = [
  action({
    id: "palette.open",
    labelKey: "openPalette",
    aliasKeys: ["search", "commandMenu"],
    group: "navigation",
    scopes: ["global"],
    surfaces: ["shortcut", "cheatsheet"],
    focusPolicy: "restore",
    shortcut: {
      keys: ["mod", "K"],
      scope: "global",
      bindings: [
        {
          keys: [{ key: "k", modKey: true }],
          allowEditableTarget: true,
          allowInteractiveTarget: true,
        },
      ],
    },
  }),
  action({
    id: "shortcuts.open",
    labelKey: "showKeyboardShortcuts",
    aliasKeys: ["help", "hotkeys"],
    group: "navigation",
    scopes: ["global"],
    surfaces: ["shortcut", "cheatsheet"],
    focusPolicy: "handoff",
    shortcut: {
      keys: ["mod", "?"],
      scope: "global",
      bindings: [
        {
          keys: [
            { key: "?", modKey: true, shiftKey: true },
            { key: "/", modKey: true, shiftKey: true },
          ],
          allowEditableTarget: true,
          allowInteractiveTarget: true,
        },
      ],
    },
  }),
  action({
    id: "navigation.chord",
    labelKey: "navigation",
    aliasKeys: [],
    group: "navigation",
    scopes: ["global"],
    surfaces: ["shortcut"],
    focusPolicy: "restore",
    shortcut: {
      keys: ["G"],
      scope: "global",
      bindings: [{ keys: [{ key: "g" }] }],
    },
  }),
  ...[
    ["navigation.issues", "issues", "i"],
    ["navigation.myWork", "myWork", "m"],
    ["navigation.reports", "reports", "r"],
    ["navigation.planning", "planning", null],
    ["navigation.settings", "settings", null],
  ].map(([id, labelKey, chordKey]) =>
    action({
      id: id as string,
      labelKey: labelKey as string,
      aliasKeys: [
        `go${(labelKey as string)[0]?.toUpperCase()}${(
          labelKey as string
        ).slice(1)}`,
      ],
      searchAliases:
        NAVIGATION_SEARCH_ALIASES[
          labelKey as keyof typeof NAVIGATION_SEARCH_ALIASES
        ],
      group: "navigation",
      scopes: ["global"],
      surfaces: [
        "palette",
        ...(chordKey ? (["shortcut", "cheatsheet"] as const) : []),
      ],
      parentPage: "navigation",
      focusPolicy: "navigate",
      ...(chordKey
        ? {
            shortcut: {
              keys: ["G", (chordKey as string).toUpperCase()],
              scope: "global" as const,
              bindings: [
                {
                  chordPrefix: "g",
                  keys: [{ key: chordKey as string }],
                },
              ],
            },
          }
        : {}),
    }),
  ),
  action({
    id: "navigation.backlog",
    labelKey: "backlog",
    aliasKeys: ["goBacklog"],
    group: "navigation",
    scopes: ["global"],
    surfaces: ["shortcut", "cheatsheet"],
    focusPolicy: "navigate",
    shortcut: {
      keys: ["G", "B"],
      scope: "global",
      bindings: [{ chordPrefix: "g", keys: [{ key: "b" }] }],
    },
  }),
  action({
    id: "issue.new",
    labelKey: "newIssue",
    aliasKeys: ["createIssue", "addIssue"],
    searchAliases: [
      "new issue",
      "create issue",
      "add issue",
      "새 이슈",
      "이슈 생성",
      "이슈 추가",
    ],
    group: "issues",
    scopes: ["global"],
    surfaces: ["palette", "shortcut", "cheatsheet"],
    focusPolicy: "handoff",
    shortcut: {
      keys: ["mod", "I"],
      firefoxKeys: ["mod", "alt", "N"],
      scope: "global",
      bindings: [
        {
          keys: [{ key: "i", code: "KeyI", primaryModKey: true }],
          allowInteractiveTarget: true,
        },
      ],
    },
  }),
  ...[
    ["issue.focusNext", "focusNextIssue", ["J"], [["arrowDown"]], "list"],
    ["issue.focusPrevious", "focusPreviousIssue", ["K"], [["arrowUp"]], "list"],
    ["issue.openFocused", "openFocusedIssue", ["enter"], [], "list"],
    ["issue.editStatus", "editStatus", ["S"], [], "list"],
    ["issue.editAssignee", "editAssignee", ["A"], [], "list"],
    ["issue.editPriority", "editPriority", ["P"], [], "list"],
    ["issue.editLabels", "editLabels", ["L"], [], "list"],
  ].map(([id, labelKey, keys, alternateKeys, scope]) =>
    action({
      id: id as string,
      labelKey: labelKey as string,
      aliasKeys: [],
      group: "issues",
      scopes: [scope as AppActionScope, "board", "backlog"],
      surfaces: ["shortcut", "cheatsheet"],
      focusPolicy: "restore",
      shortcut: {
        keys: keys as string[],
        alternateKeys: alternateKeys as string[][],
        scope: scope as AppActionScope,
        bindings:
          id === "issue.focusNext"
            ? [{ keys: [{ key: "j" }, { key: "ArrowDown" }] }]
            : id === "issue.focusPrevious"
              ? [{ keys: [{ key: "k" }, { key: "ArrowUp" }] }]
              : id === "issue.openFocused"
                ? [{ keys: [{ key: "Enter" }] }]
                : id === "issue.editStatus"
                  ? [{ keys: [{ key: "s" }] }]
                  : id === "issue.editAssignee"
                    ? [{ keys: [{ key: "a" }] }]
                    : id === "issue.editPriority"
                      ? [{ keys: [{ key: "p" }] }]
                      : [{ keys: [{ key: "l" }] }],
      },
    }),
  ),
  action({
    id: "ai.toggle",
    labelKey: "toggleAskAi",
    aliasKeys: ["askAi"],
    group: "ai",
    scopes: ["global"],
    surfaces: ["shortcut", "cheatsheet"],
    focusPolicy: "handoff",
    shortcut: {
      keys: ["mod", "shift", "A"],
      scope: "global",
      bindings: [
        {
          keys: [{ key: "a", modKey: true, shiftKey: true }],
          allowInteractiveTarget: true,
        },
      ],
    },
  }),
  action({
    id: "misc.escape",
    labelKey: "closeDialogClearSearch",
    aliasKeys: [],
    group: "misc",
    scopes: ["global", "list"],
    surfaces: ["shortcut", "cheatsheet"],
    focusPolicy: "restore",
    shortcut: {
      keys: ["Esc"],
      scope: "global",
      bindings: [{ keys: [{ key: "Escape" }] }],
    },
  }),
  ...(["board", "list", "timeline", "backlog"] as const).map((view) =>
    action({
      id: `view.${view}`,
      labelKey: `view${view[0]?.toUpperCase()}${view.slice(1)}`,
      aliasKeys: [view],
      searchAliases: VIEW_SEARCH_ALIASES[view],
      group: "views",
      scopes: ["global"],
      surfaces: ["palette"],
      parentPage: "view",
      focusPolicy: "navigate",
    }),
  ),
  ...(["light", "dark", "system"] as const).map((theme) =>
    action({
      id: `theme.${theme}`,
      labelKey: `theme${theme[0]?.toUpperCase()}${theme.slice(1)}`,
      aliasKeys: [theme],
      searchAliases: THEME_SEARCH_ALIASES[theme],
      group: "preferences",
      scopes: ["global"],
      surfaces: ["palette"],
      parentPage: "theme",
      focusPolicy: "restore",
    }),
  ),
  ...(["en", "ko"] as const).map((locale) =>
    action({
      id: `locale.${locale}`,
      labelKey: locale === "en" ? "languageEnglish" : "languageKorean",
      aliasKeys: locale === "en" ? ["english"] : ["korean"],
      searchAliases: LOCALE_SEARCH_ALIASES[locale],
      group: "preferences",
      scopes: ["global"],
      surfaces: ["palette"],
      parentPage: "locale",
      focusPolicy: "handoff",
    }),
  ),
  ...(
    ["backlog", "todo", "in_progress", "in_review", "done", "closed"] as const
  ).map((status) =>
    action({
      id: `status.${status}`,
      labelKey: `status.${status}`,
      aliasKeys: [status],
      searchAliases: STATUS_SEARCH_ALIASES[status],
      group: "issues",
      scopes: ["list", "board", "backlog", "detail"],
      surfaces: ["palette"],
      parentPage: "status",
      focusPolicy: status === "closed" ? "handoff" : "restore",
    }),
  ),
  ...(["critical", "high", "medium", "low", "none"] as const).map((priority) =>
    action({
      id: `priority.${priority}`,
      labelKey: `priority.${priority}`,
      aliasKeys: [priority],
      searchAliases: PRIORITY_SEARCH_ALIASES[priority],
      group: "issues",
      scopes: ["list", "board", "backlog", "detail"],
      surfaces: ["palette"],
      parentPage: "priority",
      focusPolicy: "restore",
    }),
  ),
];

export function getPaletteActions(): ReadonlyArray<AppActionDescriptor> {
  return APP_ACTION_CATALOG.filter((action) =>
    action.surfaces.includes("palette"),
  );
}

export function getShortcutActions(): ReadonlyArray<AppActionDescriptor> {
  return APP_ACTION_CATALOG.filter((action) =>
    action.surfaces.includes("shortcut"),
  );
}

export function getCheatsheetGroups(): ReadonlyArray<{
  group: AppActionGroup;
  actions: ReadonlyArray<AppActionDescriptor>;
}> {
  const order: AppActionGroup[] = ["navigation", "issues", "ai", "misc"];
  return order.flatMap((group) => {
    const actions = APP_ACTION_CATALOG.filter(
      (action) =>
        action.group === group &&
        action.surfaces.includes("cheatsheet") &&
        action.shortcut,
    );
    return actions.length > 0 ? [{ group, actions }] : [];
  });
}

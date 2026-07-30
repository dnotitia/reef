export type AppActionSurface = "palette" | "shortcut" | "cheatsheet";
export type AppActionScope = "global" | "list" | "board" | "detail";
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
export type PaletteFocusPolicy = "restore" | "navigate" | "handoff";

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
  group: AppActionGroup;
  scopes: ReadonlyArray<AppActionScope>;
  surfaces: ReadonlyArray<AppActionSurface>;
  page?: CommandPage;
  parentPage?: CommandPage;
  focusPolicy: PaletteFocusPolicy;
  shortcut?: AppActionShortcut;
}

const action = (descriptor: AppActionDescriptor): AppActionDescriptor =>
  descriptor;

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
    ["navigation.activity", "activity", null],
    ["navigation.suggestions", "suggestions", "s"],
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
      scopes: [scope as AppActionScope, "board"],
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
      group: "issues",
      scopes: ["list", "board", "detail"],
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
      group: "issues",
      scopes: ["list", "board", "detail"],
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

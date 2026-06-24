/** Stable catalog key under `misc.shortcutGroups.*` (locale owns the wording). */
export type ShortcutGroupKey = "navigation" | "issues" | "ai" | "misc";

/** Stable catalog key under `misc.shortcutActions.*` (locale owns the wording). */
export type ShortcutActionKey =
  | "openGlobalSearch"
  | "showKeyboardShortcuts"
  | "newIssue"
  | "toggleAskAi"
  | "closeDialogClearSearch";

export interface Shortcut {
  /** Catalog key for the short, action-style label (resolved at render). */
  labelKey: ShortcutActionKey;
  /** Symbolic key parts in display order. Modifier slots use the magic
   *  strings "mod" (⌘ on macOS, Ctrl elsewhere) and "shift"; literal keys
   *  (e.g. "K") are passed through unchanged. */
  keys: ReadonlyArray<string>;
}

export interface ShortcutGroup {
  /** Catalog key for the group heading (resolved at render). */
  titleKey: ShortcutGroupKey;
  shortcuts: ReadonlyArray<Shortcut>;
}

export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  {
    titleKey: "navigation",
    shortcuts: [
      { labelKey: "openGlobalSearch", keys: ["mod", "K"] },
      { labelKey: "showKeyboardShortcuts", keys: ["mod", "?"] },
    ],
  },
  {
    titleKey: "issues",
    shortcuts: [{ labelKey: "newIssue", keys: ["mod", "N"] }],
  },
  {
    titleKey: "ai",
    shortcuts: [{ labelKey: "toggleAskAi", keys: ["mod", "shift", "A"] }],
  },
  {
    titleKey: "misc",
    shortcuts: [{ labelKey: "closeDialogClearSearch", keys: ["Esc"] }],
  },
];

/**
 * Render-time platform check. SSR-safe: `navigator` exists just on the
 * client, and this util is  invoked inside the dialog (which the
 * shell mounts but doesn't render content for until the user opens it).
 */
export function isMacLike(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as unknown as {
    platform?: string;
    userAgent?: string;
    userAgentData?: { platform?: string };
  };
  const probe = `${nav.userAgentData?.platform ?? ""} ${nav.userAgent ?? ""} ${
    nav.platform ?? ""
  }`;
  return /Mac|iPhone|iPad/i.test(probe);
}

/** Map a `keys` token to the symbol shown in the kbd badge. */
export function formatKey(token: string, mac: boolean): string {
  switch (token) {
    case "mod":
      return mac ? "⌘" : "Ctrl";
    case "shift":
      return mac ? "⇧" : "Shift";
    case "alt":
      return mac ? "⌥" : "Alt";
    case "ctrl":
      return mac ? "⌃" : "Ctrl";
    case "enter":
      return mac ? "⏎" : "Enter";
    default:
      return token;
  }
}

export interface Shortcut {
  /** Short, action-style label ("New issue", "Toggle Ask AI"). */
  label: string;
  /** Symbolic key parts in display order. Modifier slots use the magic
   *  strings "mod" (⌘ on macOS, Ctrl elsewhere) and "shift"; literal keys
   *  (e.g. "K") are passed through unchanged. */
  keys: ReadonlyArray<string>;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: ReadonlyArray<Shortcut>;
}

export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  {
    title: "Navigation",
    shortcuts: [
      { label: "Open global search", keys: ["mod", "K"] },
      { label: "Show keyboard shortcuts", keys: ["mod", "?"] },
    ],
  },
  {
    title: "Issues",
    shortcuts: [{ label: "New issue", keys: ["mod", "N"] }],
  },
  {
    title: "AI",
    shortcuts: [{ label: "Toggle Ask AI", keys: ["mod", "shift", "A"] }],
  },
  {
    title: "Misc",
    shortcuts: [{ label: "Close dialog / clear search", keys: ["Esc"] }],
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

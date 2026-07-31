import {
  type AppActionGroup,
  type AppActionKeySpec,
  type AppActionScope,
  getCheatsheetGroups,
} from "@/features/commands/lib/appActionCatalog";

/** Stable catalog key below `commands.groups.*` (locale owns the wording). */
export type ShortcutGroupKey = AppActionGroup;
export type ShortcutActionKey = string;
export type ShortcutScope = AppActionScope;
export type ShortcutKeySpec = AppActionKeySpec;

export interface Shortcut {
  /** Stable action id shared by every projection. */
  id: string;
  /** Catalog key below `commands.actions.*`. */
  labelKey: ShortcutActionKey;
  /** Symbolic key parts in display order. Modifier slots use the magic
   *  strings "mod" (⌘ on macOS, Ctrl elsewhere) and "shift"; literal keys
   *  (e.g. "K") are passed through unchanged. */
  keys: ReadonlyArray<string>;
  /** Alternate physical bindings for the same action, rendered after a slash. */
  alternateKeys?: ReadonlyArray<ReadonlyArray<string>>;
  /** Browser-specific fallback when the primary chord is reserved by Firefox. */
  firefoxKeys?: ReadonlyArray<string>;
  scope: ShortcutScope;
}

export interface ShortcutGroup {
  /** Catalog key for the group heading (resolved at render). */
  titleKey: ShortcutGroupKey;
  shortcuts: ReadonlyArray<Shortcut>;
}

export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> =
  getCheatsheetGroups().map(({ group, actions }) => ({
    titleKey: group,
    shortcuts: actions.flatMap((descriptor) =>
      descriptor.shortcut
        ? [
            {
              id: descriptor.id,
              labelKey: descriptor.labelKey,
              keys: descriptor.shortcut.keys,
              alternateKeys: descriptor.shortcut.alternateKeys,
              firefoxKeys: descriptor.shortcut.firefoxKeys,
              scope: descriptor.shortcut.scope,
            },
          ]
        : [],
    ),
  }));

export interface ShortcutBinding {
  labelKey: ShortcutActionKey;
  scope: ShortcutScope;
  keys: ReadonlyArray<ShortcutKeySpec>;
  /**
   * Set for the second key in a chord. The dispatcher receives the active
   * prefix from the shell; it stays pure and has no timers.
   */
  chordPrefix?: string;
  allowEditableTarget?: boolean;
  allowInteractiveTarget?: boolean;
  handler: (event: KeyboardEvent) => void;
}

export interface ShortcutDispatchResult {
  handled: boolean;
  binding?: ShortcutBinding;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  for (let el: HTMLElement | null = target; el; el = el.parentElement) {
    if (
      el.isContentEditable ||
      el.contentEditable === "true" ||
      (el.hasAttribute("contenteditable") &&
        el.getAttribute("contenteditable") !== "false")
    ) {
      return true;
    }
  }
  return Boolean(target.closest('input, textarea, select, [role="textbox"]'));
}

export function isInteractiveShortcutTarget(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  for (let el: HTMLElement | null = target; el; el = el.parentElement) {
    if (el.hasAttribute("data-shortcut-surface")) return false;
    if (
      el.matches(
        [
          "button",
          "a[href]",
          "input",
          "select",
          "textarea",
          "summary",
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="combobox"]',
          '[role="menuitem"]',
          '[role="menuitemcheckbox"]',
          '[role="menuitemradio"]',
          '[role="option"]',
          '[role="radio"]',
          '[role="switch"]',
          '[role="tab"]',
          '[role="textbox"]',
        ].join(", "),
      )
    ) {
      return true;
    }
  }
  return false;
}

function normalizedKey(key: string): string {
  if (key === "Esc") return "escape";
  if (key === " ") return "space";
  return key.toLowerCase();
}

export function matchesShortcutKey(
  event: KeyboardEvent,
  spec: ShortcutKeySpec,
): boolean {
  if (spec.primaryModKey) {
    const mac = isMacLike();
    const primaryPressed = mac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
    if (!primaryPressed) return false;
  }
  const wantsMod = spec.modKey ?? false;
  if (wantsMod) {
    const modPressed = event.metaKey || event.ctrlKey;
    if (!modPressed) return false;
  } else if (!spec.primaryModKey && (event.metaKey || event.ctrlKey)) {
    return false;
  }
  if ((spec.shiftKey ?? false) !== event.shiftKey) return false;
  if ((spec.altKey ?? false) !== event.altKey) return false;
  return (
    normalizedKey(event.key) === normalizedKey(spec.key) ||
    (spec.code !== undefined &&
      normalizedKey(event.code) === normalizedKey(spec.code))
  );
}

export function dispatchShortcut(
  event: KeyboardEvent,
  registry: ReadonlyArray<ShortcutBinding>,
  activeScope: ShortcutScope,
  chordPrefix: string | null = null,
): ShortcutDispatchResult {
  if (event.isComposing) return { handled: false };
  if (event.defaultPrevented) return { handled: false };
  const editableTarget = isEditableShortcutTarget(event.target);
  const interactiveTarget = isInteractiveShortcutTarget(event.target);

  for (const binding of registry) {
    if ((binding.chordPrefix ?? null) !== chordPrefix) continue;
    if (binding.scope !== "global" && binding.scope !== activeScope) continue;
    if (!binding.allowEditableTarget && editableTarget) continue;
    if (!binding.allowInteractiveTarget && interactiveTarget) continue;
    if (!binding.keys.some((spec) => matchesShortcutKey(event, spec))) {
      continue;
    }

    event.preventDefault();
    binding.handler(event);
    return { handled: true, binding };
  }

  return { handled: false };
}

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

export function isFirefoxLike(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Firefox\//i.test(navigator.userAgent);
}

export function getShortcutKeys(
  shortcut: Pick<Shortcut, "keys" | "firefoxKeys">,
): ReadonlyArray<string> {
  return isFirefoxLike() && shortcut.firefoxKeys
    ? shortcut.firefoxKeys
    : shortcut.keys;
}

export function getNewIssueShortcutKeys(): ReadonlyArray<string> {
  const newIssue = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts).find(
    (shortcut) => shortcut.id === "issue.new",
  );
  return newIssue ? getShortcutKeys(newIssue) : ["mod", "I"];
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
    case "arrowUp":
      return "↑";
    case "arrowDown":
      return "↓";
    default:
      return token;
  }
}

export function formatShortcut(
  keys: ReadonlyArray<string>,
  mac: boolean,
): string {
  return keys.map((key) => formatKey(key, mac)).join("+");
}

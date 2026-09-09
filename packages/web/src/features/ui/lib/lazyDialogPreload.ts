"use client";

function preload(loader: () => Promise<unknown>): void {
  if (typeof window === "undefined") return;
  void loader().catch(() => undefined);
}

/** Warm a dialog chunk without mounting its component or starting its queries. */
export function preloadNewIssueDialog(): void {
  preload(() => import("@/features/issues/components/create/NewIssueDialog"));
}

export function preloadCreateWorkspaceDialog(): void {
  preload(
    () => import("@/features/onboarding/components/CreateWorkspaceDialog"),
  );
}

export function preloadGlobalSearchDialog(): void {
  preload(() => import("@/features/search/components/GlobalSearchDialog"));
}

export function preloadKeyboardShortcutsDialog(): void {
  preload(
    () => import("@/features/shortcuts/components/KeyboardShortcutsDialog"),
  );
}

export function preloadAskAiDialog(): void {
  preload(() => import("@/features/ai/components/AskAiDialog"));
}

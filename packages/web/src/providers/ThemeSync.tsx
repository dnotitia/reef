"use client";

import { useThemeSync } from "@/features/preferences/hooks/useThemeSync";

/**
 * Root singleton owner for persisted theme hydration and system-theme changes.
 * It deliberately renders no DOM so every route, including framework error
 * boundaries, receives the same synchronization without extra chrome.
 */
export function ThemeSync() {
  useThemeSync();
  return null;
}

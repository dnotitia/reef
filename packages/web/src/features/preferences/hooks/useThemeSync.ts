"use client";

import { useEffect } from "react";
import { applyTheme } from "../lib/theme";
import { useThemeStore } from "../stores/useThemeStore";

/**
 * Singleton theme side-effects: a one-time hydrate from Dexie and the OS
 * `system` color-scheme listener. Call this exactly once, at the consistently-mounted
 * shell.
 *
 * Keeping the effects here (not in `useTheme`) is the point of REEF-095:
 * `useTheme` is a pure store façade with no effects, so adding a theme control
 * somewhere new — the account menu — does not spawns a second hydrate or a
 * duplicate `matchMedia` listener (vercel `client-event-listeners`,
 * `advanced-init-once`).
 */
export function useThemeSync(): void {
  const theme = useThemeStore((state) => state.theme);
  const hydrate = useThemeStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}

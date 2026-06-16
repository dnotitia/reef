import { Monitor, Moon, Sun } from "lucide-react";
import type { ComponentType } from "react";
import type { ThemePreference } from "./theme";

export interface ThemeOption {
  value: ThemePreference;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
}

/**
 * The three theme choices, shared by every control that lets the user pick a
 * theme (Settings Appearance tiles and the account-menu quick toggle), so the
 * label/icon vocabulary stays identical across surfaces. `description` is used
 * by the roomier Settings tiles; the compact menu toggle reads just
 * value/label/Icon.
 */
export const THEME_OPTIONS: ReadonlyArray<ThemeOption> = [
  {
    value: "light",
    label: "Light",
    description: "Always use the light palette.",
    Icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark palette.",
    Icon: Moon,
  },
  {
    value: "system",
    label: "System",
    description: "Follow your operating system's color scheme.",
    Icon: Monitor,
  },
];

/**
 * Motion tokens mirrored from the CSS custom properties in `app/globals.css`
 * (`--ease-signature`, `--duration-base`, `--duration-slow`). JavaScript
 * callers — the auto-animate controller and the flash auto-clear timer — does not
 * cheaply read CSS variables at the call site, so they reference these
 * literals. Keep the two in sync: this is the single JS-side canonical source.
 */
export const EASE_SIGNATURE = "cubic-bezier(0.2, 0, 0, 1)";
export const DURATION_BASE = 150;
export const DURATION_SLOW = 500;

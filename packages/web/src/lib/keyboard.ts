import type { KeyboardEvent } from "react";

/**
 * Preserve a button's normal click semantics when a browser does not synthesize
 * the native keyboard click for a focused control. Preventing the default first
 * keeps Enter/Space to one activation in browsers that do synthesize it.
 */
export function activateButtonOnKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
): void {
  if (event.defaultPrevented || (event.key !== "Enter" && event.key !== " ")) {
    return;
  }

  event.preventDefault();
  event.currentTarget.click();
}

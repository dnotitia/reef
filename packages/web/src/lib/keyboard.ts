import type { KeyboardEvent } from "react";

/** Ensure a focused button activates exactly once for Enter or Space. */
export function activateButtonOnKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
): void {
  if (event.defaultPrevented || (event.key !== "Enter" && event.key !== " ")) {
    return;
  }

  event.preventDefault();
  event.currentTarget.click();
}

/** Ensure a focused link follows its destination when Enter is pressed. */
export function activateLinkOnKeyDown(
  event: KeyboardEvent<HTMLAnchorElement>,
): void {
  if (event.defaultPrevented || event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  event.currentTarget.click();
}

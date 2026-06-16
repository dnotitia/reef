/**
 * Scroll an active option row into view WITHIN its own list container just.
 *
 * `Element.scrollIntoView({ block: "nearest" })` walks up and scrolls EVERY
 * scrollable ancestor to reveal the element. For a dropdown panel that is
 * anchored inside the page flow rather than portaled (our non-portaled
 * `Combobox` / `MultiSelectCombobox`, which sit in a `relative` root so a modal
 * dialog's `pointer-events:none` and a trigger re-click behave), that means the
 * surrounding scroll container — e.g. the issue detail sheet (`overflow-y-auto`)
 * — gets dragged too. When the active row starts below the sheet viewport the
 * sheet scrolls both vertically and horizontally, visibly shifting the whole
 * edit content left/up (REEF-145).
 *
 * This adjusts just `container.scrollTop`, computed from the row/container
 * bounding rects, so the keyboard-active row stays visible inside the list while
 * no ancestor (and no horizontal scroll) is ever touched. Using rect deltas
 * keeps it correct regardless of the option's `offsetParent`.
 *
 * In jsdom every rect is `0`, so both branches are inert — the helper is a safe
 * no-op under test, matching the previous mocked `scrollIntoView`.
 */
export function scrollOptionIntoView(
  container: HTMLElement | null | undefined,
  option: HTMLElement | null | undefined,
): void {
  if (!container || !option) return;
  const containerRect = container.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  if (optionRect.top < containerRect.top) {
    container.scrollTop -= containerRect.top - optionRect.top;
  } else if (optionRect.bottom > containerRect.bottom) {
    container.scrollTop += optionRect.bottom - containerRect.bottom;
  }
}

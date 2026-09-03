import { type Locator, expect } from "@playwright/test";

/**
 * Observe the cursor at a real pointer coordinate and make sure hit testing
 * still lands inside the control under test. A computed style on an element
 * alone is not enough: pointer-events bugs can expose a parent or sibling.
 */
export async function expectCursorAtPointer(
  locator: Locator,
  expected: string,
  point?: { x: number; y: number },
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const observation = await locator.evaluate((element, pointer) => {
    const rect = element.getBoundingClientRect();
    const x = pointer?.x ?? rect.left + rect.width / 2;
    const y = pointer?.y ?? rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      cursor: getComputedStyle(element).cursor,
      hitCursor: hit ? getComputedStyle(hit).cursor : null,
      hitInside: hit === element || (hit ? element.contains(hit) : false),
      hitTag: hit?.tagName.toLowerCase() ?? null,
      className: element.getAttribute("class") ?? "",
      attributes: Array.from(element.attributes).map(
        ({ name, value }) => `${name}=${value}`,
      ),
    };
  }, point);

  expect(
    observation.hitInside,
    `pointer hit ${observation.hitTag ?? "nothing"} outside the tested control`,
  ).toBe(true);
  expect(
    observation.cursor,
    `cursor on ${observation.attributes.join(" ")} (${observation.className})`,
  ).toBe(expected);
  expect(
    observation.hitCursor,
    `hit cursor on ${observation.hitTag ?? "nothing"}`,
  ).toBe(expected);
}

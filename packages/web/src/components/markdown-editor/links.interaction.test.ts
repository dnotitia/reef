// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openClickedEditorLink,
  openEditorLinkOnMouseUp,
  openFocusedEditorLink,
  preventUnavailableEditorLinkBehavior,
} from "./links";

const TARGET = "akb://reef-test/coll/docs/doc/guide.md";

function renderedLink(attributes: {
  href: string;
  resolution: "pending" | "available" | "unavailable";
  disabled?: boolean;
}): { root: HTMLDivElement; anchor: HTMLAnchorElement } {
  const root = document.createElement("div");
  root.innerHTML = `<a href="${attributes.href}" data-markdown-target="${TARGET}" data-markdown-resolution="${attributes.resolution}" ${attributes.disabled ? 'aria-disabled="true"' : ""}>Guide</a>`;
  const anchor = root.querySelector("a");
  if (!anchor) throw new Error("Rendered Markdown link was missing.");
  return { root, anchor };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("shared Markdown target link interactions", () => {
  it.each(["pending", "unavailable"] as const)(
    "does not open a %s target from pointer or keyboard click handling",
    (resolution) => {
      const { root, anchor } = renderedLink({
        href: "#",
        resolution,
        disabled: true,
      });
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      let clickHandled = false;
      anchor.addEventListener("click", (event) => {
        clickHandled = openClickedEditorLink(
          root,
          event,
          new WeakMap(),
          vi.fn(),
        );
      });
      anchor.dispatchEvent(click);

      expect(clickHandled).toBe(true);
      expect(click.defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();

      const mouseUp = new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      let mouseUpHandled = false;
      anchor.addEventListener("mouseup", (event) => {
        mouseUpHandled = openEditorLinkOnMouseUp(
          root,
          event,
          new WeakMap(),
          vi.fn(),
        );
      });
      anchor.dispatchEvent(mouseUp);
      expect(mouseUpHandled).toBe(true);
      expect(mouseUp.defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(anchor.getAttribute("href")).toBe("#");
    },
  );

  it("opens the resolved runtime URL while keeping the canonical target marker", () => {
    const runtimeUrl =
      "https://akb.example/vault/reef-test/doc/docs%2Fguide.md";
    const { root, anchor } = renderedLink({
      href: runtimeUrl,
      resolution: "available",
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    let clickHandled = false;
    anchor.addEventListener("click", (event) => {
      clickHandled = openClickedEditorLink(root, event, new WeakMap(), vi.fn());
    });
    anchor.dispatchEvent(click);

    expect(clickHandled).toBe(true);
    expect(open).toHaveBeenCalledWith(
      runtimeUrl,
      "_blank",
      "noopener,noreferrer",
    );
    expect(anchor.dataset.markdownTarget).toBe(TARGET);
  });

  it("opens a focused resolved link when activated with Enter", () => {
    const runtimeUrl =
      "https://akb.example/vault/reef-test/doc/docs%2Fguide.md";
    const { root, anchor } = renderedLink({
      href: runtimeUrl,
      resolution: "available",
    });
    document.body.append(root);
    anchor.focus();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const keyDown = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    let keyDownHandled = false;
    anchor.addEventListener("keydown", (event) => {
      keyDownHandled = openFocusedEditorLink(root, event, vi.fn());
    });
    anchor.dispatchEvent(keyDown);

    expect(document.activeElement).toBe(anchor);
    expect(keyDownHandled).toBe(true);
    expect(keyDown.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(
      runtimeUrl,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it.each(["pending", "unavailable"] as const)(
    "blocks Enter on a %s target",
    (resolution) => {
      const { root, anchor } = renderedLink({
        href: "#",
        resolution,
        disabled: true,
      });
      document.body.append(root);
      anchor.focus();
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const keyDown = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      let keyDownHandled = false;
      anchor.addEventListener("keydown", (event) => {
        keyDownHandled = openFocusedEditorLink(root, event, vi.fn());
      });
      anchor.dispatchEvent(keyDown);

      expect(keyDownHandled).toBe(true);
      expect(keyDown.defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("blocks auxiliary clicks and the native context menu on disabled targets", () => {
    const { root, anchor } = renderedLink({
      href: "#",
      resolution: "unavailable",
      disabled: true,
    });
    const auxiliaryClick = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    const contextMenu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });

    let auxiliaryClickHandled = false;
    anchor.addEventListener("auxclick", (event) => {
      auxiliaryClickHandled = preventUnavailableEditorLinkBehavior(root, event);
    });
    anchor.dispatchEvent(auxiliaryClick);
    expect(auxiliaryClickHandled).toBe(true);
    expect(auxiliaryClick.defaultPrevented).toBe(true);
    let contextMenuHandled = false;
    anchor.addEventListener("contextmenu", (event) => {
      contextMenuHandled = preventUnavailableEditorLinkBehavior(root, event);
    });
    anchor.dispatchEvent(contextMenu);
    expect(contextMenuHandled).toBe(true);
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(anchor.getAttribute("href")).toBe("#");
  });
});

import {
  MarkdownLocaleProvider,
  MarkdownEditor as SharedMarkdownEditor,
} from "@akb/markdown-editor/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

function renderSharedEditor(onOpenChange = vi.fn()) {
  const onChange = vi.fn();
  const view = render(
    <MarkdownLocaleProvider locale="en">
      <SharedMarkdownEditor
        markdown=""
        onChange={onChange}
        slash={{ onOpenChange }}
        contentAttributes={{ "data-testid": "markdown-editor-content" }}
      />
    </MarkdownLocaleProvider>,
  );
  return {
    content: screen.getByTestId("markdown-editor-content"),
    onChange,
    onOpenChange,
    unmount: view.unmount,
  };
}

beforeEach(() => {
  Object.defineProperty(window, "scrollBy", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => document.activeElement ?? document.body,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [new DOMRect(0, 0, 1, 1)],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 1),
  });
});

describe("shared slash command surface", () => {
  it("opens a categorized listbox at line start and filters without a search input", async () => {
    const user = userEvent.setup();
    const { content, onOpenChange } = renderSharedEditor();

    content.focus();
    await user.keyboard("/");
    const menu = await screen.findByRole("listbox", { name: "Insert block" });
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(10);
    expect(within(menu).getAllByRole("region")).toHaveLength(3);
    expect(menu.querySelector("input")).toBeNull();
    expect(content).toHaveAttribute("aria-expanded", "true");
    expect(onOpenChange).toHaveBeenLastCalledWith(true, expect.any(Function));

    await user.keyboard("table");
    await waitFor(() => {
      expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1);
    });
    expect(
      menu.querySelector(".markdown-slash-command-option"),
    ).toHaveTextContent("Table");
  });

  it("does not open for inline slash text and Escape leaves the trigger text", async () => {
    const user = userEvent.setup();
    const inline = renderSharedEditor();

    inline.content.focus();
    await user.keyboard("inline /");
    expect(
      screen.queryByRole("listbox", { name: "Insert block" }),
    ).not.toBeInTheDocument();

    inline.unmount();
    const { content, onChange } = renderSharedEditor();
    content.focus();
    await user.keyboard("/");
    await screen.findByRole("listbox", { name: "Insert block" });
    fireEvent.keyDown(content, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("listbox", { name: "Insert block" }),
      ).not.toBeInTheDocument();
    });
    expect(onChange).toHaveBeenLastCalledWith("/", expect.anything());
  });

  it("inserts a table for the pointer-selected command and removes the slash query", async () => {
    const user = userEvent.setup();
    const { content, onChange } = renderSharedEditor();
    content.focus();
    await user.keyboard("/");
    await screen.findByRole("listbox", { name: "Insert block" });
    fireEvent.click(screen.getByRole("option", { name: /^Table\b/u }));

    await waitFor(() => {
      expect(
        screen.queryByRole("listbox", { name: "Insert block" }),
      ).not.toBeInTheDocument();
      expect(content.querySelectorAll("table tr")).toHaveLength(3);
    });
    expect(onChange.mock.lastCall?.[0]).not.toContain("/");
  });

  it("wraps keyboard selection and inserts the selected heading on Enter", async () => {
    const user = userEvent.setup();
    const { content, onChange } = renderSharedEditor();
    content.focus();
    await user.keyboard("/");
    const menu = await screen.findByRole("listbox", { name: "Insert block" });
    expect(menu.querySelector('[role="option"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await act(async () => {
      fireEvent.keyDown(content, { key: "ArrowUp" });
      fireEvent.keyDown(content, { key: "ArrowDown" });
      fireEvent.keyDown(content, { key: "Enter" });
    });

    await waitFor(() => {
      expect(content.querySelector("h1")).not.toBeNull();
    });
    expect(onChange.mock.lastCall?.[0]).not.toContain("/");
  });
});

import { EditorContent } from "@tiptap/react";
import { Editor } from "@tiptap/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditorExtensions } from "./MarkdownEditorImpl";
import {
  DEFAULT_SLASH_COMMAND_MESSAGES,
  createLocalizedSlashCommandRegistry,
  filterSlashCommands,
} from "./slashCommandExtension";

const editors: Editor[] = [];

function dispatchKey(editor: Editor, key: string) {
  const event = new KeyboardEvent("keydown", { key });
  const handled = editor.view.someProp("handleKeyDown", (handler) =>
    handler(editor.view, event),
  );
  return handled;
}

function mountEditor(markdown = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: createMarkdownEditorExtensions("Describe the issue..."),
    content: markdown,
    contentType: "markdown",
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  document.body.innerHTML = "";
});

describe("slashCommandExtension", () => {
  it("filters localized labels and Korean/English keywords without a search input", () => {
    const commands = createLocalizedSlashCommandRegistry(
      DEFAULT_SLASH_COMMAND_MESSAGES,
    );

    expect(
      filterSlashCommands(commands, "table").map((item) => item.id),
    ).toEqual(["table"]);
    expect(filterSlashCommands(commands, "표").map((item) => item.id)).toEqual([
      "table",
    ]);
    expect(
      filterSlashCommands(commands, "code").map((item) => item.id),
    ).toEqual(["codeBlock"]);
  });

  it("opens a categorized listbox at line start and narrows sections as the query changes", async () => {
    const editor = mountEditor("");
    await act(async () => {
      editor.commands.insertContent("/");
    });

    const menu = await screen.findByTestId("slash-command-menu");
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(10);
    expect(menu.querySelectorAll("[data-slash-section]")).toHaveLength(3);
    expect(menu.querySelector("input")).toBeNull();
    expect(editor.view.dom.getAttribute("aria-expanded")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-controls")).toBe(menu.id);
    const activeDescendant = editor.view.dom.getAttribute(
      "aria-activedescendant",
    );
    expect(activeDescendant).toBe(menu.querySelector('[role="option"]')?.id);

    await act(async () => {
      editor.commands.insertContent("표");
    });
    await waitFor(() => {
      expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1);
    });
    expect(menu.querySelector('[data-slash-command="table"]')).not.toBeNull();
    expect(menu.querySelectorAll("[data-slash-section]")).toHaveLength(1);
  });

  it("does not open for inline slash text and Escape leaves the trigger intact", async () => {
    const editor = mountEditor("inline /");
    expect(
      document.querySelector('[data-testid="slash-command-menu"]'),
    ).toBeNull();

    const slashEditor = mountEditor("");
    await act(async () => {
      slashEditor.commands.insertContent("/");
    });
    await screen.findByTestId("slash-command-menu");
    fireEvent.keyDown(slashEditor.view.dom, { key: "Escape" });
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="slash-command-menu"]'),
      ).toBeNull();
    });
    expect(slashEditor.getMarkdown()).toContain("/");
  });

  it("executes a pointer-selected table command and removes the slash query", async () => {
    const editor = mountEditor("");
    await act(async () => {
      editor.commands.insertContent("/");
    });
    const menu = await screen.findByTestId("slash-command-menu");
    const table = menu.querySelector<HTMLButtonElement>(
      '[data-slash-command="table"]',
    );
    expect(table).not.toBeNull();
    fireEvent.mouseDown(table as HTMLButtonElement);
    fireEvent.click(table as HTMLButtonElement);

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="slash-command-menu"]'),
      ).toBeNull();
    });
    expect(editor.view.dom.querySelectorAll("table tr")).toHaveLength(3);
    expect(editor.getMarkdown()).not.toContain("/");
    expect(editor.view.dom.querySelector("table")).not.toBeNull();
  });

  it("wraps keyboard selection and inserts the selected heading on Enter", async () => {
    const editor = mountEditor("");
    await act(async () => {
      editor.commands.insertContent("/");
    });
    const menu = await screen.findByTestId("slash-command-menu");
    const first = menu.querySelector<HTMLElement>('[role="option"]');
    expect(first?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      dispatchKey(editor, "ArrowUp");
    });
    expect(
      menu
        .querySelector('[data-slash-command="divider"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    await act(async () => {
      dispatchKey(editor, "ArrowDown");
    });
    expect(
      menu
        .querySelector('[data-slash-command="heading1"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    await act(async () => {
      dispatchKey(editor, "Enter");
    });

    await waitFor(() => {
      expect(editor.view.dom.querySelector("h1")).not.toBeNull();
    });
    expect(editor.getMarkdown()).not.toContain("/");
  });
});

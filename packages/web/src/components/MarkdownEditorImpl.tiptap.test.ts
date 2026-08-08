import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditorExtensions } from "./MarkdownEditorImpl";

const editors: Editor[] = [];

function createEditor(markdown: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: createMarkdownEditorExtensions("Describe the issue..."),
    content: markdown,
    contentType: "markdown",
  });

  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

describe("MarkdownEditor Tiptap extensions", () => {
  it("decorates an empty editor with the placeholder DOM contract", () => {
    const editor = createEditor("");
    const empty = editor.view.dom.querySelector(
      "p.is-empty.is-editor-empty[data-placeholder]",
    );

    expect(empty?.getAttribute("data-placeholder")).toBe(
      "Describe the issue...",
    );
  });

  it("executes list transactions without cross-version Fragment failures", () => {
    const editor = createEditor("First item");

    expect(() => {
      editor.chain().focus("end").toggleBulletList().run();
      editor
        .chain()
        .focus("end")
        .splitListItem("listItem")
        .insertContent("Second item")
        .run();
    }).not.toThrow();
    expect(editor.getMarkdown()).toContain("- First item");
    expect(editor.getMarkdown()).toContain("Second item");
  });

  it("round-trips a link command with the selected text as its display text", () => {
    const marker = "REEF483-LINK-F8Q2";
    const href = "https://example.com/reef483-final-F8Q2";
    const editor = createEditor(marker);

    editor
      .chain()
      .setTextSelection({ from: 1, to: marker.length + 1 })
      .setLink({ href })
      .run();
    const markdown = editor.getMarkdown();
    const reloaded = createEditor(markdown);
    const link = reloaded.view.dom.querySelector(`a[href="${href}"]`);

    expect(markdown).toBe(`[${marker}](${href})`);
    expect(link?.textContent).toBe(marker);
  });

  it("round-trips list, task, link, and image markdown together", () => {
    const markdown = [
      "**Bold text**",
      "- Bullet item",
      "- [ ] Task item",
      "[Selected text](https://example.com/selected)",
      "![reef image](akb://reef-test/issues/file/file-1)",
    ].join("\n\n");
    const serialized = createEditor(markdown).getMarkdown();
    const reloaded = createEditor(serialized);

    expect(serialized).toContain("- Bullet item");
    expect(serialized).toContain("- [ ] Task item");
    expect(serialized).toContain(
      "[Selected text](https://example.com/selected)",
    );
    expect(serialized).toContain(
      "![reef image](akb://reef-test/issues/file/file-1)",
    );
    expect(reloaded.view.dom.querySelector("strong")?.textContent).toBe(
      "Bold text",
    );
    expect(
      reloaded.view.dom.querySelector("ul:not([data-type]) li")?.textContent,
    ).toContain("Bullet item");
    expect(
      reloaded.view.dom.querySelector('ul[data-type="taskList"] input'),
    ).not.toBeNull();
    expect(
      reloaded.view.dom.querySelector('a[href="https://example.com/selected"]')
        ?.textContent,
    ).toBe("Selected text");
    expect(reloaded.view.dom.querySelector("img")?.getAttribute("src")).toBe(
      "akb://reef-test/issues/file/file-1",
    );
  });

  it("preserves markdown links to akb documents", () => {
    const uri = "akb://reef-test/coll/research/doc/report.md";
    const editor = createEditor(`[Research Report](${uri})`);

    expect(editor.getMarkdown()).toContain(`[Research Report](${uri})`);
    const link = editor.view.dom.querySelector("a");
    expect(link?.getAttribute("href")).toBe(uri);
  });

  it.each([
    ["unchecked task", "- [ ] task", "- [ ] task"],
    ["checked task", "- [x] done", "- [x] done"],
    [
      "nested checklist",
      "- [ ] parent\n  - [x] child",
      "- [ ] parent\n  - [x] child",
    ],
    ["mixed lists", "- item\n- [ ] task\n- item2", "- [ ] task"],
  ])(
    "parses %s markdown into a valid ProseMirror document",
    (_name, markdown, serialized) => {
      const editor = createEditor(markdown);

      expect(() => editor.state.doc.check()).not.toThrow();
      expect(editor.getMarkdown()).toContain(serialized);
    },
  );

  it("parses image markdown while preserving the stored akb file URI", () => {
    const editor = createEditor(
      "![screen](akb://reef-test/issues/file/file-1)",
    );

    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe(
      "akb://reef-test/issues/file/file-1",
    );
    expect(editor.getMarkdown()).toContain(
      "![screen](akb://reef-test/issues/file/file-1)",
    );
  });

  // The REEF-161 checklist alignment CSS (globals.css, `.reef-markdown-editor`)
  // can just keep the checkbox and its text on one line if it targets the DOM
  // the live node-view actually produces. Pin that DOM contract here: the <li>
  // carries `data-checked` but NOT `data-type="taskItem"` (that attribute just
  // exists in Tiptap's static renderHTML), so the CSS — and these assertions —
  // should anchor on the `ul[data-type="taskList"]` parent. If a Tiptap upgrade
  // changes this structure, the CSS selectors silently stop matching and the
  // checkbox/text line-break move backwardes; this test fails first.
  describe("live node-view DOM contract for checklist styling", () => {
    it("renders task items the CSS can flex onto one line", () => {
      const editor = createEditor(
        "- [ ] first task\n- [x] second done\n  - [ ] nested child",
      );
      const root = editor.view.dom;

      // The styling anchor: the parent ul is data-typed, the li is not.
      expect(
        root.querySelectorAll('ul[data-type="taskList"]').length,
      ).toBeGreaterThan(0);
      expect(root.querySelectorAll('li[data-type="taskItem"]').length).toBe(0);

      // Every checklist <li> exposes the label(checkbox) + div(content) pair
      // the flex rules lay out side by side.
      const items = root.querySelectorAll('ul[data-type="taskList"] > li');
      expect(items.length).toBe(3);
      for (const li of items) {
        expect(
          li.querySelector(':scope > label > input[type="checkbox"]'),
        ).not.toBeNull();
        expect(li.querySelector(":scope > div")).not.toBeNull();
      }

      // The first paragraph the `> li > div > p` margin reset targets exists.
      expect(
        root.querySelector('ul[data-type="taskList"] > li > div > p'),
      ).not.toBeNull();

      // Nested checklists land under `> li > div > ul[data-type="taskList"]`.
      expect(
        root.querySelector(
          'ul[data-type="taskList"] > li > div > ul[data-type="taskList"]',
        ),
      ).not.toBeNull();
    });
  });
});

import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditorExtensions } from "./MarkdownEditor";

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

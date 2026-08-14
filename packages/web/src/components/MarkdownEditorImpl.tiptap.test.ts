import { Editor } from "@tiptap/react";
import type { VaultMember } from "@reef/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditorExtensions } from "./MarkdownEditorImpl";
import { prepareIssueBodyMentionMarkdown } from "./issueBodyMentionExtension";

const editors: Editor[] = [];

function createEditor(
  markdown: string,
  mentionMembers?: readonly VaultMember[],
) {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: createMarkdownEditorExtensions(
      "Describe the issue...",
      undefined,
      mentionMembers
        ? {
            membersRef: { current: mentionMembers },
            suggestionsLabel: "Mention suggestions",
            mentionOptionLabel: (username) => `Mention @${username}`,
          }
        : undefined,
    ),
    content: mentionMembers
      ? prepareIssueBodyMentionMarkdown(markdown, mentionMembers)
      : markdown,
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
  it("registers issue-body mentions only for the opt-in editor surface", () => {
    const withoutMentions = createMarkdownEditorExtensions(
      "Describe the issue...",
    );
    const withMentions = createMarkdownEditorExtensions(
      "Describe the issue...",
      undefined,
      {
        membersRef: { current: [{ username: "alice", role: "member" }] },
        suggestionsLabel: "Mention suggestions",
        mentionOptionLabel: (username) => `Mention @${username}`,
      },
    );

    expect(
      withoutMentions.some((extension) => extension.name === "mention"),
    ).toBe(false);
    expect(withMentions.some((extension) => extension.name === "mention")).toBe(
      true,
    );
  });

  it("decorates an empty editor with the placeholder DOM contract", () => {
    const editor = createEditor("");
    const empty = editor.view.dom.querySelector(
      "p.is-empty:only-child[data-placeholder]",
    );

    expect(empty?.getAttribute("data-placeholder")).toBe(
      "Describe the issue...",
    );
  });

  it("keeps the placeholder after clearing a non-empty editor and blurring", () => {
    const editor = createEditor("Existing body");
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    editor.view.focus();
    editor.commands.selectAll();
    editor.commands.deleteSelection();

    expect(
      editor.view.dom.querySelector("p.is-empty:only-child[data-placeholder]"),
    ).not.toBeNull();

    outside.focus();

    expect(
      editor.view.dom.querySelector("p.is-empty:only-child[data-placeholder]"),
    ).not.toBeNull();
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

  it("round-trips language fences, nested quote lists, and horizontal rules", () => {
    const markdown = [
      '```ts\nconst intentionallyLongLine = "012345678901234567890123456789";\n```',
      "> First quoted paragraph.\n>\n> Second quoted paragraph.\n>\n> - Nested unordered item\n>   1. Nested ordered child",
      "---",
    ].join("\n\n");
    const editor = createEditor(markdown);

    expect(editor.view.dom.querySelector("pre code")?.className).toContain(
      "language-ts",
    );
    expect(editor.view.dom.querySelector("pre code")?.textContent).toContain(
      "intentionallyLongLine",
    );
    const quote = editor.view.dom.querySelector("blockquote");
    expect(quote?.querySelectorAll(":scope > p")).toHaveLength(2);
    expect(quote?.querySelector(":scope > ul")).not.toBeNull();
    expect(quote?.querySelector(":scope > ul ol")).not.toBeNull();
    expect(editor.view.dom.querySelector(":scope > hr")).not.toBeNull();

    const serialized = editor.getMarkdown();
    expect(serialized).toContain("```ts");
    expect(serialized).toContain("intentionallyLongLine");
    expect(serialized).toContain("First quoted paragraph");
    expect(serialized).toContain("Nested unordered item");
    expect(serialized).toContain("Nested ordered child");
    expect(serialized).toContain("---");

    const reloaded = createEditor(serialized);
    expect(
      Array.from(reloaded.view.dom.children, (element) => element.tagName),
    ).toEqual(["PRE", "BLOCKQUOTE", "HR"]);
    expect(reloaded.view.dom.querySelector("pre code")?.className).toContain(
      "language-ts",
    );
    expect(
      reloaded.view.dom.querySelector("blockquote > ul ol"),
    ).not.toBeNull();
    expect(reloaded.view.dom.querySelector("hr")).not.toBeNull();
  });

  it("preserves markdown links to akb documents", () => {
    const uri = "akb://reef-test/coll/research/doc/report.md";
    const editor = createEditor(`[Research Report](${uri})`);

    expect(editor.getMarkdown()).toContain(`[Research Report](${uri})`);
    const link = editor.view.dom.querySelector("a");
    expect(link?.getAttribute("href")).toBe(uri);
  });

  it("round-trips mixed inline marks, an AKB link, and a resolved mention", () => {
    const uri = "akb://reef-test/coll/research/doc/report.md";
    const markdown =
      "문장 **굵게**, *기울임*, ~~취소선~~, **_~~중첩~~_**, [reef link](https://example.com/reef), [AKB report](" +
      `${uri}), \`inline code\`, and @alice.`;
    const members = [{ username: "alice", role: "member" }] as const;
    const editor = createEditor(markdown, members);

    expect(editor.view.dom.querySelector("strong")?.textContent).toContain(
      "굵게",
    );
    expect(editor.view.dom.querySelector("em")?.textContent).toContain(
      "기울임",
    );
    expect(editor.view.dom.querySelector("s")?.textContent).toContain("취소선");
    expect(
      editor.view.dom.querySelector("strong em s, strong s em, em strong s"),
    ).not.toBeNull();
    expect(editor.view.dom.querySelector("code")?.textContent).toBe(
      "inline code",
    );
    expect(editor.view.dom.querySelector(`a[href="${uri}"]`)?.textContent).toBe(
      "AKB report",
    );
    expect(
      editor.view.dom
        .querySelector('a[href="https://example.com/reef"]')
        ?.getAttribute("tabindex"),
    ).toBe("0");
    expect(
      editor.view.dom
        .querySelector(`a[href="${uri}"]`)
        ?.getAttribute("tabindex"),
    ).toBe("0");
    expect(
      editor.view.dom.querySelector('[data-reef-mention="true"]')?.textContent,
    ).toBe("@alice");
    expect(
      editor.view.dom
        .querySelector('[data-reef-mention="true"]')
        ?.getAttribute("tabindex"),
    ).toBeNull();

    const serialized = editor.getMarkdown();
    expect(serialized).toContain("굵게");
    expect(serialized).toContain("기울임");
    expect(serialized).toContain("취소선");
    expect(serialized).toContain("중첩");
    expect(serialized).toContain(`[AKB report](${uri})`);
    expect(serialized).toContain("`inline code`");
    expect(serialized).toContain("@alice");

    const reloaded = createEditor(serialized, members);
    expect(
      reloaded.view.dom.querySelector(`a[href="${uri}"]`)?.textContent,
    ).toBe("AKB report");
    expect(reloaded.view.dom.querySelector("s")?.textContent).toContain(
      "취소선",
    );
    expect(
      reloaded.view.dom.querySelector('[data-reef-mention="true"]')
        ?.textContent,
    ).toBe("@alice");
  });

  it("round-trips resolved issue-body mentions and keeps unresolved text", () => {
    const markdown =
      "Owner @alice and @{Ada Lovelace}, unresolved @missing, code `@alice`, and link [@alice](https://example.test)";
    const editor = createEditor(markdown, [
      { username: "alice", role: "member" },
      { username: "Ada Lovelace", role: "member" },
    ]);
    const mentionNodes: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "mention") {
        mentionNodes.push(String(node.attrs.id));
      }
    });
    expect(mentionNodes).toEqual(["alice", "Ada Lovelace"]);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(
      editor.view.dom.querySelector('[data-reef-mention="true"]')?.textContent,
    ).toBe("@alice");
    expect(editor.view.dom.textContent).toContain("@missing");
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

  it("round-trips mixed nested list markers and independent task states", () => {
    const markdown = [
      "1. ordered parent",
      "   - unordered child",
      "     1. ordered grandchild",
      "",
      "- [x] parent complete",
      "  - [ ] child open",
      "  - [x] child complete",
    ].join("\n");
    const editor = createEditor(markdown);
    const root = editor.view.dom;

    expect(root.querySelector("ol > li > ul > li")).not.toBeNull();
    expect(root.querySelector("ol > li > ol > li")).not.toBeNull();

    const taskItems = Array.from(
      root.querySelectorAll('ul[data-type="taskList"] > li'),
    );
    expect(taskItems).toHaveLength(3);
    expect(taskItems.map((item) => item.getAttribute("data-checked"))).toEqual([
      "true",
      "false",
      "true",
    ]);
    expect(
      taskItems[0]?.querySelector(":scope > div > p")?.textContent,
    ).toContain("parent complete");
    expect(
      taskItems[1]?.querySelector(":scope > div > p")?.textContent,
    ).toContain("child open");
    expect(
      taskItems[2]?.querySelector(":scope > div > p")?.textContent,
    ).toContain("child complete");

    const serialized = editor.getMarkdown();
    expect(serialized).toContain("ordered parent");
    expect(serialized).toContain("unordered child");
    expect(serialized).toContain("ordered grandchild");
    expect(serialized).toContain("- [x] parent complete");
    expect(serialized).toContain("- [ ] child open");
    expect(serialized).toContain("- [x] child complete");

    const reloaded = createEditor(serialized);
    expect(reloaded.view.dom.querySelector("ol > li > ul > li")).not.toBeNull();
    expect(reloaded.view.dom.querySelector("ol > li > ol > li")).not.toBeNull();
    expect(
      Array.from(
        reloaded.view.dom.querySelectorAll('ul[data-type="taskList"] > li'),
        (item) => item.getAttribute("data-checked"),
      ),
    ).toEqual(["true", "false", "true"]);
  });

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

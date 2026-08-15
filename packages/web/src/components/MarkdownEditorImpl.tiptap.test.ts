import { Editor } from "@tiptap/react";
import type { DocumentSearchHit, IssueListItem, VaultMember } from "@reef/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditorExtensions } from "./MarkdownEditorImpl";
import {
  filterIssueBodyMentionCandidates,
  insertIssueBodyReference,
  prepareIssueBodyMentionMarkdown,
} from "./issueBodyMentionExtension";
import {
  DEFAULT_SLASH_COMMAND_MESSAGES,
  SLASH_COMMAND_DEFINITIONS,
  createLocalizedSlashCommandRegistry,
} from "./slashCommandExtension";

const editors: Editor[] = [];

function createEditor(
  markdown: string,
  mentionMembers?: readonly VaultMember[],
  resolveAttachmentHref?: (href: string) => string,
  mentionIssues: readonly IssueListItem[] = [],
  searchDocuments?: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly DocumentSearchHit[]>,
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
            issuesRef: { current: mentionIssues },
            searchDocuments,
            suggestionsLabel: "Mention suggestions",
            mentionOptionLabel: (username) => `Mention @${username}`,
            peopleSectionLabel: "People",
            issuesSectionLabel: "Issues",
            documentsSectionLabel: "Documents",
            issueOptionLabel: (issue) => `${issue.id}: ${issue.title}`,
            documentOptionLabel: (hit) => `Document: ${hit.title ?? hit.uri}`,
            documentSearchLoadingLabel: "Searching documents…",
            documentSearchErrorLabel: "Couldn't search documents.",
            documentSearchEmptyLabel: "No matching documents.",
          }
        : undefined,
      resolveAttachmentHref,
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
  it("parses and serializes a basic GFM table with a header row", () => {
    const editor = createEditor(
      "| Name | Status |\n| --- | --- |\n| Reef | Ready |\n| AKB | Draft |",
    );

    const table = editor.view.dom.querySelector("table");
    expect(table?.querySelectorAll(":scope > tbody > tr")).toHaveLength(3);
    expect(
      table?.querySelectorAll(":scope > tbody > tr:first-child > th"),
    ).toHaveLength(2);
    expect(
      table?.querySelectorAll(":scope > tbody > tr:nth-child(2) > td"),
    ).toHaveLength(2);
    expect(editor.getMarkdown()).toContain("| Name | Status |");
    expect(editor.getMarkdown()).toMatch(/\| Reef\s+\| Ready\s+\|/);

    const reloaded = createEditor(editor.getMarkdown());
    expect(reloaded.view.dom.querySelectorAll("table tr")).toHaveLength(3);
    expect(
      reloaded.view.dom.querySelector("table tr:nth-child(3)")?.textContent,
    ).toContain("AKB");
  });

  it("inserts the registry table command as a three-row, two-column table", () => {
    const editor = createEditor("/");
    const tableCommand = SLASH_COMMAND_DEFINITIONS.find(
      (command) => command.id === "table",
    );
    expect(tableCommand).toBeDefined();
    tableCommand?.action(editor, { from: 1, to: 2 });

    expect(editor.view.dom.querySelectorAll("table tr")).toHaveLength(3);
    expect(
      editor.view.dom.querySelectorAll("table tr:first-child th"),
    ).toHaveLength(2);
    expect(editor.getMarkdown()).toMatch(/\|\s+\|\s+\|/);
  });

  it("highlights known fences and keeps unknown fences plain", () => {
    const known = createEditor("```ts\nconst answer = 42\n```");
    expect(known.view.dom.querySelector("pre code")?.className).toContain(
      "language-ts",
    );
    expect(
      known.view.dom.querySelector("pre code .hljs-keyword"),
    ).not.toBeNull();

    const unknown = createEditor("```reef-unknown\nconst answer = 42\n```");
    expect(unknown.view.dom.querySelector("pre code")?.className).toContain(
      "language-reef-unknown",
    );
    expect(
      unknown.view.dom.querySelector("pre code [class*='hljs-']"),
    ).toBeNull();
    expect(unknown.getMarkdown()).toContain("```reef-unknown");
  });

  it("keeps the ten-command registry localized without introducing issue lookup", () => {
    const registry = createLocalizedSlashCommandRegistry(
      DEFAULT_SLASH_COMMAND_MESSAGES,
    );
    expect(registry).toHaveLength(10);
    expect(new Set(registry.map((command) => command.category))).toEqual(
      new Set(["text", "lists", "structure"]),
    );
    expect(
      registry.every((command) => command.label && command.description),
    ).toBe(true);
    expect(registry.some((command) => command.keywords.includes("REEF"))).toBe(
      false,
    );
  });

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
        peopleSectionLabel: "People",
        issuesSectionLabel: "Issues",
        documentsSectionLabel: "Documents",
        issueOptionLabel: (issue) => `${issue.id}: ${issue.title}`,
        documentOptionLabel: (hit) => `Document: ${hit.title ?? hit.uri}`,
        documentSearchLoadingLabel: "Searching documents…",
        documentSearchErrorLabel: "Couldn't search documents.",
        documentSearchEmptyLabel: "No matching documents.",
      },
    );

    expect(
      withoutMentions.some((extension) => extension.name === "mention"),
    ).toBe(false);
    expect(withMentions.some((extension) => extension.name === "mention")).toBe(
      true,
    );
  });

  it("keeps people before ranked issues and excludes archived issues", () => {
    const members = [
      { username: "alice", display_name: "Alpha owner", role: "member" },
      { username: "bob", display_name: "Beta owner", role: "member" },
    ] as const;
    const issues = [
      { id: "REEF-009", title: "Alpha follow-up", status: "todo" },
      {
        id: "REEF-010",
        title: "Archived Alpha issue",
        status: "todo",
        archived_at: "2026-06-01T00:00:00.000Z",
      },
    ] as unknown as readonly IssueListItem[];

    expect(
      filterIssueBodyMentionCandidates(members, issues, "alpha").map(
        (candidate) =>
          candidate.kind === "person"
            ? candidate.member.username
            : candidate.kind === "issue"
              ? candidate.issue.id
              : candidate.hit.uri,
      ),
    ).toEqual(["alice", "REEF-009"]);
  });

  it("inserts people, issues, and documents with their canonical Markdown forms", () => {
    const uri = "akb://reef-test/coll/research/doc/alpha.md";
    const editor = createEditor(
      "",
      [{ username: "alice", display_name: "Alpha owner", role: "member" }],
      undefined,
      [
        {
          id: "REEF-009",
          title: "Alpha issue",
          status: "todo",
        } as IssueListItem,
      ],
    );
    insertIssueBodyReference(
      editor,
      { from: 1, to: 1 },
      { kind: "person", member: { username: "alice", role: "member" } },
    );
    insertIssueBodyReference(
      editor,
      {
        from: editor.state.doc.content.size,
        to: editor.state.doc.content.size,
      },
      {
        kind: "issue",
        issue: {
          id: "REEF-009",
          title: "Alpha issue",
          status: "todo",
        } as IssueListItem,
      },
    );
    insertIssueBodyReference(
      editor,
      {
        from: editor.state.doc.content.size,
        to: editor.state.doc.content.size,
      },
      {
        kind: "document",
        hit: {
          uri,
          title: "Alpha document",
          collection: "research",
          doc_type: "document",
        },
      },
    );

    expect(editor.getMarkdown()).toContain("@alice ");
    expect(editor.getMarkdown()).toContain("REEF-009 ");
    expect(editor.getMarkdown()).toContain(`[Alpha document](${uri}) `);
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

  it("marks only explicit AKB file links and keeps their URI out of the proxy href", () => {
    const fileUri = "akb://reef-test/issues/file/incident-log";
    const documentUri = "akb://reef-test/coll/research/doc/report.md";
    const resolve = (uri: string) =>
      `/api/issues/REEF-001/attachments/file?uri=${encodeURIComponent(uri)}&download=1`;
    const editor = createEditor(
      `[incident.log](${fileUri}) [AKB report](${documentUri}) [normal](https://example.com)`,
      undefined,
      resolve,
    );
    const root = editor.view.dom;

    const fileLink = root.querySelector<HTMLAnchorElement>(
      'a[data-reef-file-link="true"]',
    );
    expect(fileLink?.dataset.reefFileUri).toBe(fileUri);
    expect(
      fileLink?.querySelector<HTMLElement>("[data-reef-file-type]")?.dataset
        .reefFileType,
    ).toBe("LOG");
    expect(fileLink?.getAttribute("href")).toBe(resolve(fileUri));
    expect(fileLink?.getAttribute("target")).toBe("_blank");
    expect(fileLink?.getAttribute("rel")).toBe("noreferrer");

    const documentLink = root.querySelector<HTMLAnchorElement>(
      `a[href="${documentUri}"]`,
    );
    expect(documentLink?.dataset.reefFileLink).toBeUndefined();
    expect(
      root.querySelector<HTMLAnchorElement>('a[href="https://example.com"]')
        ?.dataset.reefFileLink,
    ).toBeUndefined();

    expect(fileLink?.getAttribute("href")).toBe(resolve(fileUri));
    expect(editor.getMarkdown()).toContain(`[incident.log](${fileUri})`);
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

  it("round-trips image variants and an explicit file link without changing Source Markdown", () => {
    const markdown = [
      "![small](https://example.com/small.png)",
      "![large](https://example.com/large.png)",
      "![transparent](https://example.com/transparent.png)",
      "![broken](https://example.com/missing.png)",
      "[incident.log](akb://reef-test/issues/file/incident-log)",
    ].join("\n\n");
    const editor = createEditor(markdown);
    expect(editor.view.dom.querySelectorAll("img")).toHaveLength(4);
    expect(editor.view.dom.querySelector('img[alt="broken"]')).not.toBeNull();
    expect(editor.getMarkdown()).toContain(
      "![transparent](https://example.com/transparent.png)",
    );
    expect(editor.getMarkdown()).toContain(
      "![broken](https://example.com/missing.png)",
    );
    expect(editor.getMarkdown()).toContain(
      "[incident.log](akb://reef-test/issues/file/incident-log)",
    );

    const reloaded = createEditor(editor.getMarkdown());
    expect(reloaded.view.dom.querySelectorAll("img")).toHaveLength(4);
    expect(
      reloaded.view.dom.querySelector('a[href*="/file/incident-log"]'),
    ).not.toBeNull();
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

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  parseMarkdown,
  type MarkdownNode,
  type MarkdownTargetResolver,
  type MarkdownTargetResolution,
} from "@akb/markdown-editor";
import {
  MarkdownEditingSurface,
  MarkdownLocaleProvider,
  MarkdownSurface,
  useMarkdownCommands,
  useMarkdownEditor,
} from "@akb/markdown-editor/react";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { MarkdownEditor } from "./MarkdownEditorImpl";

beforeAll(() => {
  const rect = new DOMRect(0, 0, 1, 1);
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [rect] },
    getBoundingClientRect: { configurable: true, value: () => rect },
  });
  Object.defineProperty(window, "scrollBy", {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => vi.restoreAllMocks());

const repeatedImageTarget = "/api/assets/00000000-0000-4000-8000-000000000001";
const independentImageTarget = "akb://reef-e2e/issues/file/incident-log";

function imageSemantics(markdown: string) {
  const images: Array<{ target: string; alt: string }> = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "image") {
      const target = node.attrs?.target;
      const alt = node.attrs?.alt;
      if (typeof target === "string" && typeof alt === "string") {
        images.push({ target, alt });
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of parseMarkdown(markdown, { profile: "preserve" }).content ??
    []) {
    visit(node);
  }
  return images;
}

let surfaceCommands: ReturnType<typeof useMarkdownCommands> | null = null;

function PublicSurfaceHarness({
  markdown,
  onChange,
  onBlur,
  resolutions,
  resolvingTargets,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  onBlur: () => void;
  resolutions?: ReadonlyMap<string, MarkdownTargetResolution>;
  resolvingTargets?: boolean;
}) {
  const editor = useMarkdownEditor({
    initialMarkdown: markdown,
    profile: "preserve",
    onChange: (next) => onChange(next),
  });
  const commands = useMarkdownCommands(editor);
  surfaceCommands = commands;

  return (
    <div
      data-testid="surface-harness"
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (
          !(nextFocus instanceof Node) ||
          !event.currentTarget.contains(nextFocus)
        ) {
          onBlur();
        }
      }}
    >
      <MarkdownEditingSurface
        editor={editor}
        markdown={markdown}
        profile="preserve"
        sourceAriaLabel="Issue description"
        sourcePlaceholder="Source hint"
      >
        <MarkdownSurface
          editor={editor}
          editable
          contentAttributes={{
            "data-testid": "markdown-editor-content",
            "aria-label": "Issue description",
          }}
          resolutions={resolutions}
          resolvingTargets={resolvingTargets}
        />
      </MarkdownEditingSurface>
    </div>
  );
}

describe("Markdown target presentation", () => {
  it("keeps pending and unavailable links disabled and runtime URLs ephemeral", async () => {
    const target = "akb://reef-e2e/coll/docs/doc/guide.md";
    const runtimeUrl = "https://akb.example/vault/reef-e2e/doc/docs%2Fguide.md";
    const markdown = `[Project guide](${target})`;
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const view = render(
      <MarkdownLocaleProvider locale="en">
        <PublicSurfaceHarness
          markdown={markdown}
          onChange={onChange}
          onBlur={onBlur}
          resolutions={new Map()}
          resolvingTargets
        />
      </MarkdownLocaleProvider>,
    );
    const editor = await screen.findByTestId("markdown-editor-content");

    await waitFor(() => {
      expect(editor.querySelector("a[data-markdown-target]")).toHaveAttribute(
        "data-markdown-resolution",
        "pending",
      );
    });
    expect(editor.querySelector("a[data-markdown-target]")).toHaveAttribute(
      "href",
      "#",
    );
    expect(editor.querySelector("a[data-markdown-target]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    view.rerender(
      <MarkdownLocaleProvider locale="en">
        <PublicSurfaceHarness
          markdown={markdown}
          onChange={onChange}
          onBlur={onBlur}
          resolvingTargets
          resolutions={
            new Map<string, MarkdownTargetResolution>([
              [
                target,
                {
                  target,
                  kind: "document",
                  status: "available",
                  runtimeUrl,
                },
              ],
            ])
          }
        />
      </MarkdownLocaleProvider>,
    );
    await waitFor(() => {
      expect(editor.querySelector("a[data-markdown-target]")).toHaveAttribute(
        "data-markdown-resolution",
        "available",
      );
    });
    expect(editor.querySelector("a[data-markdown-target]")).toHaveAttribute(
      "href",
      runtimeUrl,
    );

    view.rerender(
      <MarkdownLocaleProvider locale="en">
        <PublicSurfaceHarness
          markdown={markdown}
          onChange={onChange}
          onBlur={onBlur}
          resolvingTargets
          resolutions={
            new Map<string, MarkdownTargetResolution>([
              [
                target,
                {
                  target,
                  kind: "document",
                  status: "unavailable",
                  reason: "deleted",
                },
              ],
            ])
          }
        />
      </MarkdownLocaleProvider>,
    );
    await waitFor(() => {
      expect(editor.querySelector("a[data-markdown-target]")).toHaveAttribute(
        "data-markdown-resolution",
        "unavailable",
      );
    });
    const unavailableLink = editor.querySelector("a[data-markdown-target]");
    expect(unavailableLink).toHaveAttribute("href", "#");
    expect(unavailableLink).toHaveAttribute("aria-disabled", "true");
    expect(unavailableLink).toHaveAttribute("title");
    expect(onChange).not.toHaveBeenCalled();
    expect(markdown).toBe(`[Project guide](${target})`);
  });

  it("opens available references and blocks unavailable ones in read-only mode", async () => {
    const target = "akb://reef-e2e/coll/docs/doc/guide.md";
    const runtimeUrl = "https://akb.example/vault/reef-e2e/doc/docs%2Fguide.md";
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onChange = vi.fn();
    const accessibleResolver: MarkdownTargetResolver = {
      async resolve(resolvedTarget) {
        return {
          target: resolvedTarget,
          kind: "document",
          status: "available",
          runtimeUrl,
        };
      },
    };
    const view = render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value={`[Project guide](${target})`}
          onChange={onChange}
          readOnly
          vault="reef-e2e"
          adapters={{ targetResolver: accessibleResolver }}
        />
      </IntlTestProvider>,
    );
    const availableLink = await screen.findByRole("link", {
      name: "Project guide",
    });
    await waitFor(() =>
      expect(availableLink).toHaveAttribute(
        "data-markdown-resolution",
        "available",
      ),
    );
    fireEvent.click(availableLink);
    expect(open).toHaveBeenCalledWith(
      runtimeUrl,
      "_blank",
      "noopener,noreferrer",
    );
    expect(onChange).not.toHaveBeenCalled();

    const unavailableResolver: MarkdownTargetResolver = {
      async resolve(resolvedTarget) {
        return {
          target: resolvedTarget,
          kind: "document",
          status: "unavailable",
          reason: "deleted",
        };
      },
    };
    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value={`[Project guide](${target})`}
          onChange={onChange}
          readOnly
          vault="reef-e2e"
          adapters={{ targetResolver: unavailableResolver }}
        />
      </IntlTestProvider>,
    );
    const unavailableLink = await screen.findByRole("link", {
      name: "Project guide",
    });
    await waitFor(() =>
      expect(unavailableLink).toHaveAttribute(
        "data-markdown-resolution",
        "unavailable",
      ),
    );
    open.mockClear();
    fireEvent.click(unavailableLink);
    expect(unavailableLink).toHaveAttribute("href", "#");
    expect(unavailableLink).toHaveAttribute("aria-disabled", "true");
    expect(open).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MarkdownEditor shared Source surface", () => {
  it.each([
    {
      locale: "en" as const,
      editLabel: "Edit image description: Second alt",
      dialogTitle: "Image description",
      fieldLabel: "Description",
      saveLabel: "Save description",
      removePrefix: "Remove image",
      undoLabel: /undo/iu,
    },
    {
      locale: "ko" as const,
      editLabel: "이미지 설명 수정: Second alt",
      dialogTitle: "이미지 설명",
      fieldLabel: "설명",
      saveLabel: "설명 저장",
      removePrefix: "이미지 삭제",
      undoLabel: /실행 취소/iu,
    },
  ])(
    "edits and removes one repeated image occurrence with $locale labels and undo",
    async ({
      locale,
      editLabel,
      dialogTitle,
      fieldLabel,
      saveLabel,
      removePrefix,
      undoLabel,
    }) => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      const original = [
        `![First alt](${repeatedImageTarget})`,
        `![Second alt](${repeatedImageTarget})`,
        `![Independent alt](${independentImageTarget})`,
      ].join("\n\n");
      render(
        <IntlTestProvider locale={locale}>
          <MarkdownEditor
            value={original}
            onChange={onChange}
            onBlur={onBlur}
            vault="reef-e2e"
            ariaLabel="Issue description"
          />
        </IntlTestProvider>,
      );

      const editor = await screen.findByTestId("markdown-editor-content");
      await waitFor(() =>
        expect(
          editor.querySelectorAll("img[data-markdown-target]"),
        ).toHaveLength(3),
      );
      act(() => editor.focus());
      fireEvent.click(await screen.findByRole("button", { name: editLabel }));

      const dialog = await screen.findByRole("dialog", { name: dialogTitle });
      const description = within(dialog).getByRole("textbox", {
        name: fieldLabel,
      });
      fireEvent.change(description, { target: { value: "Second changed" } });
      fireEvent.click(within(dialog).getByRole("button", { name: saveLabel }));

      await waitFor(() =>
        expect(
          editor.querySelector('img[alt="Second changed"]'),
        ).not.toBeNull(),
      );
      expect(editor.querySelector('img[alt="First alt"]')).not.toBeNull();
      expect(editor.querySelector('img[alt="Independent alt"]')).not.toBeNull();
      expect(imageSemantics(onChange.mock.lastCall?.[0] ?? "")).toEqual([
        { target: repeatedImageTarget, alt: "First alt" },
        { target: repeatedImageTarget, alt: "Second changed" },
        { target: independentImageTarget, alt: "Independent alt" },
      ]);
      await waitFor(() => expect(editor).toHaveFocus());

      fireEvent.click(
        screen.getByRole("button", { name: `${removePrefix}: First alt` }),
      );
      await waitFor(() =>
        expect(editor.querySelector('img[alt="First alt"]')).toBeNull(),
      );
      expect(editor.querySelectorAll("img[data-markdown-target]")).toHaveLength(
        2,
      );
      expect(editor.querySelector('img[alt="Second changed"]')).not.toBeNull();
      expect(editor.querySelector('img[alt="Independent alt"]')).not.toBeNull();
      expect(imageSemantics(onChange.mock.lastCall?.[0] ?? "")).toEqual([
        { target: repeatedImageTarget, alt: "Second changed" },
        { target: independentImageTarget, alt: "Independent alt" },
      ]);

      fireEvent.click(screen.getByRole("button", { name: undoLabel }));
      await waitFor(() =>
        expect(editor.querySelector('img[alt="First alt"]')).not.toBeNull(),
      );
      expect(editor.querySelectorAll("img[data-markdown-target]")).toHaveLength(
        3,
      );
      expect(imageSemantics(onChange.mock.lastCall?.[0] ?? "")).toEqual([
        { target: repeatedImageTarget, alt: "First alt" },
        { target: repeatedImageTarget, alt: "Second changed" },
        { target: independentImageTarget, alt: "Independent alt" },
      ]);
      expect(onBlur).toHaveBeenCalled();
    },
  );

  it("keeps invalid and cancelled image descriptions unchanged and restores focus", async () => {
    const onChange = vi.fn();
    const original = `![First alt](${repeatedImageTarget})`;
    render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value={original}
          onChange={onChange}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const editor = await screen.findByTestId("markdown-editor-content");
    act(() => editor.focus());
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit image description: First alt",
      }),
    );
    let dialog = await screen.findByRole("dialog", {
      name: "Image description",
    });
    let description = within(dialog).getByRole("textbox", {
      name: "Description",
    });
    fireEvent.change(description, { target: { value: "   " } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save description" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Describe the image so it remains understandable without sight.",
    );
    expect(editor.querySelector('img[alt="First alt"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(editor).toHaveFocus());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit image description: First alt",
      }),
    );
    dialog = await screen.findByRole("dialog", { name: "Image description" });
    description = within(dialog).getByRole("textbox", {
      name: "Description",
    });
    fireEvent.change(description, {
      target: { value: "Cancelled description" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(editor.querySelector('img[alt="First alt"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("does not offer image actions on a read-only Markdown surface", async () => {
    render(
      <IntlTestProvider locale="ko">
        <MarkdownEditor
          value={`![First alt](${repeatedImageTarget})`}
          onChange={vi.fn()}
          readOnly
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    await screen.findByTestId("markdown-editor-content");
    expect(
      screen.queryByRole("button", { name: "이미지 설명 수정: First alt" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "이미지 삭제: First alt" }),
    ).not.toBeInTheDocument();
  });

  it("delegates mode changes and the same draft to MarkdownEditingSurface", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const props = {
      value: "# Original",
      onChange,
      onBlur,
      placeholder: "WYSIWYG hint",
      sourcePlaceholder: "Source hint",
      ariaLabel: "Issue description",
    };
    const view = render(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} />
      </IntlTestProvider>,
    );

    const editor = screen.getByTestId("markdown-editor");
    const surface = editor.querySelector("[data-markdown-mode]");
    expect(surface).toHaveAttribute("data-markdown-mode", "wysiwyg");
    expect(onChange).not.toHaveBeenCalled();

    const toggle = screen.getByTitle("Toggle source mode");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(surface).toHaveAttribute("data-markdown-mode", "source"),
    );
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(surface).toHaveAttribute("data-markdown-mode", "wysiwyg"),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();

    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} />
      </IntlTestProvider>,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(surface).toHaveAttribute("data-markdown-mode", "source"),
    );

    const source = within(editor).getByRole("textbox", {
      name: "Issue description",
    });
    expect(source).toHaveValue("# Original");
    expect(source).toHaveAttribute("placeholder", "Source hint");
    expect(
      screen.queryByRole("button", { name: "Bold" }),
    ).not.toBeInTheDocument();

    fireEvent.change(source, {
      target: { value: "# Edited\n\nSource body" },
    });
    expect(onChange).toHaveBeenLastCalledWith("# Edited\n\nSource body");

    fireEvent.click(screen.getByTitle("Toggle source mode"));
    await waitFor(() =>
      expect(surface).toHaveAttribute("data-markdown-mode", "wysiwyg"),
    );
    const content = screen.getByTestId("markdown-editor-content");
    await waitFor(() => expect(content).toHaveFocus());
    expect(content).toHaveTextContent("Source body");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onBlur).not.toHaveBeenCalled();
  });

  it("preserves WYSIWYG selection, undo, and callbacks on unchanged rerenders and Source round trips", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const markdown = "# Title\n\nThe original body.";
    const props = { markdown, onChange, onBlur };
    surfaceCommands = null;
    const view = render(
      <MarkdownLocaleProvider locale="en">
        <PublicSurfaceHarness {...props} />
      </MarkdownLocaleProvider>,
    );
    const editor = await screen.findByTestId("markdown-editor-content");
    await waitFor(() => expect(surfaceCommands).not.toBeNull());

    act(() => {
      if (!surfaceCommands?.focus("all")) {
        throw new Error("Editor did not select its content.");
      }
    });
    await waitFor(() =>
      expect(window.getSelection()?.toString()).toContain("Title"),
    );
    const selectionBefore = window.getSelection()?.toString();
    expect(selectionBefore).toContain("body.");
    act(() => {
      if (!surfaceCommands?.toggleBold()) {
        throw new Error("Editor did not apply its bold command.");
      }
    });
    await waitFor(() =>
      expect(editor.querySelectorAll("strong").length).toBeGreaterThan(0),
    );
    const changeCount = onChange.mock.calls.length;
    expect(changeCount).toBeGreaterThan(0);

    view.rerender(
      <MarkdownLocaleProvider locale="en">
        <PublicSurfaceHarness {...props} />
      </MarkdownLocaleProvider>,
    );
    expect(window.getSelection()?.toString()).toBe(selectionBefore);
    expect(editor.querySelectorAll("strong").length).toBeGreaterThan(0);
    expect(onChange).toHaveBeenCalledTimes(changeCount);
    expect(onBlur).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    await waitFor(() =>
      expect(editor.closest("[data-markdown-mode]")).toHaveAttribute(
        "data-markdown-mode",
        "source",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "WYSIWYG" }));
    await waitFor(() =>
      expect(editor.closest("[data-markdown-mode]")).toHaveAttribute(
        "data-markdown-mode",
        "wysiwyg",
      ),
    );

    await waitFor(() =>
      expect(window.getSelection()?.toString()).toBe(selectionBefore),
    );
    expect(onChange).toHaveBeenCalledTimes(changeCount);
    expect(onBlur).not.toHaveBeenCalled();

    act(() => {
      if (!surfaceCommands?.undo()) throw new Error("Editor undo was empty.");
    });
    await waitFor(() => expect(editor.querySelector("strong")).toBeNull());
    expect(onChange).toHaveBeenCalledTimes(changeCount + 1);
    expect(onBlur).not.toHaveBeenCalled();
  });

  it("applies external values and read-only changes in both modes", async () => {
    const onChange = vi.fn();
    const props = {
      value: "Initial body",
      onChange,
      ariaLabel: "Issue description",
    };
    const view = render(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} />
      </IntlTestProvider>,
    );
    const editor = screen.getByTestId("markdown-editor-content");

    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} value="External WYSIWYG body" />
      </IntlTestProvider>,
    );
    await waitFor(() =>
      expect(editor).toHaveTextContent("External WYSIWYG body"),
    );

    const toggle = screen.getByTitle("Toggle source mode");
    fireEvent.click(toggle);
    const source = await screen.findByRole("textbox", {
      name: "Issue description",
    });
    expect(source).toHaveValue("External WYSIWYG body");

    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} value="External Source body" />
      </IntlTestProvider>,
    );
    await waitFor(() => expect(source).toHaveValue("External Source body"));

    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} value="External Source body" readOnly />
      </IntlTestProvider>,
    );
    expect(source).toHaveProperty("readOnly", true);
    expect(screen.queryByTitle("Toggle source mode")).not.toBeInTheDocument();

    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} value="External Source body" />
      </IntlTestProvider>,
    );
    fireEvent.click(screen.getByTitle("Toggle source mode"));
    await waitFor(() =>
      expect(editor.closest("[data-markdown-mode]")).toHaveAttribute(
        "data-markdown-mode",
        "wysiwyg",
      ),
    );

    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} value="External Source body" readOnly />
      </IntlTestProvider>,
    );
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(screen.queryByTestId("markdown-toolbar")).not.toBeInTheDocument();

    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} value="External read-only body" readOnly />
      </IntlTestProvider>,
    );
    await waitFor(() =>
      expect(editor).toHaveTextContent("External read-only body"),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a dirty Source draft when an external value arrives before applying", async () => {
    const onChange = vi.fn();
    const props = {
      value: "Initial body",
      onChange,
      ariaLabel: "Issue description",
    };
    const view = render(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} />
      </IntlTestProvider>,
    );
    const toggle = screen.getByTitle("Toggle source mode");
    fireEvent.click(toggle);
    const source = await screen.findByRole("textbox", {
      name: "Issue description",
    });
    fireEvent.change(source, { target: { value: "Local source draft" } });
    expect(onChange).toHaveBeenLastCalledWith("Local source draft");

    view.rerender(
      <IntlTestProvider locale="en">
        <MarkdownEditor {...props} value="External server body" />
      </IntlTestProvider>,
    );
    expect(source).toHaveValue("Local source draft");

    fireEvent.click(screen.getByTitle("Toggle source mode"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("markdown-editor-content")
          .closest("[data-markdown-mode]"),
      ).toHaveAttribute("data-markdown-mode", "wysiwyg"),
    );
    const editor = screen.getByTestId("markdown-editor-content");
    await waitFor(() => expect(editor).toHaveTextContent("Local source draft"));
    expect(editor).not.toHaveTextContent("External server body");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps a Source draft while pasting an attachment into the shared surface", async () => {
    const onChange = vi.fn();
    const onUploadFiles = vi.fn().mockResolvedValue({
      items: [
        {
          status: "success" as const,
          file: new Blob(["brief"]),
          asset: {
            kind: "attachment" as const,
            target: "/api/assets/00000000-0000-4000-8000-000000000001",
            alt: "brief.png",
          },
        },
      ],
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      partial: false,
    });
    render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value="Existing body"
          onChange={onChange}
          onUploadFiles={onUploadFiles}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    fireEvent.click(screen.getByTitle("Toggle source mode"));
    const source = screen.getByRole("textbox", { name: "Issue description" });
    fireEvent.change(source, { target: { value: "Source draft" } });
    const file = new File(["x"], "brief.pdf", { type: "application/pdf" });
    fireEvent.paste(source, { clipboardData: { files: [file] } });

    const expected =
      "Source draft\n\n![brief.png](/api/assets/00000000-0000-4000-8000-000000000001)";
    await waitFor(() => expect(source).toHaveValue(expected));
    expect(onUploadFiles).toHaveBeenCalledWith([file]);
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });
});

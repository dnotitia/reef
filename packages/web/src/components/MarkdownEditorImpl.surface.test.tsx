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
  type MarkdownAsset,
  type MarkdownNode,
  type MarkdownUploadAdapter,
  type MarkdownUploadContext,
  type MarkdownTargetResolution,
  type MarkdownTargetResolver,
  type MarkdownTargetResolverContext,
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
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => null,
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
  it("keeps the canonical escaped image alt, title, and target in the public preserve surface", async () => {
    const markdown = String.raw`![screen\\shot-猫](${repeatedImageTarget} "Build evidence")`;
    const onChange = vi.fn();
    render(
      <MarkdownLocaleProvider locale="en">
        <PublicSurfaceHarness
          markdown={markdown}
          onChange={onChange}
          onBlur={vi.fn()}
        />
      </MarkdownLocaleProvider>,
    );

    const content = await screen.findByTestId("markdown-editor-content");
    await waitFor(() => expect(content.querySelector("img")).not.toBeNull());
    const image = content.querySelector("img");
    expect(image).toHaveAttribute("alt", String.raw`screen\shot-猫`);
    expect(image).toHaveAttribute("title", "Build evidence");
    expect(image).toHaveAttribute("data-markdown-target", repeatedImageTarget);
    expect(image).toHaveAttribute("src", repeatedImageTarget);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aborts stale image resolution, releases late results, and releases the active result on unmount", async () => {
    const markdown = `![Evidence](${repeatedImageTarget})`;
    const oldRelease = vi.fn();
    const activeRelease = vi.fn();
    let oldSignal: AbortSignal | undefined;
    let resolveOld: ((value: MarkdownTargetResolution) => void) | undefined;
    let resolveActive: ((value: MarkdownTargetResolution) => void) | undefined;
    const resolver: MarkdownTargetResolver = {
      resolve: vi.fn(
        (_target: string, context?: MarkdownTargetResolverContext) =>
          new Promise<MarkdownTargetResolution>((resolve) => {
            if (context?.commit === "commit-1") {
              oldSignal = context.signal;
              resolveOld = resolve;
              return;
            }
            resolveActive = resolve;
          }),
      ),
    };
    const onChange = vi.fn();
    const renderEditor = (commit: string) => (
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value={markdown}
          onChange={onChange}
          vault="reef-test"
          resolverContext={{
            vault: "reef-test",
            document: "akb://reef-test/coll/issues/doc/reef-001.md",
            commit,
          }}
          adapters={{ targetResolver: resolver }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>
    );
    const view = render(renderEditor("commit-1"));

    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    expect(resolver.resolve).toHaveBeenCalledWith(
      repeatedImageTarget,
      expect.objectContaining({
        vault: "reef-test",
        document: "akb://reef-test/coll/issues/doc/reef-001.md",
        commit: "commit-1",
      }),
    );

    view.rerender(renderEditor("commit-2"));
    await waitFor(() => expect(resolveActive).toBeTypeOf("function"));
    expect(oldSignal?.aborted).toBe(true);

    act(() => {
      resolveOld?.({
        target: repeatedImageTarget,
        status: "available",
        runtimeUrl: "/stale-image.png",
        release: oldRelease,
      });
    });
    await waitFor(() => expect(oldRelease).toHaveBeenCalledOnce());

    act(() => {
      resolveActive?.({
        target: repeatedImageTarget,
        status: "available",
        runtimeUrl: "/current-image.png",
        release: activeRelease,
      });
    });
    const content = await screen.findByTestId("markdown-editor-content");
    await waitFor(() =>
      expect(content.querySelector("img")).toHaveAttribute(
        "src",
        "/current-image.png",
      ),
    );
    expect(content.querySelector("img")).not.toHaveAttribute(
      "src",
      "/stale-image.png",
    );
    expect(onChange).not.toHaveBeenCalled();

    view.unmount();
    expect(activeRelease).toHaveBeenCalledOnce();
  });

  it("keeps inaccessible images labeled by alt text without exposing their target", async () => {
    const markdown = `![Private evidence](${repeatedImageTarget} "Build note")`;
    const resolver: MarkdownTargetResolver = {
      resolve: vi.fn(
        async (target: string): Promise<MarkdownTargetResolution> => ({
          target,
          status: "unavailable",
          reason: "inaccessible",
        }),
      ),
    };
    const onChange = vi.fn();
    render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value={markdown}
          onChange={onChange}
          vault="reef-test"
          adapters={{ targetResolver: resolver }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const content = await screen.findByTestId("markdown-editor-content");
    const frame = await waitFor(() => {
      const imageFrame = content.querySelector<HTMLElement>(
        "[data-markdown-image-frame]",
      );
      expect(imageFrame).not.toBeNull();
      expect(imageFrame).toHaveAttribute(
        "data-markdown-image-state",
        "unavailable",
      );
      return imageFrame as HTMLElement;
    });
    const image = content.querySelector("img");

    expect(frame).toHaveAttribute("role", "img");
    expect(frame.getAttribute("aria-label")).toContain("Private evidence");
    expect(frame.getAttribute("aria-label")).not.toContain(repeatedImageTarget);
    expect(image).toHaveAttribute("alt", "Private evidence");
    expect(image).toHaveAttribute("title", "Build note");
    expect(image).toHaveAttribute("data-markdown-target", repeatedImageTarget);
    expect(image).not.toHaveAttribute("src");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the target and accessible explanation after image decode failure", async () => {
    const markdown = `![Decode evidence](${repeatedImageTarget} "Decode note")`;
    const refresh = vi.fn(
      async (): Promise<MarkdownTargetResolution> => ({
        target: repeatedImageTarget,
        status: "unavailable",
        reason: "inaccessible",
      }),
    );
    const resolver: MarkdownTargetResolver = {
      resolve: vi.fn(
        async (target: string): Promise<MarkdownTargetResolution> => ({
          target,
          status: "available",
          runtimeUrl: "/bad-image.png",
          refresh,
        }),
      ),
    };
    const onChange = vi.fn();
    render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value={markdown}
          onChange={onChange}
          vault="reef-test"
          adapters={{ targetResolver: resolver }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const content = await screen.findByTestId("markdown-editor-content");
    const image = await waitFor(() => {
      const renderedImage = content.querySelector("img");
      expect(renderedImage).toHaveAttribute("src", "/bad-image.png");
      return renderedImage as HTMLImageElement;
    });
    fireEvent.error(image);

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const frame = content.querySelector<HTMLElement>(
      "[data-markdown-image-frame]",
    );
    await waitFor(() =>
      expect(frame).toHaveAttribute("data-markdown-image-state", "decode"),
    );

    expect(frame).toHaveAttribute("role", "img");
    expect(frame?.getAttribute("aria-label")).toContain("Decode evidence");
    expect(frame?.getAttribute("aria-label")).not.toContain(
      repeatedImageTarget,
    );
    expect(image).toHaveAttribute("alt", "Decode evidence");
    expect(image).toHaveAttribute("title", "Decode note");
    expect(image).toHaveAttribute("data-markdown-target", repeatedImageTarget);
    expect(image).not.toHaveAttribute("src");
    expect(onChange).not.toHaveBeenCalled();
  });

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

  it("keeps generic attachment uploads separate from image insertion", async () => {
    const onChange = vi.fn();
    const onUploadFiles = vi.fn().mockResolvedValue({
      items: [],
      succeeded: 0,
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
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    fireEvent.paste(source, { clipboardData: { files: [file] } });

    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledWith([file]));
    expect(source).toHaveValue("Source draft");
    expect(onChange).toHaveBeenLastCalledWith("Source draft");
  });

  it("routes standalone image paste through the public image upload surface", async () => {
    const onChange = vi.fn();
    const onAssetUploaded = vi.fn();
    let uploadContext: MarkdownUploadContext | undefined;
    const asset: MarkdownAsset = {
      id: "asset-1",
      kind: "attachment",
      target: "/api/assets/00000000-0000-4000-8000-000000000001",
      alt: "diagram.png",
    };
    const upload = vi.fn(
      async (_file: Blob, context?: MarkdownUploadContext) => {
        uploadContext = context;
        return asset;
      },
    );
    const adapter: MarkdownUploadAdapter = { upload };

    render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value="Alpha\n\nOmega"
          onChange={onChange}
          imageUpload={{
            adapter,
            context: {
              vault: "reef-e2e",
              document: "akb://reef-e2e/coll/issues/doc/reef-001.md",
              commit: "commit-1",
              draftId: "REEF-001",
            },
            onAssetUploaded,
          }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const editor = await screen.findByTestId("markdown-editor-content");
    const file = new File(["png"], "diagram.png", { type: "image/png" });
    fireEvent.paste(editor, {
      clipboardData: { files: [file], getData: () => "" },
    });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onChange.mock.lastCall?.[0]).toContain(
        `![diagram.png](${asset.target})`,
      ),
    );
    expect(uploadContext).toMatchObject({
      vault: "reef-e2e",
      document: "akb://reef-e2e/coll/issues/doc/reef-001.md",
      commit: "commit-1",
      draftId: "REEF-001",
    });
    expect(uploadContext?.signal).toBeInstanceOf(AbortSignal);
    expect(onAssetUploaded).toHaveBeenCalledWith(asset, file);
    expect(screen.getByRole("button", { name: "Insert image" })).toBeVisible();
  });

  it("routes selected images through image upload and non-images through attachment upload", async () => {
    const imageAsset: MarkdownAsset = {
      kind: "attachment",
      target: "/api/assets/00000000-0000-4000-8000-000000000021",
      alt: "diagram.png",
    };
    const uploadImage = vi.fn().mockResolvedValue(imageAsset);
    const uploadAttachments = vi.fn().mockResolvedValue({
      items: [],
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      partial: false,
    });
    render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value="Existing body"
          onChange={vi.fn()}
          onUploadFiles={uploadAttachments}
          imageUpload={{
            adapter: { upload: uploadImage },
            context: { vault: "reef-e2e" },
          }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    fireEvent.change(screen.getByTestId("markdown-attachment-input"), {
      target: {
        files: [
          new File(["png"], "diagram.png", { type: "image/png" }),
          new File(["notes"], "notes.txt", { type: "text/plain" }),
        ],
      },
    });

    await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(uploadAttachments).toHaveBeenCalledWith([
        expect.objectContaining({ name: "notes.txt" }),
      ]),
    );
    expect(uploadImage.mock.calls[0]?.[0]).toMatchObject({
      name: "diagram.png",
      type: "image/png",
    });
    expect(uploadAttachments.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("applies a dirty Source draft before uploading a selected image", async () => {
    const target = "/api/assets/00000000-0000-4000-8000-000000000099";
    const imageAsset: MarkdownAsset = {
      kind: "attachment",
      target,
      alt: "diagram.png",
    };
    let resolveUpload: ((asset: MarkdownAsset) => void) | undefined;
    const uploadImage = vi.fn(
      () =>
        new Promise<MarkdownAsset>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const uploadAttachments = vi.fn().mockResolvedValue({
      items: [],
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      partial: false,
    });
    const onChange = vi.fn();
    const { container } = render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value="Existing body"
          onChange={onChange}
          onUploadFiles={uploadAttachments}
          imageUpload={{
            adapter: { upload: uploadImage },
            context: { vault: "reef-e2e" },
          }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    fireEvent.click(screen.getByTitle("Toggle source mode"));
    const source = await screen.findByRole("textbox", {
      name: "Issue description",
    });
    fireEvent.change(source, {
      target: { value: "Existing body\n\nSource draft" },
    });

    fireEvent.change(screen.getByTestId("markdown-attachment-input"), {
      target: {
        files: [
          new File(["png"], "diagram.png", { type: "image/png" }),
          new File(["notes"], "notes.txt", { type: "text/plain" }),
        ],
      },
    });

    await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce());
    expect(container.querySelector("[data-markdown-mode]")).toHaveAttribute(
      "data-markdown-mode",
      "wysiwyg",
    );
    expect(
      container.querySelector("[data-markdown-image-upload-status]"),
    ).toBeVisible();
    expect(screen.getByTestId("markdown-editor-content")).toHaveTextContent(
      "Source draft",
    );
    expect(uploadAttachments).toHaveBeenCalledOnce();

    await act(async () => {
      resolveUpload?.(imageAsset);
    });

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("Source draft");
      expect(onChange.mock.lastCall?.[0]).toContain(
        `![diagram.png](${target})`,
      );
    });
  });

  it("routes WYSIWYG image drops through the public image upload surface", async () => {
    const target = "/api/assets/00000000-0000-4000-8000-000000000031";
    const upload = vi.fn().mockResolvedValue({
      kind: "attachment",
      target,
      alt: "dropped.png",
    } satisfies MarkdownAsset);
    const onChange = vi.fn();
    render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value="Existing body"
          onChange={onChange}
          imageUpload={{
            adapter: { upload },
            context: { vault: "reef-e2e" },
          }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const editor = await screen.findByTestId("markdown-editor-content");
    const file = new File(["png"], "dropped.png", { type: "image/png" });
    fireEvent.drop(editor, {
      dataTransfer: { files: [file], items: [] },
      clientX: 4,
      clientY: 4,
    });

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(onChange.mock.lastCall?.[0]).toContain(
        `![dropped.png](${target})`,
      ),
    );
    expect(upload.mock.calls[0]?.[0]).toBe(file);
  });

  it("replaces an existing image through the shared upload controller", async () => {
    const replacement: MarkdownAsset = {
      kind: "attachment",
      target: "/api/assets/00000000-0000-4000-8000-000000000032",
      alt: "replacement.png",
    };
    const upload = vi.fn().mockResolvedValue(replacement);
    const onAssetReplaced = vi.fn();
    const onAssetUploaded = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value={`![Existing image](${repeatedImageTarget})`}
          onChange={onChange}
          imageUpload={{
            adapter: { upload },
            context: { vault: "reef-e2e", draftId: "REEF-001" },
            onAssetReplaced,
            onAssetUploaded,
          }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const editor = await screen.findByTestId("markdown-editor-content");
    await waitFor(() => expect(editor.querySelector("img")).not.toBeNull());
    act(() => editor.focus());
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Replace image: Existing image",
      }),
    );

    const picker = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept="image/*"]',
    );
    expect(picker).not.toBeNull();
    expect(picker).not.toHaveProperty("multiple", true);
    const file = new File(["replacement"], "replacement.png", {
      type: "image/png",
    });
    fireEvent.change(picker as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(onChange.mock.lastCall?.[0]).toContain(
        `![replacement.png](${replacement.target})`,
      ),
    );
    expect(upload.mock.calls[0]?.[1]).toMatchObject({
      vault: "reef-e2e",
      draftId: "REEF-001",
      target: repeatedImageTarget,
    });
    expect(onAssetUploaded).toHaveBeenCalledWith(replacement, file);
    expect(onAssetReplaced).toHaveBeenCalledWith(
      repeatedImageTarget,
      replacement,
      file,
    );
  });

  it("keeps successful images and retries only failed files through the shared UI", async () => {
    const onChange = vi.fn();
    const firstAsset: MarkdownAsset = {
      kind: "attachment",
      target: "/api/assets/00000000-0000-4000-8000-000000000011",
      alt: "first.png",
    };
    const secondAsset: MarkdownAsset = {
      kind: "attachment",
      target: "/api/assets/00000000-0000-4000-8000-000000000012",
      alt: "second.png",
    };
    const retryable = Object.assign(new Error("temporary failure"), {
      code: "unavailable" as const,
      retryable: true,
    });
    const upload = vi
      .fn<MarkdownUploadAdapter["upload"]>()
      .mockResolvedValueOnce(firstAsset)
      .mockRejectedValueOnce(retryable)
      .mockResolvedValueOnce(secondAsset);
    const adapter: MarkdownUploadAdapter = { upload };
    const { container } = render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value="Existing body"
          onChange={onChange}
          imageUpload={{ adapter, context: { vault: "reef-e2e" } }}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const picker = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept="image/*"]',
    );
    expect(picker).not.toBeNull();
    fireEvent.change(picker as HTMLInputElement, {
      target: {
        files: [
          new File(["first"], "first.png", { type: "image/png" }),
          new File(["second"], "second.png", { type: "image/png" }),
        ],
      },
    });

    const failure = await screen.findByRole("alert");
    expect(failure).toBeVisible();
    fireEvent.click(within(failure).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByTitle("Toggle source mode"));
    const source = await screen.findByRole("textbox", {
      name: "Issue description",
    });
    await waitFor(async () => {
      const sourceValue = (source as HTMLTextAreaElement).value;
      expect(sourceValue).toContain(firstAsset.target);
      expect(sourceValue).toContain(secondAsset.target);
    });
    expect(
      upload.mock.calls.map(([file]) =>
        file instanceof File ? file.name : "not-a-file",
      ),
    ).toEqual(["first.png", "second.png", "second.png"]);
  });
});

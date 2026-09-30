import type { MarkdownReferenceAdapter } from "@akb/markdown-editor/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  IssueListItemSchema,
  type IssueListItem,
  type VaultMember,
} from "@reef/core";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { MarkdownEditor } from "./MarkdownEditorImpl";
import {
  EDITOR_BODY_DEFAULT_HEIGHT,
  EDITOR_BODY_FINE_POINTER_MEDIA_QUERY,
  EDITOR_BODY_FRAME_CLASS,
  EDITOR_BODY_KEYBOARD_STEP,
  EDITOR_BODY_MIN_HEIGHT,
  EDITOR_BODY_RESIZE_MIN_WIDTH,
  EDITOR_BODY_SESSION_STORAGE_KEY,
  EDITOR_CONTENT_CLASS,
  EDITOR_MANUAL_SCROLL_SURFACE_CLASS,
  EDITOR_RESIZABLE_BODY_ID,
  MARKDOWN_SURFACE_CLASS,
} from "./markdown-editor/heightResize";

const markdownMocks = vi.hoisted(() => ({
  editorOptions: null as Record<string, unknown> | null,
  handle: { testHandle: true },
  commands: {
    focus: vi.fn(() => true),
    setMarkdown: vi.fn(() => true),
    insertMarkdown: vi.fn((_markdown: string) => true),
    insertImage: vi.fn(
      (_target: string, _alt?: string, _title?: string) => true,
    ),
  },
  state: { isEmpty: true },
  targetResolutions: new Map<string, unknown>(),
  surfaceProps: null as Record<string, unknown> | null,
  surfaceLink: null as {
    href: string;
    text: string;
    attributes?: Record<string, string>;
  } | null,
}));

vi.mock("@akb/markdown-editor/react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@akb/markdown-editor/react")>();

  return {
    ...actual,
    MarkdownSurface: (props: {
      className?: string;
      contentClassName?: string;
      contentAttributes?: Record<string, string | boolean>;
      editable: boolean;
    }) => {
      markdownMocks.surfaceProps = props as unknown as Record<string, unknown>;
      const link = markdownMocks.surfaceLink;
      return (
        <div className={props.className}>
          <div
            {...props.contentAttributes}
            className={props.contentClassName}
            contentEditable={props.editable}
            suppressContentEditableWarning
          >
            {link ? (
              <p>
                <a href={link.href} {...link.attributes}>
                  {link.text}
                </a>
              </p>
            ) : null}
          </div>
        </div>
      );
    },
    MarkdownToolbar: ({
      editor,
      children,
      className,
    }: {
      editor: object | null;
      children?: ReactNode;
      className?: string;
    }) => (
      <div data-testid="shared-toolbar" className={className}>
        {[
          "Bold",
          "Italic",
          "Strikethrough",
          "Inline Code",
          "Heading 1",
          "Heading 2",
          "Heading 3",
          "Bullet list",
          "Numbered List",
          "Quote",
          "Code Block",
          "Divider",
          "Link",
        ].map((label) => (
          <button
            key={label}
            type="button"
            title={label}
            disabled={!editor}
            onClick={() => markdownMocks.commands.focus()}
          >
            {label}
          </button>
        ))}
        {children}
      </div>
    ),
    MarkdownToolbarGroup: ({
      label,
      children,
    }: {
      label: string;
      children: ReactNode;
    }) => (
      <div role="group" aria-label={label}>
        {children}
      </div>
    ),
    MarkdownToolbarButton: ({
      label,
      disabled,
      onClick,
      children,
    }: {
      label: string;
      disabled?: boolean;
      onClick: () => void;
      children: ReactNode;
    }) => (
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    ),
    useMarkdownEditor: vi.fn((options: Record<string, unknown>) => {
      markdownMocks.editorOptions = options;
      return markdownMocks.handle;
    }),
    useMarkdownCommands: vi.fn(() => markdownMocks.commands),
    useMarkdownState: vi.fn(() => markdownMocks.state),
    useMarkdownTargetResolutions: vi.fn(() => markdownMocks.targetResolutions),
    useMarkdownReferenceResolutions: vi.fn(() => new Map()),
  };
});

function renderEditor(
  props: ComponentProps<typeof MarkdownEditor>,
  locale: "en" | "ko" = "en",
) {
  return render(
    <IntlTestProvider locale={locale}>
      <MarkdownEditor {...props} />
    </IntlTestProvider>,
  );
}

function emitEditorChange(markdown: string) {
  const options = markdownMocks.editorOptions as {
    onChange: (markdown: string) => void;
  };
  act(() => options.onChange(markdown));
}

function setPointerCapability(fine: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === EDITOR_BODY_FINE_POINTER_MEDIA_QUERY && fine,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
}

const successfulUpload = {
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
};

function mockImageInsertion(initialMarkdown: string) {
  let markdown = initialMarkdown;
  markdownMocks.commands.insertMarkdown.mockImplementation((snippet) => {
    markdown += snippet;
    emitEditorChange(markdown);
    return true;
  });
  markdownMocks.commands.insertImage.mockImplementation((target, alt = "") => {
    markdown += `![${alt}](${target})`;
    emitEditorChange(markdown);
    return true;
  });
}

function issue(id: string, title: string): IssueListItem {
  return IssueListItemSchema.parse({
    id,
    title,
    status: "todo",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "alice",
    archived_at: null,
  });
}

describe("MarkdownEditor product adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markdownMocks.commands.insertMarkdown.mockImplementation(() => true);
    markdownMocks.commands.insertImage.mockImplementation(() => true);
    markdownMocks.editorOptions = null;
    markdownMocks.surfaceProps = null;
    markdownMocks.surfaceLink = null;
    markdownMocks.targetResolutions = new Map();
    markdownMocks.state.isEmpty = true;
    sessionStorage.clear();
    setPointerCapability(true);
    setViewport(1440, 900);
  });

  it("adapts the editor to the public shared surface and keeps its focus chrome", () => {
    renderEditor({ value: "# Hello", onChange: vi.fn() });

    const root = screen.getByTestId("markdown-editor");
    const content = screen.getByTestId("markdown-editor-content");
    expect(root).toHaveAttribute("data-reef-editable-markdown", "");
    expect(root.className).toContain("isolate");
    expect(root.className).toContain("focus-within:after:ring-inset");
    expect(content.className).toContain(EDITOR_CONTENT_CLASS);
    expect(content.className).toContain(MARKDOWN_SURFACE_CLASS);
    expect(content).toHaveAttribute("contenteditable", "true");
  });

  it("keeps the shared semantic surface in read-only mode and hides editing controls", () => {
    renderEditor({ value: "# Body", onChange: vi.fn(), readOnly: true });

    expect(screen.getByTestId("markdown-editor")).not.toHaveAttribute(
      "data-reef-editable-markdown",
    );
    expect(screen.getByTestId("markdown-editor-content")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.queryByTestId("markdown-toolbar")).not.toBeInTheDocument();
  });

  it("keeps legacy AKB attachment image resolution presentation-only", () => {
    const target = "akb://reef-test/issues/file/file-1";
    const resolveImageSrc = vi.fn(
      () => "/api/issues/REEF-001/attachments/file",
    );
    renderEditor({
      value: "![Screenshot](akb://reef-test/issues/file/file-1)",
      onChange: vi.fn(),
      resolveImageSrc,
    });

    const surfaceProps = markdownMocks.surfaceProps as {
      resolutions: ReadonlyMap<string, { runtimeUrl: string }>;
    };
    expect(surfaceProps.resolutions.get(target)).toMatchObject({
      target,
      status: "available",
      runtimeUrl: "/api/issues/REEF-001/attachments/file",
    });
    expect(resolveImageSrc).toHaveBeenCalledWith(target);
    expect(screen.getByTestId("markdown-editor-content")).toBeEmptyDOMElement();
  });

  it("inserts successful uploads through the public image command and reports partial failures", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const onUploadFiles = vi.fn().mockResolvedValue({
      ...successfulUpload,
      items: [
        ...successfulUpload.items,
        {
          status: "failed" as const,
          file: new Blob(["failed"]),
          error: { code: "unknown" as const, message: "busy", retryable: true },
        },
      ],
      succeeded: 1,
      failed: 1,
      partial: true,
    });
    renderEditor({ value: "Existing body", onChange, onBlur, onUploadFiles });
    mockImageInsertion("Existing body");
    const file = new File(["x"], "brief.pdf", { type: "application/pdf" });

    fireEvent.change(screen.getByTestId("markdown-attachment-input"), {
      target: { files: [file] },
    });

    const expected =
      "Existing body\n\n![brief.png](/api/assets/00000000-0000-4000-8000-000000000001)";
    await waitFor(() => {
      expect(onUploadFiles).toHaveBeenCalledWith([file]);
      expect(onChange).toHaveBeenLastCalledWith(expected);
      expect(onBlur).toHaveBeenCalledWith(expected);
    });
    expect(markdownMocks.commands.focus).toHaveBeenCalledWith("end");
    expect(markdownMocks.commands.insertMarkdown).toHaveBeenCalledWith("\n\n");
    expect(markdownMocks.commands.insertImage).toHaveBeenCalledWith(
      "/api/assets/00000000-0000-4000-8000-000000000001",
      "brief.png",
      undefined,
    );
    expect(markdownMocks.commands.setMarkdown).not.toHaveBeenCalledWith(
      expected,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't upload that file.",
    );
  });

  it("does not append Markdown when an upload rejects", async () => {
    const onChange = vi.fn();
    const onUploadFiles = vi.fn().mockRejectedValue(new Error("offline"));
    renderEditor({ value: "Existing body", onChange, onUploadFiles });

    fireEvent.change(screen.getByTestId("markdown-attachment-input"), {
      target: {
        files: [new File(["x"], "brief.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't upload that file.",
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the Source draft current while files are pasted into it", async () => {
    const onChange = vi.fn();
    const onUploadFiles = vi.fn().mockResolvedValue(successfulUpload);
    renderEditor({ value: "Existing body", onChange, onUploadFiles });
    fireEvent.click(screen.getByTitle("Toggle source mode"));
    const source = screen.getByTestId("markdown-source-textarea");
    fireEvent.change(source, { target: { value: "Source draft" } });
    mockImageInsertion("Source draft");

    fireEvent.paste(source, {
      clipboardData: {
        files: [new File(["x"], "brief.pdf", { type: "application/pdf" })],
      },
    });

    const expected =
      "Source draft\n\n![brief.png](/api/assets/00000000-0000-4000-8000-000000000001)";
    await waitFor(() => expect(source).toHaveValue(expected));
    expect(onChange).toHaveBeenLastCalledWith(expected);
    expect(markdownMocks.commands.insertImage).toHaveBeenCalledWith(
      "/api/assets/00000000-0000-4000-8000-000000000001",
      "brief.png",
      undefined,
    );
  });

  it("uses the latest Source and WYSIWYG values for change, blur, and mode handoff", () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    renderEditor({
      value: "Original",
      onChange,
      onBlur,
      placeholder: "WYSIWYG hint",
      sourcePlaceholder: "Source hint",
    });
    emitEditorChange("Latest editor text");
    expect(onChange).toHaveBeenCalledWith("Latest editor text");

    fireEvent.click(screen.getByTitle("Toggle source mode"));
    const source = screen.getByTestId("markdown-source-textarea");
    expect(source).toHaveValue("Latest editor text");
    expect(source).toHaveAttribute("placeholder", "Source hint");
    fireEvent.change(source, { target: { value: "Latest source text" } });
    fireEvent.blur(screen.getByTestId("markdown-editor"), {
      relatedTarget: document.body,
    });
    expect(onChange).toHaveBeenLastCalledWith("Latest source text");
    expect(onBlur).toHaveBeenCalledWith("Latest source text");

    fireEvent.click(screen.getByTitle("Toggle source mode"));
    expect(markdownMocks.commands.setMarkdown).toHaveBeenLastCalledWith(
      "Latest source text",
    );
    expect(screen.getByTestId("markdown-editor-content")).toHaveAttribute(
      "contenteditable",
      "true",
    );
  });

  it("does not reparse an unchanged Source view", () => {
    const markdown = String.raw`![reef'\\한글😀.png](/api/assets/00000000-0000-4000-8000-000000000001)`;
    renderEditor({ value: markdown, onChange: vi.fn() });
    markdownMocks.commands.setMarkdown.mockClear();

    fireEvent.click(screen.getByTitle("Toggle source mode"));
    expect(screen.getByTestId("markdown-source-textarea")).toHaveValue(
      markdown,
    );
    fireEvent.click(screen.getByTitle("Toggle source mode"));

    expect(markdownMocks.commands.setMarkdown).not.toHaveBeenCalled();
  });

  it("prepares uploaded image alt escapes for the shared Markdown parser", () => {
    const persistedMarkdown =
      "![reef'\\\\한글😀.png](/api/assets/00000000-0000-4000-8000-000000000001)";
    const editorMarkdown =
      "![reef'\\한글😀.png](/api/assets/00000000-0000-4000-8000-000000000001)";
    renderEditor({ value: persistedMarkdown, onChange: vi.fn() });

    expect(markdownMocks.editorOptions).toMatchObject({
      initialMarkdown: editorMarkdown,
    });
  });

  it("does not reset the editor when the controlled Markdown value is unchanged", () => {
    const onChange = vi.fn();
    const view = renderEditor({ value: "Stable body", onChange });
    markdownMocks.commands.setMarkdown.mockClear();

    view.rerender(
      <IntlTestProvider>
        <MarkdownEditor value="Stable body" onChange={onChange} />
      </IntlTestProvider>,
    );

    expect(markdownMocks.commands.setMarkdown).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("normalizes bare AKB document URIs without changing resource identity", () => {
    const onChange = vi.fn();
    renderEditor({
      value: "See akb://reef-test/coll/docs/doc/spec.md",
      onChange,
    });

    expect(markdownMocks.editorOptions).toMatchObject({
      initialMarkdown: "See [spec](akb://reef-test/coll/docs/doc/spec.md)",
      profile: "preserve",
    });
    expect(onChange).toHaveBeenCalledWith(
      "See [spec](akb://reef-test/coll/docs/doc/spec.md)",
    );
  });

  it("opens external Markdown links only after confirmation", () => {
    markdownMocks.surfaceLink = {
      href: "https://example.test/spec",
      text: "Spec",
    };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderEditor({
      value: "[Spec](https://example.test/spec)",
      onChange: vi.fn(),
    });
    const link = screen.getByText("Spec").closest("a");
    expect(link).not.toBeNull();
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });

    act(() => link?.dispatchEvent(click));

    expect(click.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Open external link" }),
    ).toHaveTextContent("https://example.test/spec");
  });

  it("opens a canonical issue link directly in a protected new tab", () => {
    markdownMocks.surfaceLink = {
      href: "/workspace/reef-test/issues/REEF-001",
      text: "REEF-001",
    };
    const opened = { opener: window } as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(opened);
    renderEditor({
      value: "[REEF-001](/workspace/reef-test/issues/REEF-001)",
      onChange: vi.fn(),
    });
    const link = screen.getByText("REEF-001").closest("a");

    act(() =>
      link?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      ),
    );

    expect(open).toHaveBeenCalledWith(
      new URL("/workspace/reef-test/issues/REEF-001", window.location.href)
        .href,
      "_blank",
      "noopener,noreferrer",
    );
    expect(opened.opener).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires confirmation when rendered AKB metadata is not canonical", () => {
    markdownMocks.surfaceLink = {
      href: "https://example.test/spec",
      text: "Spec",
      attributes: { "data-document-uri": "akb://not-valid" },
    };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderEditor({
      value: "[Spec](https://example.test/spec)",
      onChange: vi.fn(),
    });
    const link = screen.getByText("Spec").closest("a");

    act(() =>
      link?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      ),
    );

    expect(open).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Open external link" }),
    ).toBeInTheDocument();
  });

  it("builds reference suggestions in people, issue, and document order", async () => {
    const member = {
      username: "auth",
      display_name: "Auth Specialist",
    } as VaultMember;
    const authIssue = issue("REEF-001", "Auth flow");
    const searchDocuments = vi.fn(async () => [
      { uri: "akb://reef-test/coll/docs/doc/auth.md", title: "Auth guide" },
    ]);
    renderEditor({
      value: "",
      onChange: vi.fn(),
      vault: "reef-test",
      mentionConfig: {
        members: [member],
        issues: [authIssue],
        searchDocuments,
        mentionOptionLabel: (username) => `@${username}`,
        documentOptionLabel: (hit) => hit.title ?? hit.uri,
      },
    });
    const options = markdownMocks.editorOptions as {
      reference: {
        adapter: MarkdownReferenceAdapter;
        context: { vault: string };
      };
    };
    const candidates = await options.reference.adapter.search("auth", {
      vault: "reef-test",
      signal: new AbortController().signal,
    });

    expect(options.reference.context).toEqual({ vault: "reef-test" });
    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "person",
      "issue",
      "document",
    ]);
    expect(candidates[0]).toMatchObject({ value: "@auth", title: "@auth" });
    expect(candidates[2]).toMatchObject({
      target: "akb://reef-test/coll/docs/doc/auth.md",
    });
    expect(searchDocuments).toHaveBeenCalledWith(
      "auth",
      expect.any(AbortSignal),
    );
  });

  it("resolves known issue references to a workspace route", async () => {
    const authIssue = issue("REEF-001", "Auth flow");
    renderEditor({
      value: "REEF-001",
      onChange: vi.fn(),
      vault: "reef-test",
      mentionConfig: {
        members: [],
        issues: [authIssue],
        mentionOptionLabel: (username) => `@${username}`,
        documentOptionLabel: (hit) => hit.title ?? hit.uri,
      },
    });
    const options = markdownMocks.editorOptions as {
      reference: { adapter: MarkdownReferenceAdapter };
    };

    await expect(
      options.reference.adapter.resolve?.(
        { kind: "issue", id: "REEF-001", value: "REEF-001" },
        { vault: "reef-test" },
      ),
    ).resolves.toMatchObject({
      status: "available",
      title: "Auth flow",
      runtimeUrl: "/workspace/reef-test/issues/REEF-001",
    });
  });

  describe("issue description resize", () => {
    it("renders an accessible separator and clamps keyboard resizing", async () => {
      renderEditor({ value: "", onChange: vi.fn(), enableHeightResize: true });

      const handle = await screen.findByRole("separator", {
        name: "Resize issue description editor",
      });
      expect(handle).toHaveAttribute(
        "aria-valuemin",
        String(EDITOR_BODY_MIN_HEIGHT),
      );
      expect(handle).toHaveAttribute(
        "aria-valuenow",
        String(EDITOR_BODY_DEFAULT_HEIGHT),
      );
      fireEvent.keyDown(handle, { key: "ArrowDown" });
      expect(handle).toHaveAttribute(
        "aria-valuenow",
        String(EDITOR_BODY_DEFAULT_HEIGHT + EDITOR_BODY_KEYBOARD_STEP),
      );
      expect(sessionStorage.getItem(EDITOR_BODY_SESSION_STORAGE_KEY)).toBe(
        String(EDITOR_BODY_DEFAULT_HEIGHT + EDITOR_BODY_KEYBOARD_STEP),
      );
    });

    it("shares the frame with Source mode and hides resizing below desktop width", async () => {
      sessionStorage.setItem(EDITOR_BODY_SESSION_STORAGE_KEY, "480");
      renderEditor({ value: "", onChange: vi.fn(), enableHeightResize: true });

      const frame = screen.getByTestId("markdown-editor-body-frame");
      const handle = await screen.findByRole("separator");
      expect(frame).toHaveAttribute("id", EDITOR_RESIZABLE_BODY_ID);
      expect(frame.className).toContain(EDITOR_BODY_FRAME_CLASS);
      expect(frame).toHaveStyle({ height: "480px" });
      expect(frame).toHaveClass("overflow-hidden");
      expect(frame).toHaveStyle({ marginBottom: "4px", marginRight: "4px" });
      const scrollSurface = screen.getByTestId("markdown-editor-content")
        .parentElement?.parentElement;
      expect(scrollSurface).toHaveClass(EDITOR_MANUAL_SCROLL_SURFACE_CLASS);
      fireEvent.click(screen.getByTitle("Toggle source mode"));
      expect(screen.getByTestId("markdown-source-textarea")).toHaveClass(
        "resize-none",
      );
      expect(frame).toHaveStyle({ height: "480px" });

      setViewport(EDITOR_BODY_RESIZE_MIN_WIDTH - 1, 900);
      await waitFor(() => expect(handle).not.toBeInTheDocument());
      expect(screen.getByTestId("markdown-source-textarea")).toHaveClass(
        "resize-y",
      );
    });

    it("omits the resize handle for coarse pointers", () => {
      setPointerCapability(false);
      renderEditor({ value: "", onChange: vi.fn(), enableHeightResize: true });

      expect(
        screen.queryByTestId("markdown-editor-resize-handle"),
      ).not.toBeInTheDocument();
    });
  });
});

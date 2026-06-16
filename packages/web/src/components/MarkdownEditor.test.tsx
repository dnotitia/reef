import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_BODY_SIZING,
  EDITOR_CONTENT_CLASS,
  MarkdownEditor,
} from "./MarkdownEditor";

// Mock Tiptap to avoid JSDOM ProseMirror issues. The chain is a single
// self-referential object so any command sequence (e.g. focus().setLink().run())
// resolves, and tests can assert which commands fired.
const chainMethods = [
  "focus",
  "toggleBold",
  "toggleItalic",
  "toggleStrike",
  "toggleCode",
  "toggleHeading",
  "toggleBulletList",
  "toggleOrderedList",
  "toggleBlockquote",
  "toggleCodeBlock",
  "setHorizontalRule",
  "extendMarkRange",
  "setLink",
  "unsetLink",
  "insertContent",
  "run",
] as const;

type MockChain = Record<
  (typeof chainMethods)[number],
  ReturnType<typeof vi.fn>
>;

const mockChain = {} as MockChain;
for (const m of chainMethods) {
  mockChain[m] = vi.fn(() => mockChain);
}

vi.mock("@tiptap/react", () => {
  const mockEditor = {
    chain: () => mockChain,
    commands: {
      setContent: vi.fn(),
    },
    // Direct getMarkdown method (Tiptap v3 augments Editor interface directly)
    getMarkdown: vi.fn(() => ""),
    storage: {
      markdown: {
        getMarkdown: vi.fn(() => ""),
      },
    },
    isActive: vi.fn(() => false),
    getAttributes: vi.fn(() => ({}) as Record<string, unknown>),
    state: { selection: { empty: true } },
    isDestroyed: false,
    isEditable: true,
    setEditable: vi.fn((editable: boolean) => {
      mockEditor.isEditable = editable;
    }),
  };

  return {
    useEditor: vi.fn(
      (opts: {
        onUpdate?: (args: { editor: typeof mockEditor }) => void;
        content?: string;
      }) => {
        // Expose onUpdate so tests can trigger it
        (mockEditor as unknown as { _opts: typeof opts })._opts = opts;
        mockEditor.getMarkdown = vi.fn(() => opts.content ?? "");
        mockEditor.storage.markdown.getMarkdown = vi.fn(
          () => opts.content ?? "",
        );
        return mockEditor;
      },
    ),
    // Run the selector against the mock editor so derived active flags reflect
    // mockEditor.isActive(), matching the real subscribe-to-derived behavior.
    useEditorState: vi.fn(
      (opts: {
        selector: (ctx: {
          editor: typeof mockEditor;
          transactionNumber: number;
        }) => unknown;
      }) => opts.selector({ editor: mockEditor, transactionNumber: 0 }),
    ),
    EditorContent: ({ editor }: { editor: unknown }) => (
      <div
        data-testid="editor-content"
        data-editor={editor ? "loaded" : "null"}
      />
    ),
  };
});

vi.mock("@tiptap/starter-kit", () => ({
  default: { configure: () => ({}) },
}));
vi.mock("@tiptap/extension-placeholder", () => ({
  default: { configure: () => ({}) },
}));
vi.mock("@tiptap/extension-list", () => ({
  TaskList: {},
  TaskItem: { configure: () => ({}) },
}));
vi.mock("@tiptap/markdown", () => ({ Markdown: {} }));

describe("MarkdownEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the editor container", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
  });

  it("keeps the focus-within ring inset for clipped edit lanes", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    const editor = screen.getByTestId("markdown-editor");
    expect(editor.className).toContain("focus-within:ring-2");
    expect(editor.className).toContain("focus-within:ring-inset");
    expect(editor.className).toContain("focus-within:ring-brand/30");
  });

  it("shows the editor content area", () => {
    render(<MarkdownEditor value="# Hello" onChange={vi.fn()} />);
    expect(screen.getByTestId("editor-content")).toBeInTheDocument();
  });

  it("scopes WYSIWYG content for task-list layout CSS (REEF-161)", () => {
    render(<MarkdownEditor value="- [ ] task" onChange={vi.fn()} />);

    const opts = vi.mocked(useEditor).mock.calls.at(-1)?.[0] as {
      editorProps?: { attributes?: { class?: string } };
    };
    const className = opts.editorProps?.attributes?.class ?? "";

    expect(className).toContain(EDITOR_CONTENT_CLASS);
    expect(className).toContain(EDITOR_BODY_SIZING);
  });

  it("shows toolbar buttons when not readOnly", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    expect(screen.getByTitle("Bold")).toBeInTheDocument();
    expect(screen.getByTitle("Italic")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 1")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 2")).toBeInTheDocument();
    expect(screen.getByTitle("Bullet List")).toBeInTheDocument();
    expect(screen.getByTitle("Code Block")).toBeInTheDocument();
  });

  it("exposes the expanded set of markdown authoring controls", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    // Controls added in REEF-082 — previously just reachable via Source mode.
    expect(screen.getByTitle("Strikethrough")).toBeInTheDocument();
    expect(screen.getByTitle("Inline Code")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 3")).toBeInTheDocument();
    expect(screen.getByTitle("Numbered List")).toBeInTheDocument();
    expect(screen.getByTitle("Quote")).toBeInTheDocument();
    expect(screen.getByTitle("Divider")).toBeInTheDocument();
    expect(screen.getByTitle("Link")).toBeInTheDocument();
  });

  it("keeps the Source toggle out of the wrapping control group", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    const toolbar = screen.getByTestId("markdown-toolbar");
    const controls = screen.getByTestId("markdown-toolbar-controls");
    const sourceToggle = screen.getByTestId("markdown-source-toggle");

    expect(toolbar).toHaveClass("items-start");
    expect(controls).toHaveClass("flex-1", "flex-wrap", "min-w-0");
    expect(sourceToggle).toHaveClass("shrink-0");
    expect(sourceToggle).not.toHaveClass("ml-auto");
    expect(controls).toContainElement(screen.getByTitle("Bold"));
    expect(controls).toContainElement(screen.getByTitle("Link"));
    expect(sourceToggle).toContainElement(
      screen.getByTitle("Toggle source mode"),
    );
  });

  it("hides toolbar when readOnly is true", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} readOnly />);
    expect(screen.queryByTitle("Bold")).not.toBeInTheDocument();
  });

  it("runs the matching command when a formatting control is clicked", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTitle("Strikethrough"));
    });
    expect(mockChain.toggleStrike).toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByTitle("Numbered List"));
    });
    expect(mockChain.toggleOrderedList).toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByTitle("Quote"));
    });
    expect(mockChain.toggleBlockquote).toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByTitle("Divider"));
    });
    expect(mockChain.setHorizontalRule).toHaveBeenCalled();
  });

  it("reflects the active mark with aria-pressed", () => {
    const { rerender } = render(<MarkdownEditor value="" onChange={vi.fn()} />);
    expect(screen.getByTitle("Bold")).toHaveAttribute("aria-pressed", "false");

    const editor = vi.mocked(useEditor).mock.results.at(-1)?.value as {
      isActive: ReturnType<typeof vi.fn>;
    };
    editor.isActive.mockImplementation((name: string) => name === "bold");
    rerender(<MarkdownEditor value="x" onChange={vi.fn()} />);
    expect(screen.getByTitle("Bold")).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles to source mode when Source button is clicked", () => {
    render(<MarkdownEditor value="test content" onChange={vi.fn()} />);
    const sourceBtn = screen.getByTitle("Toggle source mode");
    act(() => {
      fireEvent.click(sourceBtn);
    });
    expect(screen.getByTestId("markdown-source-textarea")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-content")).not.toBeInTheDocument();
  });

  it("calls onChange when source textarea value changes", () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="" onChange={onChange} />);

    // Switch to source mode first
    act(() => {
      fireEvent.click(screen.getByTitle("Toggle source mode"));
    });

    const textarea = screen.getByTestId("markdown-source-textarea");
    act(() => {
      fireEvent.change(textarea, { target: { value: "new content" } });
    });
    expect(onChange).toHaveBeenCalledWith("new content");
  });

  it("passes the latest WYSIWYG markdown to onBlur", () => {
    const onBlur = vi.fn();
    const onChange = vi.fn();
    render(
      <MarkdownEditor
        value="old content"
        onChange={onChange}
        onBlur={onBlur}
      />,
    );

    const editor = vi.mocked(useEditor).mock.results.at(-1)?.value as {
      _opts?: {
        onUpdate?: (args: { editor: { getMarkdown: () => string } }) => void;
      };
      getMarkdown: ReturnType<typeof vi.fn>;
    };
    editor.getMarkdown.mockReturnValue("fresh markdown");

    act(() => {
      editor._opts?.onUpdate?.({ editor });
    });
    fireEvent.blur(screen.getByTestId("markdown-editor"), {
      relatedTarget: document.body,
    });

    expect(onChange).toHaveBeenCalledWith("fresh markdown");
    expect(onBlur).toHaveBeenCalledWith("fresh markdown");
  });

  it("passes the latest source markdown to onBlur", () => {
    const onBlur = vi.fn();
    render(<MarkdownEditor value="" onChange={vi.fn()} onBlur={onBlur} />);

    act(() => {
      fireEvent.click(screen.getByTitle("Toggle source mode"));
    });
    const textarea = screen.getByTestId("markdown-source-textarea");
    act(() => {
      fireEvent.change(textarea, { target: { value: "source markdown" } });
    });
    fireEvent.blur(textarea, { relatedTarget: document.body });

    expect(onBlur).toHaveBeenCalledWith("source markdown");
  });

  it("shows placeholder text on textarea in source mode", () => {
    render(
      <MarkdownEditor
        value=""
        onChange={vi.fn()}
        placeholder="Enter description"
      />,
    );
    act(() => {
      fireEvent.click(screen.getByTitle("Toggle source mode"));
    });
    const textarea = screen.getByTestId("markdown-source-textarea");
    expect(textarea).toHaveAttribute("placeholder", "Enter description");
  });

  it("disables toolbar buttons in source mode", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTitle("Toggle source mode"));
    });
    expect(screen.getByTitle("Bold")).toBeDisabled();
    expect(screen.getByTitle("Italic")).toBeDisabled();
    expect(screen.getByTitle("Link")).toBeDisabled();
  });

  describe("link editor", () => {
    it("opens the inline link editor when Link is clicked", () => {
      render(<MarkdownEditor value="" onChange={vi.fn()} />);
      expect(
        screen.queryByTestId("markdown-link-editor"),
      ).not.toBeInTheDocument();
      act(() => {
        fireEvent.click(screen.getByTitle("Link"));
      });
      expect(screen.getByTestId("markdown-link-editor")).toBeInTheDocument();
      expect(screen.getByTestId("markdown-link-input")).toBeInTheDocument();
    });

    it("inserts a normalized link on apply", () => {
      render(<MarkdownEditor value="" onChange={vi.fn()} />);
      act(() => {
        fireEvent.click(screen.getByTitle("Link"));
      });
      const input = screen.getByTestId("markdown-link-input");
      act(() => {
        fireEvent.change(input, { target: { value: "example.com" } });
      });
      act(() => {
        fireEvent.click(screen.getByText("Apply"));
      });
      // Empty selection + no existing link -> insert linked text, scheme added.
      expect(mockChain.extendMarkRange).toHaveBeenCalledWith("link");
      expect(mockChain.insertContent).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "https://example.com",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        }),
      );
      expect(
        screen.queryByTestId("markdown-link-editor"),
      ).not.toBeInTheDocument();
    });

    it("applies a link on Enter and prevents form submission", () => {
      render(<MarkdownEditor value="" onChange={vi.fn()} />);
      act(() => {
        fireEvent.click(screen.getByTitle("Link"));
      });
      const input = screen.getByTestId("markdown-link-input");
      act(() => {
        fireEvent.change(input, { target: { value: "https://reef.dev" } });
      });
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        input.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      expect(mockChain.insertContent).toHaveBeenCalledWith(
        expect.objectContaining({ text: "https://reef.dev" }),
      );
    });

    it("applies nothing and preserves the selection on empty URL", () => {
      render(<MarkdownEditor value="" onChange={vi.fn()} />);
      act(() => {
        fireEvent.click(screen.getByTitle("Link"));
      });
      act(() => {
        fireEvent.change(screen.getByTestId("markdown-link-input"), {
          target: { value: "   " },
        });
      });
      act(() => {
        fireEvent.click(screen.getByText("Apply"));
      });
      expect(mockChain.setLink).not.toHaveBeenCalled();
      expect(mockChain.insertContent).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("markdown-link-editor"),
      ).not.toBeInTheDocument();
    });

    it("closes the link editor on Escape", () => {
      render(<MarkdownEditor value="" onChange={vi.fn()} />);
      act(() => {
        fireEvent.click(screen.getByTitle("Link"));
      });
      const input = screen.getByTestId("markdown-link-input");
      act(() => {
        fireEvent.keyDown(input, { key: "Escape" });
      });
      expect(
        screen.queryByTestId("markdown-link-editor"),
      ).not.toBeInTheDocument();
    });
  });

  it("applies a readOnly change after mount so a save-pending lock disables editing", () => {
    const { rerender } = render(
      <MarkdownEditor value="x" onChange={vi.fn()} />,
    );
    const editor = vi.mocked(useEditor).mock.results.at(-1)?.value as {
      setEditable: ReturnType<typeof vi.fn>;
      isEditable: boolean;
    };
    // Tiptap fixes `editable` at creation; the component should react to a later
    // readOnly flip (e.g. while a save is in flight) or edits get dropped.
    editor.setEditable.mockClear();
    rerender(<MarkdownEditor value="x" onChange={vi.fn()} readOnly />);
    // emitUpdate=false: a lock toggle should not fire a spurious content change.
    expect(editor.setEditable).toHaveBeenCalledWith(false, false);
    expect(editor.isEditable).toBe(false);
  });

  it("caps both editor surfaces at a shared scrollable height (REEF-133)", () => {
    // The sizing policy should carry a max-height + overflow so a long
    // description scrolls inside the editor instead of stretching the
    // surrounding sheet or dialog.
    expect(EDITOR_BODY_SIZING).toContain("max-h-[clamp(200px,48vh,560px)]");
    expect(EDITOR_BODY_SIZING).toContain("overflow-y-auto");

    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByTitle("Toggle source mode"));
    });
    const textarea = screen.getByTestId("markdown-source-textarea");
    // Source mode shares the same cap and auto-grows (field-sizing-content)
    // rather than sitting at a small fixed height.
    expect(textarea.className).toContain("field-sizing-content");
    // resize-y blocks horizontal drag (no dialog/sheet width overflow) while
    // keeping a manual vertical-resize fallback for browsers without
    // field-sizing support, where the textarea would otherwise sit at min-h.
    expect(textarea.className).toContain("resize-y");
    expect(textarea.className).toContain("max-h-[clamp(200px,48vh,560px)]");
    expect(textarea.className).toContain("overflow-y-auto");
  });

  it("names the source-mode textarea via ariaLabel", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} ariaLabel="Goal" />);
    act(() => {
      fireEvent.click(screen.getByTitle("Toggle source mode"));
    });
    expect(screen.getByTestId("markdown-source-textarea")).toHaveAttribute(
      "aria-label",
      "Goal",
    );
  });
});

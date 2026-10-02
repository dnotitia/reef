import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

let surfaceCommands: ReturnType<typeof useMarkdownCommands> | null = null;

function PublicSurfaceHarness({
  markdown,
  onChange,
  onBlur,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  onBlur: () => void;
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
        />
      </MarkdownEditingSurface>
    </div>
  );
}

describe("MarkdownEditor shared Source surface", () => {
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

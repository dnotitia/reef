import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { MarkdownEditor } from "./MarkdownEditorImpl";

describe("MarkdownEditor shared Source surface", () => {
  it("delegates mode changes and the same draft to MarkdownEditingSurface", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value="# Original"
          onChange={onChange}
          onBlur={onBlur}
          placeholder="WYSIWYG hint"
          sourcePlaceholder="Source hint"
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const editor = screen.getByTestId("markdown-editor");
    const surface = editor.querySelector("[data-markdown-mode]");
    expect(surface).toHaveAttribute("data-markdown-mode", "wysiwyg");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Toggle source mode"));
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
    expect(screen.getByTestId("markdown-editor-content")).toHaveTextContent(
      "Source body",
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onBlur).not.toHaveBeenCalled();
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

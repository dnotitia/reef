import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

// The wrapper code-splits the heavy TipTap implementation behind next/dynamic.
// Stub the impl module so this test exercises the wrapper's placeholder→mount
// contract without pulling ProseMirror into jsdom. (REEF-220)
vi.mock("./MarkdownEditorImpl", () => ({
  MarkdownEditor: ({ ariaLabel }: { ariaLabel?: string }) => (
    <div data-testid="markdown-editor">{ariaLabel}</div>
  ),
}));

describe("MarkdownEditor dynamic wrapper", () => {
  it("renders a height-reserving placeholder before the editor chunk loads", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);

    const skeleton = screen.getByTestId("markdown-editor-skeleton");
    // Decorative: a screen reader should not announce the loading shell.
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    // Reserves the editor's 200px body floor so the surrounding form does not
    // shift when the lazy chunk arrives.
    expect(skeleton.querySelector("[class*='min-h-[200px]']")).not.toBeNull();
    expect(
      screen.getByTestId("markdown-editor-skeleton-body-frame"),
    ).toHaveClass("p-1");
  });

  it("mounts the lazily-loaded editor once the chunk resolves", async () => {
    render(
      <MarkdownEditor
        value=""
        onChange={vi.fn()}
        ariaLabel="Issue description"
      />,
    );

    const editor = await screen.findByTestId("markdown-editor");
    expect(editor).toHaveTextContent("Issue description");
    expect(
      screen.queryByTestId("markdown-editor-skeleton"),
    ).not.toBeInTheDocument();
  });
});

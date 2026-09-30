import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
import { EDITOR_BODY_SESSION_STORAGE_KEY } from "./markdown-editor/heightResizePolicy";

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1440,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 900,
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: fine)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

// The wrapper code-splits the heavy TipTap implementation behind next/dynamic.
// Stub the impl module so this test exercises the wrapper's placeholder→mount
// contract without pulling ProseMirror into jsdom. (REEF-220)
vi.mock("./MarkdownEditorImpl", () => ({
  MarkdownEditor: ({ ariaLabel }: { ariaLabel?: string }) => (
    <div data-testid="markdown-editor">{ariaLabel}</div>
  ),
}));

describe("MarkdownEditor dynamic wrapper", () => {
  it("restores a saved opted-in frame before the editor chunk loads", () => {
    sessionStorage.setItem(EDITOR_BODY_SESSION_STORAGE_KEY, "640");
    render(
      <IntlTestProvider>
        <MarkdownEditor value="" onChange={vi.fn()} enableHeightResize />
      </IntlTestProvider>,
    );

    const skeleton = screen.getByTestId("markdown-editor-skeleton");
    // Decorative: a screen reader should not announce the loading shell.
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    // Mirrors the saved tab-local Description frame while the lazy chunk loads.
    expect(
      screen.getByTestId("markdown-editor-skeleton-body-frame"),
    ).toHaveStyle({ height: "640px" });
    expect(screen.getByTestId("markdown-toolbar")).toBeInTheDocument();
  });

  it("keeps automatic MarkdownEditor consumers at the 200px skeleton floor", () => {
    render(
      <IntlTestProvider>
        <MarkdownEditor value="" onChange={vi.fn()} />
      </IntlTestProvider>,
    );

    const skeleton = screen.getByTestId("markdown-editor-skeleton");
    expect(skeleton.querySelector("[class*='min-h-[200px]']")).not.toBeNull();
    expect(
      screen.getByTestId("markdown-editor-skeleton-body-frame"),
    ).not.toHaveStyle({ height: "640px" });
  });

  it("mounts the lazily-loaded editor once the chunk resolves", async () => {
    render(
      <IntlTestProvider>
        <MarkdownEditor
          value=""
          onChange={vi.fn()}
          ariaLabel="Issue description"
        />
      </IntlTestProvider>,
    );

    const editor = await screen.findByTestId("markdown-editor");
    expect(editor).toHaveTextContent("Issue description");
    expect(
      screen.queryByTestId("markdown-editor-skeleton"),
    ).not.toBeInTheDocument();
  });
});

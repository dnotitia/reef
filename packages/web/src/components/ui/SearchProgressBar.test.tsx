import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SearchProgressBar } from "./SearchProgressBar";

afterEach(cleanup);

describe("SearchProgressBar", () => {
  it("renders nothing when inactive", () => {
    const { container } = render(<SearchProgressBar active={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a decorative brand hairline when active", () => {
    const { getByTestId } = render(<SearchProgressBar active />);
    const bar = getByTestId("search-progress-bar");
    // Decorative: the wired surface's own text / aria-live owns the SR signal,
    // so this is a visual layer only.
    expect(bar).toHaveAttribute("aria-hidden", "true");
    // The sweep + reduced-motion static fallback live on `.reef-search-progress`
    // in globals.css.
    expect(bar).toHaveClass("reef-search-progress");
  });

  it("forwards className for placement overrides", () => {
    const { getByTestId } = render(
      <SearchProgressBar active className="top-0 bottom-auto" />,
    );
    expect(getByTestId("search-progress-bar")).toHaveClass(
      "top-0",
      "bottom-auto",
    );
  });
});

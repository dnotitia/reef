import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useThemeSync = vi.hoisted(() => vi.fn());

vi.mock("@/features/preferences/hooks/useThemeSync", () => ({
  useThemeSync,
}));

import { ThemeSync } from "./ThemeSync";

describe("ThemeSync", () => {
  beforeEach(() => {
    useThemeSync.mockClear();
  });

  it("owns the singleton theme synchronization at the root", () => {
    const { container, rerender } = render(<ThemeSync />);

    expect(container).toBeEmptyDOMElement();
    expect(useThemeSync).toHaveBeenCalledTimes(1);

    rerender(<ThemeSync />);
    expect(useThemeSync).toHaveBeenCalledTimes(2);
  });
});

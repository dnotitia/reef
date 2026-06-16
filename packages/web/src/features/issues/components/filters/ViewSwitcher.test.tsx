import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, navigationState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  navigationState: {
    pathname: "/issues",
    searchParams: new URLSearchParams(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => navigationState.pathname,
  useSearchParams: () => navigationState.searchParams,
}));

import { ViewSwitcher } from "./ViewSwitcher";

describe("ViewSwitcher", () => {
  beforeEach(() => {
    mockPush.mockClear();
    navigationState.pathname = "/issues";
    navigationState.searchParams = new URLSearchParams();
  });

  it("renders a toggle for each view and presses the active one", () => {
    render(<ViewSwitcher activeView="list" />);
    expect(screen.getByTestId("view-switcher-board")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("view-switcher-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("view-switcher-timeline")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("pushes ?view= while preserving existing filter params", async () => {
    navigationState.searchParams = new URLSearchParams("status=todo&q=auth");
    const user = userEvent.setup();
    render(<ViewSwitcher activeView="board" />);

    await user.click(screen.getByTestId("view-switcher-timeline"));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const [url, opts] = mockPush.mock.calls[0];
    const params = new URLSearchParams((url as string).split("?")[1]);
    expect((url as string).startsWith("/issues?")).toBe(true);
    expect(params.get("view")).toBe("timeline");
    expect(params.get("status")).toBe("todo");
    expect(params.get("q")).toBe("auth");
    expect(opts).toEqual({ scroll: false });
  });

  it("does not navigate when the active view is re-selected", async () => {
    const user = userEvent.setup();
    render(<ViewSwitcher activeView="board" />);

    await user.click(screen.getByTestId("view-switcher-board"));

    expect(mockPush).not.toHaveBeenCalled();
  });
});

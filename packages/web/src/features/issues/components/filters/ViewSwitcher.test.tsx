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

  // The push now flows through a React transition (REEF-265); the `?view=` URL
  // must still update with the preserved filter params so deep links and
  // back/forward keep working (AC3).
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

  // The pending-transition feedback can only be observed live in a browser (a
  // jsdom transition resolves synchronously, so `isPending` never settles true).
  // Assert instead that the wiring is present: the group declares an `aria-busy`
  // state (AC2) and the dim it toggles is gated on `motion-safe` so reduced
  // motion gets the state without the fade (AC4).
  it("declares an aria-busy state and a motion-safe pending transition", () => {
    render(<ViewSwitcher activeView="board" />);
    const group = screen.getByTestId("view-switcher");
    expect(group).toHaveAttribute("aria-busy", "false");
    expect(group.className).toContain("motion-safe:transition-opacity");
  });

  it("does not navigate when the active view is re-selected", async () => {
    const user = userEvent.setup();
    render(<ViewSwitcher activeView="board" />);

    await user.click(screen.getByTestId("view-switcher-board"));

    expect(mockPush).not.toHaveBeenCalled();
  });

  // REEF-261: the canonical segmented control previously had no keyboard focus
  // indicator at all (the a11y gap) and the family had drifted on dimensions.
  // Each segment now draws the canonical `ring-brand` focus-visible ring and the
  // shared family dimensions from one source. The ring's actual visibility is a
  // runtime concern (jsdom can't render :focus-visible) — this is the class
  // contract that guards against the indicator being dropped again.
  it("gives each segment the canonical focus-visible ring and shared dimensions", () => {
    render(<ViewSwitcher activeView="board" />);
    const classes = screen
      .getByTestId("view-switcher-board")
      .className.split(/\s+/);
    expect(classes).toContain("focus-visible:ring-2");
    expect(classes).toContain("focus-visible:ring-brand");
    expect(classes).toContain("text-[12px]");
    expect(classes).toContain("px-2");
    expect(classes).toContain("font-medium");
  });
});

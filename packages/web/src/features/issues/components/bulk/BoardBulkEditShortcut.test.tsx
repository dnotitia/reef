import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, navigationState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  navigationState: {
    searchParams: new URLSearchParams(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => navigationState.searchParams,
}));

import { BoardBulkEditShortcut } from "./BoardBulkEditShortcut";

describe("BoardBulkEditShortcut", () => {
  beforeEach(() => {
    mockPush.mockClear();
    navigationState.searchParams = new URLSearchParams();
  });

  it("opens List while preserving the board filter context", async () => {
    navigationState.searchParams = new URLSearchParams(
      "view=board&status=todo&q=auth&priority=high",
    );
    const user = userEvent.setup();
    render(
      <IntlTestProvider>
        <BoardBulkEditShortcut vault="reef-acme" />
      </IntlTestProvider>,
    );

    await user.click(screen.getByTestId("board-bulk-edit-shortcut"));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const [url, opts] = mockPush.mock.calls[0];
    const params = new URLSearchParams((url as string).split("?")[1]);
    expect((url as string).startsWith("/workspace/reef-acme/issues?")).toBe(
      true,
    );
    expect(params.get("view")).toBe("list");
    expect(params.get("status")).toBe("todo");
    expect(params.get("q")).toBe("auth");
    expect(params.get("priority")).toBe("high");
    expect(opts).toEqual({ scroll: false });
  });
});

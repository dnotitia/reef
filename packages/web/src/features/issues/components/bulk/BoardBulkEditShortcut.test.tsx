import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigationState } = vi.hoisted(() => ({
  navigationState: {
    searchParams: new URLSearchParams(),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigationState.searchParams,
}));

import { BoardBulkEditShortcut } from "./BoardBulkEditShortcut";

describe("BoardBulkEditShortcut", () => {
  beforeEach(() => {
    navigationState.searchParams = new URLSearchParams();
  });

  it("links to List while preserving the board filter context", () => {
    navigationState.searchParams = new URLSearchParams(
      "view=board&status=todo&q=auth&priority=high",
    );
    render(
      <IntlTestProvider>
        <BoardBulkEditShortcut vault="reef-acme" />
      </IntlTestProvider>,
    );

    const link = screen.getByRole("link", { name: "Bulk edit in List" });
    const href = link.getAttribute("href") ?? "";
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/workspace/reef-acme/issues?")).toBe(true);
    expect(params.get("view")).toBe("list");
    expect(params.get("status")).toBe("todo");
    expect(params.get("q")).toBe("auth");
    expect(params.get("priority")).toBe("high");
    expect(link).toHaveTextContent("Bulk edit in List");
    expect(link.querySelector("span")).not.toHaveClass("hidden");
  });
});

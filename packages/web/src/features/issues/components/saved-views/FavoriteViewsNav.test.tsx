import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { SavedIssueView } from "@reef/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/workspace/reef-acme/issues",
  search: "status=todo",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { FavoriteViewsNav } from "./FavoriteViewsNav";

const view = (
  id: string,
  name: string,
  status: "todo" | "in_progress",
): SavedIssueView => ({
  id,
  name,
  name_key: name.toLowerCase(),
  owner: "alice",
  payload: { version: 1, query: { status: [status] } },
});

const todo = view("11111111-1111-4111-8111-111111111111", "Todo", "todo");
const progress = view(
  "22222222-2222-4222-8222-222222222222",
  "In progress",
  "in_progress",
);

describe("FavoriteViewsNav", () => {
  beforeEach(() => {
    navigation.pathname = "/workspace/reef-acme/issues";
    navigation.search = "status=todo";
  });

  it("renders only explicitly favorited views as sorted real links", () => {
    render(
      <IntlTestProvider>
        <FavoriteViewsNav
          vault="reef-acme"
          views={[todo, progress]}
          favoriteIds={[todo.id]}
        />
      </IntlTestProvider>,
    );

    expect(screen.getByText("Favorites")).toBeVisible();
    expect(screen.getByRole("link", { name: "Todo" })).toHaveAttribute(
      "href",
      "/workspace/reef-acme/issues?status=todo",
    );
    expect(
      screen.queryByRole("link", { name: "In progress" }),
    ).not.toBeInTheDocument();
  });

  it("marks a favorite active only when its canonical query matches", () => {
    const { rerender } = render(
      <IntlTestProvider>
        <FavoriteViewsNav
          vault="reef-acme"
          views={[todo]}
          favoriteIds={[todo.id]}
        />
      </IntlTestProvider>,
    );

    expect(screen.getByRole("link", { name: "Todo" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    navigation.search = "priority=high";
    rerender(
      <IntlTestProvider>
        <FavoriteViewsNav
          vault="reef-acme"
          views={[todo]}
          favoriteIds={[todo.id]}
        />
      </IntlTestProvider>,
    );
    expect(screen.getByRole("link", { name: "Todo" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("omits the entire section when no valid favorite remains", () => {
    const { container } = render(
      <IntlTestProvider>
        <FavoriteViewsNav
          vault="reef-acme"
          views={[todo]}
          favoriteIds={[progress.id]}
        />
      </IntlTestProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

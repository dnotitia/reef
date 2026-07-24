import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/issues/components/saved-views/SavedViewsPage", () => ({
  SavedViewsPage: () => (
    <div data-testid="saved-views-page">Saved views page</div>
  ),
}));

import Page from "./page";

describe("ViewsPage", () => {
  it("renders the team saved-views management surface", () => {
    render(<Page />);
    expect(screen.getByTestId("saved-views-page")).toBeVisible();
  });
});

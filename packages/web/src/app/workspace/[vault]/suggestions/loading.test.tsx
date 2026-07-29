import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SuggestionsLoading from "./loading";

describe("suggestions loading.tsx", () => {
  it("renders the Suggestions chrome and queue skeleton", () => {
    render(<SuggestionsLoading />);
    expect(
      screen.getByRole("heading", { name: "Suggestions to review" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("activity-feed")).toBeInTheDocument();
  });
});

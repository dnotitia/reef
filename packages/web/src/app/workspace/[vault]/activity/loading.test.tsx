import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ActivityLoading from "./loading";

describe("activity loading.tsx", () => {
  it("renders the activity chrome and feed skeleton (REEF-255)", () => {
    render(<ActivityLoading />);
    expect(
      screen.getByRole("heading", { name: "Activity" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("activity-feed")).toBeInTheDocument();
  });
});

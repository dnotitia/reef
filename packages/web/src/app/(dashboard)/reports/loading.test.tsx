import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ReportsLoading from "./loading";

describe("reports loading.tsx", () => {
  it("renders the reports shell and skeleton, not a blank body (REEF-255)", () => {
    render(<ReportsLoading />);
    expect(
      screen.getByRole("heading", { name: "Reports" }),
    ).toBeInTheDocument();
  });
});

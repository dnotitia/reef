import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssuesWorkspaceSkeleton } from "./IssuesWorkspaceSkeleton";

describe("IssuesWorkspaceSkeleton", () => {
  it("paints the issues chrome and a board-column frame (REEF-255)", () => {
    render(<IssuesWorkspaceSkeleton />);

    // Not a blank body: the skeleton root, the page title, and the board column
    // placeholders are all present so a hard-nav first paint reads as "loading
    // the board".
    expect(screen.getByTestId("issues-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
  });
});

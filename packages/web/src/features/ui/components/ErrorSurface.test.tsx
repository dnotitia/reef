import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorSurface } from "./ErrorSurface";

describe("ErrorSurface", () => {
  it("renders the shared Reef error structure with one heading and named actions", () => {
    render(
      <ErrorSurface
        code="404"
        title="Page not found"
        description="The requested page is unavailable."
        actions={<a href="/">Go to reef home</a>}
      />,
    );

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByText("reef")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The requested page is unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to reef home" }),
    ).toHaveAttribute("href", "/");
  });
});

import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueryProvider } from "./QueryProvider";

function QueryClientConsumer() {
  const client = useQueryClient();
  return (
    <div data-testid="has-client">{client ? "client-available" : "none"}</div>
  );
}

describe("QueryProvider", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <QueryProvider>
        <div>Hello</div>
      </QueryProvider>,
    );
    expect(container).toBeTruthy();
  });

  it("renders children", () => {
    render(
      <QueryProvider>
        <div data-testid="child">child content</div>
      </QueryProvider>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("useQueryClient() is accessible inside QueryProvider", () => {
    render(
      <QueryProvider>
        <QueryClientConsumer />
      </QueryProvider>,
    );
    expect(screen.getByTestId("has-client").textContent).toBe(
      "client-available",
    );
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { TemplatePicker } from "./TemplatePicker";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("TemplatePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables the trigger when vault is empty (no fetch)", () => {
    render(wrap(<TemplatePicker vault="" onSelect={() => {}} />));
    expect(screen.getByTestId("template-picker-trigger")).toBeDisabled();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("respects the disabled prop", () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ entries: [] }), { status: 200 }),
    );

    render(
      wrap(<TemplatePicker vault="reef-acme" onSelect={() => {}} disabled />),
    );
    expect(screen.getByTestId("template-picker-trigger")).toBeDisabled();
  });

  it("renders the trigger when vault is set", () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ entries: [] }), { status: 200 }),
    );
    render(wrap(<TemplatePicker vault="reef-acme" onSelect={() => {}} />));
    expect(screen.getByTestId("template-picker-trigger")).not.toBeDisabled();
  });

  it("calls /api/templates?vault={vault} via the hook", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ entries: [] }), { status: 200 }),
    );

    render(wrap(<TemplatePicker vault="reef-acme" onSelect={() => {}} />));

    // useIssueTemplates fires immediately
    await Promise.resolve();
    await Promise.resolve();
    expect(mockApiFetch).toHaveBeenCalledWith("/api/templates?vault=reef-acme");
  });
});

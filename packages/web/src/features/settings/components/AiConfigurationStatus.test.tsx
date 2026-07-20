import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAiAvailableMock = vi.fn();

vi.mock("@/features/settings/hooks/useAiAvailable", () => ({
  useAiAvailable: () => useAiAvailableMock(),
}));

import { AiConfigurationStatus } from "./AiConfigurationStatus";

describe("AiConfigurationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the configured provider-neutral model", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: true,
      isLoading: false,
      model: "deepseek/deepseek-v4-flash",
    });

    render(<AiConfigurationStatus />);

    expect(
      screen.getByText("configured · deepseek/deepseek-v4-flash"),
    ).toBeInTheDocument();
  });

  it("shows a deployment-level unavailable state when unconfigured", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: false,
      isLoading: false,
      model: null,
    });

    render(<AiConfigurationStatus />);

    expect(screen.getByText("AI is not configured.")).toBeInTheDocument();
    expect(
      screen.getByText(/deployment-managed LLM endpoint/),
    ).toBeInTheDocument();
  });

  it("renders a skeleton placeholder while the status is loading (REEF-255)", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: false,
      isLoading: true,
      model: null,
    });

    render(<AiConfigurationStatus />);

    // The loading state is a skeleton matching the resolved status line, not the
    // old bare "Checking AI status…" text (REEF-255).
    expect(screen.getByTestId("ai-status-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Checking AI status…")).not.toBeInTheDocument();
  });
});

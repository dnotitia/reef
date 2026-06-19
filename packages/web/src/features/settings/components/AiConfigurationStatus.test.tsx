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

  it("shows the managed OpenRouter model when configured", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: true,
      isLoading: false,
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
    });

    render(<AiConfigurationStatus />);

    expect(
      screen.getByText("OpenRouter · deepseek/deepseek-v4-flash"),
    ).toBeInTheDocument();
  });

  it("shows a deployment-level unavailable state when unconfigured", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: false,
      isLoading: false,
      provider: "openrouter",
      model: null,
    });

    render(<AiConfigurationStatus />);

    expect(screen.getByText("AI is not configured.")).toBeInTheDocument();
    expect(screen.getByText(/This deployment needs/)).toBeInTheDocument();
  });

  it("renders a skeleton placeholder while the status is loading (REEF-255)", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: false,
      isLoading: true,
      provider: "openrouter",
      model: null,
    });

    render(<AiConfigurationStatus />);

    // The loading state is a skeleton matching the resolved status line, not the
    // old bare "Checking AI status…" text (REEF-255).
    expect(screen.getByTestId("ai-status-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Checking AI status…")).not.toBeInTheDocument();
  });
});

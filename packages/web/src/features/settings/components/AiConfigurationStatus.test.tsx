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

  it("uses a typographic ellipsis in the loading text (REEF-151)", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: false,
      isLoading: true,
      provider: "openrouter",
      model: null,
    });

    render(<AiConfigurationStatus />);

    expect(screen.getByText("Checking AI status…")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAiAvailableMock = vi.fn();
vi.mock("@/features/settings/hooks/useAiAvailable", () => ({
  useAiAvailable: () => useAiAvailableMock(),
}));

import { useAskAiStore } from "../stores/useAskAiStore";
import { AskAiFab } from "./AskAiFab";

describe("AskAiFab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAskAiStore.setState({ isOpen: false, seenMessageCount: 0 });
    useAiAvailableMock.mockReturnValue({
      isAvailable: true,
      isLoading: false,
    });
  });

  it("renders the FAB when AI is available", () => {
    render(<AskAiFab />);
    expect(screen.getByTestId("ask-ai-fab")).toBeInTheDocument();
  });

  it("hides the FAB while AI availability is loading", () => {
    useAiAvailableMock.mockReturnValue({ isAvailable: false, isLoading: true });
    const { container } = render(<AskAiFab />);
    expect(container.querySelector('[data-testid="ask-ai-fab"]')).toBeNull();
  });

  it("hides the FAB when AI is unavailable", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: false,
      isLoading: false,
    });
    const { container } = render(<AskAiFab />);
    expect(container.querySelector('[data-testid="ask-ai-fab"]')).toBeNull();
  });

  it("toggles the store when clicked", () => {
    render(<AskAiFab />);
    expect(useAskAiStore.getState().isOpen).toBe(false);
    fireEvent.click(screen.getByTestId("ask-ai-fab"));
    expect(useAskAiStore.getState().isOpen).toBe(true);
    fireEvent.click(screen.getByTestId("ask-ai-fab"));
    expect(useAskAiStore.getState().isOpen).toBe(false);
  });

  it("warms the lazy panel chunk on hover and focus (REEF-097 AC3)", () => {
    const onPreload = vi.fn();
    render(<AskAiFab onPreload={onPreload} />);
    const fab = screen.getByTestId("ask-ai-fab");

    fireEvent.mouseEnter(fab);
    fireEvent.focus(fab);
    expect(onPreload).toHaveBeenCalledTimes(2);
  });

  it("shows the unread dot when new messages arrive while closed", () => {
    useAskAiStore.setState({ isOpen: false, seenMessageCount: 2 });
    render(<AskAiFab messageCount={5} />);
    expect(screen.getByTestId("ask-ai-unread-dot")).toBeInTheDocument();
  });

  it("hides the unread dot when the panel is open", () => {
    useAskAiStore.setState({ isOpen: true, seenMessageCount: 0 });
    const { container } = render(<AskAiFab messageCount={5} />);
    expect(
      container.querySelector('[data-testid="ask-ai-unread-dot"]'),
    ).toBeNull();
  });

  it("hides the unread dot when message count is at-or-below seen count", () => {
    useAskAiStore.setState({ isOpen: false, seenMessageCount: 5 });
    const { container } = render(<AskAiFab messageCount={5} />);
    expect(
      container.querySelector('[data-testid="ask-ai-unread-dot"]'),
    ).toBeNull();
  });
});

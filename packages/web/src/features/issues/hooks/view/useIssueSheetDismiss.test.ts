import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIssueSheetDismiss } from "./useIssueSheetDismiss";

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  mockReplace.mockClear();
  useIssueNavStack.setState({ trail: [], currentId: null });
});

describe("useIssueSheetDismiss (REEF-270)", () => {
  it("reconciles a fresh open to a depth-0 trail (no Back)", () => {
    // Store still holds a stale trail from a previous drill.
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-A" });

    const { result } = renderHook(() =>
      useIssueSheetDismiss({ issueId: "REEF-Z", onExit: vi.fn() }),
    );

    // The mount effect reconciled the stale trail away; REEF-Z is depth 0.
    expect(result.current.backTo).toBeNull();
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-Z");
  });

  it("exposes the previous issue as backTo when the trail describes the screen", () => {
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-B" });

    const { result } = renderHook(() =>
      useIssueSheetDismiss({ issueId: "REEF-B", onExit: vi.fn() }),
    );

    expect(result.current.backTo).toBe("REEF-A");
  });

  it("Esc goes Back while drilled in, leaving the entry exit untouched (AC3)", () => {
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-B" });
    const onExit = vi.fn();

    const { result } = renderHook(() =>
      useIssueSheetDismiss({ issueId: "REEF-B", onExit }),
    );

    act(() => result.current.dismissViaEsc());

    expect(mockReplace).toHaveBeenCalledWith("/issues/REEF-A");
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("Esc closes to the entry view when there is no trail (AC3)", () => {
    useIssueNavStack.setState({ trail: [], currentId: "REEF-B" });
    const onExit = vi.fn();

    const { result } = renderHook(() =>
      useIssueSheetDismiss({ issueId: "REEF-B", onExit }),
    );

    act(() => result.current.dismissViaEsc());

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("exit clears the whole trail and leaves to the entry view (AC2)", () => {
    useIssueNavStack.setState({
      trail: ["REEF-A", "REEF-B"],
      currentId: "REEF-C",
    });
    const onExit = vi.fn();

    const { result } = renderHook(() =>
      useIssueSheetDismiss({ issueId: "REEF-C", onExit }),
    );

    act(() => result.current.exit());

    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

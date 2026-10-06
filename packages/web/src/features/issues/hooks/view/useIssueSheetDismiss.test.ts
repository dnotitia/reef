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
  useIssueNavStack.getState().clear();
  window.history.replaceState(null, "", "/");
});

describe("useIssueSheetDismiss (REEF-270)", () => {
  it("reconciles a fresh open to a depth-0 trail (no Back)", () => {
    // Store still holds a stale trail from a previous drill, on a different id.
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-A" });

    const { result } = renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "modal",
        issueId: "REEF-Z",
        vault: "reef-test",
        onExit: vi.fn(),
      }),
    );

    // The mount reconcile reset the stale trail away; REEF-Z is depth 0.
    expect(result.current.backTo).toBeNull();
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-Z");
  });

  it("starts at depth 0 when the session boundary cleared the trail", () => {
    // The @modal default slot clears on return-to-list, so opening again — even of
    // the id a stale trail was left on — arrives with currentId null.
    useIssueNavStack.setState({ trail: [], currentId: null });

    const { result } = renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "modal",
        issueId: "REEF-B",
        vault: "reef-test",
        onExit: vi.fn(),
      }),
    );

    expect(result.current.backTo).toBeNull();
    expect(useIssueNavStack.getState().trail).toEqual([]);
  });

  it("exposes the previous issue as backTo when the trail describes the screen", () => {
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-B" });

    const { result } = renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "modal",
        issueId: "REEF-B",
        vault: "reef-test",
        onExit: vi.fn(),
      }),
    );

    expect(result.current.backTo).toBe("REEF-A");
  });

  it("Esc goes Back while drilled in, leaving the entry exit untouched (AC3)", () => {
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-B" });
    const onExit = vi.fn();

    const { result } = renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "modal",
        issueId: "REEF-B",
        vault: "reef-test",
        onExit,
      }),
    );

    act(() => result.current.dismissViaEsc());

    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/reef-test/issues/REEF-A",
    );
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("builds Back routes from the owning workspace", () => {
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-B" });
    const { result } = renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "modal",
        issueId: "REEF-B",
        vault: "reef-e2e",
        onExit: vi.fn(),
      }),
    );

    act(() => result.current.goBack());

    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/reef-e2e/issues/REEF-A",
    );
  });

  it("Esc closes to the entry view when there is no trail (AC3)", () => {
    useIssueNavStack.setState({
      trail: [],
      currentId: "REEF-B",
      entryRoute: null,
      exitOwner: null,
    });
    const onExit = vi.fn();

    const { result } = renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "modal",
        issueId: "REEF-B",
        vault: "reef-test",
        onExit,
      }),
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
      useIssueSheetDismiss({
        entryRoute: "modal",
        issueId: "REEF-C",
        vault: "reef-test",
        onExit,
      }),
    );

    act(() => result.current.exit());

    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("keeps the deep-link exit owner when a relation route remounts the sheet", () => {
    const deepLinkExit = vi.fn();
    const interceptedRouteExit = vi.fn();

    renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "base",
        issueId: "REEF-103",
        vault: "reef-test",
        onExit: deepLinkExit,
      }),
    );
    useIssueNavStack.getState().drill("REEF-103", "REEF-102");
    const { result: parentSheet } = renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "modal",
        issueId: "REEF-102",
        vault: "reef-test",
        onExit: interceptedRouteExit,
      }),
    );

    act(() => parentSheet.current.exit());

    expect(deepLinkExit).toHaveBeenCalledTimes(1);
    expect(interceptedRouteExit).not.toHaveBeenCalled();
  });

  it("keeps Back inside the base sheet and replaces its URL in place", () => {
    useIssueNavStack.getState().drill("REEF-A", "REEF-B");
    const { result } = renderHook(() =>
      useIssueSheetDismiss({
        entryRoute: "base",
        issueId: "REEF-B",
        vault: "reef-test",
        onExit: vi.fn(),
      }),
    );

    act(() => result.current.goBack());

    expect(window.location.pathname).toBe("/workspace/reef-test/issues/REEF-A");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(useIssueNavStack.getState().currentId).toBe("REEF-A");
  });

  it("does not let an outgoing rerender reconcile over a recorded drill", () => {
    const firstExit = vi.fn();
    const replacementExit = vi.fn();
    const { rerender } = renderHook(
      ({ onExit }: { onExit: () => void }) =>
        useIssueSheetDismiss({
          entryRoute: "modal",
          issueId: "REEF-103",
          vault: "reef-test",
          onExit,
        }),
      { initialProps: { onExit: firstExit } },
    );

    act(() => {
      useIssueNavStack.getState().drill("REEF-103", "REEF-102");
      rerender({ onExit: replacementExit });
    });

    expect(useIssueNavStack.getState().trail).toEqual(["REEF-103"]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-102");
    expect(useIssueNavStack.getState().exitOwner).toBe(firstExit);
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/components/ui/toastFeedback", () => ({
  saveToastId: (id: string) => `save:${id}`,
  notifyRetryableError: vi.fn(),
  notifyConflict: vi.fn(),
}));

import {
  notifyConflict,
  notifyRetryableError,
} from "@/components/ui/toastFeedback";
import { useIssueAutosaveMachine } from "./useIssueAutosaveMachine";

const mockNotifyConflict = vi.mocked(notifyConflict);
const mockNotifyRetryableError = vi.mocked(notifyRetryableError);

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("useIssueAutosaveMachine — conflict handling (REEF-227)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a 409 document conflict as a non-retry notice, not a retryable error", async () => {
    const mutateIssue = vi.fn().mockRejectedValue(httpError(409));
    const { result } = renderHook(() =>
      useIssueAutosaveMachine({
        issueId: "REEF-001",
        vault: "reef-acme",
        mutateIssue,
      }),
    );

    await act(async () => {
      result.current.commit({ title: "stale edit" });
    });

    // A conflict settles out of the frozen save state so the refetched form can
    // re-sync — it does NOT park a retryable failure that would re-send the
    // stale edit against the advanced base.
    await waitFor(() => expect(result.current.saveStatus).toBe("idle"));
    expect(mockNotifyConflict).toHaveBeenCalledTimes(1);
    expect(mockNotifyRetryableError).not.toHaveBeenCalled();
    // The conflict signal bumps so the open form discards its rejected edit.
    expect(result.current.conflictCount).toBe(1);
  });

  it("keeps a non-conflict failure (500) retryable", async () => {
    const mutateIssue = vi.fn().mockRejectedValue(httpError(500));
    const { result } = renderHook(() =>
      useIssueAutosaveMachine({
        issueId: "REEF-001",
        vault: "reef-acme",
        mutateIssue,
      }),
    );

    await act(async () => {
      result.current.commit({ title: "edit" });
    });

    await waitFor(() => expect(result.current.saveStatus).toBe("error"));
    expect(mockNotifyRetryableError).toHaveBeenCalledTimes(1);
    expect(mockNotifyConflict).not.toHaveBeenCalled();
    expect(result.current.conflictCount).toBe(0);
  });
});

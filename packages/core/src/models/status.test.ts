import { describe, expect, it } from "vitest";
import type { IssueCreateInput } from "../schemas/issues/metadata";
import {
  ACTIVE_STATUSES,
  DEFAULT_STALE_HIDE_CANCELED_DAYS,
  DEFAULT_STALE_HIDE_COMPLETED_DAYS,
  STALE_CANCELED_WINDOW_MS,
  STALE_COMPLETED_WINDOW_MS,
  canTransition,
  inferStatusFromCodeSignal,
  isForwardStatus,
  isResolvedStatus,
  isStaleResolved,
  withRecoveredDraftStatus,
} from "./status";

describe("canTransition", () => {
  describe("allowed forward transitions", () => {
    it("open → in_progress", () => {
      expect(canTransition("todo", "in_progress")).toBe(true);
    });
    it("open → closed", () => {
      expect(canTransition("todo", "closed")).toBe(true);
    });
    it("in_progress → in_review", () => {
      expect(canTransition("in_progress", "in_review")).toBe(true);
    });
    it("in_progress → closed", () => {
      expect(canTransition("in_progress", "closed")).toBe(true);
    });
    it("in_review → done", () => {
      expect(canTransition("in_review", "done")).toBe(true);
    });
    it("in_review → closed", () => {
      expect(canTransition("in_review", "closed")).toBe(true);
    });
    it("done → closed", () => {
      expect(canTransition("done", "closed")).toBe(true);
    });
  });

  describe("disallowed regressions", () => {
    it("in_progress → open (regression)", () => {
      expect(canTransition("in_progress", "todo")).toBe(false);
    });
    it("in_review → in_progress (regression)", () => {
      expect(canTransition("in_review", "in_progress")).toBe(false);
    });
    it("in_review → open (regression)", () => {
      expect(canTransition("in_review", "todo")).toBe(false);
    });
    it("done → open (no implicit reopening)", () => {
      expect(canTransition("done", "todo")).toBe(false);
    });
    it("done → in_progress (regression)", () => {
      expect(canTransition("done", "in_progress")).toBe(false);
    });
    it("done → in_review (regression)", () => {
      expect(canTransition("done", "in_review")).toBe(false);
    });
  });

  describe("closed is terminal", () => {
    it("closed → open", () => {
      expect(canTransition("closed", "todo")).toBe(false);
    });
    it("closed → in_progress", () => {
      expect(canTransition("closed", "in_progress")).toBe(false);
    });
    it("closed → in_review", () => {
      expect(canTransition("closed", "in_review")).toBe(false);
    });
    it("closed → done", () => {
      expect(canTransition("closed", "done")).toBe(false);
    });
  });

  describe("self-transitions are not allowed", () => {
    it("open → open", () => expect(canTransition("todo", "todo")).toBe(false));
    it("in_progress → in_progress", () =>
      expect(canTransition("in_progress", "in_progress")).toBe(false));
    it("in_review → in_review", () =>
      expect(canTransition("in_review", "in_review")).toBe(false));
    it("done → done", () => expect(canTransition("done", "done")).toBe(false));
    it("closed → closed", () =>
      expect(canTransition("closed", "closed")).toBe(false));
  });

  describe("forward skips are not allowed", () => {
    it("open → in_review (skip)", () =>
      expect(canTransition("todo", "in_review")).toBe(false));
    it("open → done (skip)", () =>
      expect(canTransition("todo", "done")).toBe(false));
    it("in_progress → done (skip — must pass review)", () =>
      expect(canTransition("in_progress", "done")).toBe(false));
  });
});

describe("inferStatusFromCodeSignal", () => {
  it("branch_created → in_progress", () => {
    expect(inferStatusFromCodeSignal("branch_created")).toBe("in_progress");
  });
  it("pr_created → in_review", () => {
    expect(inferStatusFromCodeSignal("pr_created")).toBe("in_review");
  });
  it("pr_merged → done", () => {
    expect(inferStatusFromCodeSignal("pr_merged")).toBe("done");
  });
});

describe("isForwardStatus", () => {
  it("allows single-step forward moves", () => {
    expect(isForwardStatus("todo", "in_progress")).toBe(true);
    expect(isForwardStatus("in_progress", "in_review")).toBe(true);
    expect(isForwardStatus("in_review", "done")).toBe(true);
  });

  it("allows multi-step forward jumps (unlike canTransition)", () => {
    expect(isForwardStatus("in_progress", "done")).toBe(true);
    expect(isForwardStatus("todo", "done")).toBe(true);
    expect(isForwardStatus("todo", "in_review")).toBe(true);
    // Contrast: the single-step state machine forbids these jumps.
    expect(canTransition("in_progress", "done")).toBe(false);
  });

  it("rejects backward moves and self-transitions", () => {
    expect(isForwardStatus("done", "in_progress")).toBe(false);
    expect(isForwardStatus("in_review", "todo")).toBe(false);
    expect(isForwardStatus("in_progress", "in_progress")).toBe(false);
    expect(isForwardStatus("done", "done")).toBe(false);
  });

  it("treats closed as terminal (highest rank)", () => {
    expect(isForwardStatus("done", "closed")).toBe(true);
    expect(isForwardStatus("todo", "closed")).toBe(true);
    expect(isForwardStatus("closed", "done")).toBe(false);
    expect(isForwardStatus("closed", "todo")).toBe(false);
  });

  it("ranks backlog before every other status (REEF-109)", () => {
    // Leaving the backlog is consistently forward; nothing moves *back* into it, so
    // the AI forward-moving guard can not suggest demoting an issue to backlog.
    expect(isForwardStatus("backlog", "todo")).toBe(true);
    expect(isForwardStatus("backlog", "in_progress")).toBe(true);
    expect(isForwardStatus("backlog", "done")).toBe(true);
    expect(isForwardStatus("todo", "backlog")).toBe(false);
    expect(isForwardStatus("in_progress", "backlog")).toBe(false);
    expect(isForwardStatus("backlog", "backlog")).toBe(false);
  });
});

describe("isResolvedStatus", () => {
  it("treats done and closed as resolved", () => {
    expect(isResolvedStatus("done")).toBe(true);
    expect(isResolvedStatus("closed")).toBe(true);
  });

  it("treats open lifecycle statuses as unresolved", () => {
    expect(isResolvedStatus("todo")).toBe(false);
    expect(isResolvedStatus("in_progress")).toBe(false);
    expect(isResolvedStatus("in_review")).toBe(false);
  });

  it("treats backlog as unresolved — uncommitted, not done (REEF-109)", () => {
    expect(isResolvedStatus("backlog")).toBe(false);
  });
});

describe("ACTIVE_STATUSES (REEF-109)", () => {
  it("is exactly the committed, in-flight lifecycle statuses", () => {
    expect([...ACTIVE_STATUSES]).toEqual(["todo", "in_progress", "in_review"]);
  });

  it("excludes backlog and the resolved states", () => {
    expect(ACTIVE_STATUSES).not.toContain("backlog");
    expect(ACTIVE_STATUSES).not.toContain("done");
    expect(ACTIVE_STATUSES).not.toContain("closed");
  });
});

describe("withRecoveredDraftStatus (REEF-130)", () => {
  const draftCreate = (
    status?: "backlog" | "todo" | "done",
  ): IssueCreateInput => ({
    fields: { title: "Draft", ...(status ? { status } : {}) },
    content: "",
  });

  it("recovers in_progress from a commit provenance when status is absent", () => {
    expect(
      withRecoveredDraftStatus(draftCreate(), "commit").fields.status,
    ).toBe("in_progress");
  });

  it("recovers in_review from a pr provenance when status is absent", () => {
    expect(withRecoveredDraftStatus(draftCreate(), "pr").fields.status).toBe(
      "in_review",
    );
  });

  it("leaves an explicit status untouched and returns the same payload", () => {
    const input = draftCreate("done");
    const out = withRecoveredDraftStatus(input, "pr");
    expect(out.fields.status).toBe("done");
    expect(out).toBe(input);
  });
});

describe("isStaleResolved", () => {
  // A fixed "now" so the windows are exercised deterministically (no Date.now()).
  const NOW = Date.parse("2026-06-19T00:00:00Z");
  const daysAgo = (days: number): string =>
    new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

  it("is never stale for an active (non-resolved) status", () => {
    for (const status of ACTIVE_STATUSES) {
      expect(
        isStaleResolved({ status, lastStatusChange: daysAgo(999), now: NOW }),
      ).toBe(false);
    }
    expect(
      isStaleResolved({
        status: "backlog",
        lastStatusChange: daysAgo(999),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("is never stale without a parseable anchor (legacy rows stay visible)", () => {
    expect(isStaleResolved({ status: "done", now: NOW })).toBe(false);
    expect(
      isStaleResolved({ status: "done", lastStatusChange: null, now: NOW }),
    ).toBe(false);
    expect(
      isStaleResolved({
        status: "closed",
        lastStatusChange: "not-a-date",
        now: NOW,
      }),
    ).toBe(false);
  });

  it("hides a done issue only past the 28-day completed window", () => {
    expect(
      isStaleResolved({
        status: "done",
        lastStatusChange: daysAgo(27),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isStaleResolved({
        status: "done",
        lastStatusChange: daysAgo(29),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("treats closed+completed as the completed bucket (28 days)", () => {
    const base = {
      status: "closed" as const,
      closedReason: "completed" as const,
      now: NOW,
    };
    expect(isStaleResolved({ ...base, lastStatusChange: daysAgo(20) })).toBe(
      false,
    );
    expect(isStaleResolved({ ...base, lastStatusChange: daysAgo(40) })).toBe(
      true,
    );
  });

  it("uses the shorter 7-day canceled window for non-completed close reasons", () => {
    for (const reason of [
      "duplicate",
      "wont_fix",
      "invalid",
      "stale",
    ] as const) {
      expect(
        isStaleResolved({
          status: "closed",
          closedReason: reason,
          lastStatusChange: daysAgo(6),
          now: NOW,
        }),
      ).toBe(false);
      expect(
        isStaleResolved({
          status: "closed",
          closedReason: reason,
          lastStatusChange: daysAgo(8),
          now: NOW,
        }),
      ).toBe(true);
    }
  });

  it("treats a closed issue with no reason as the canceled bucket (7 days)", () => {
    expect(
      isStaleResolved({
        status: "closed",
        closedReason: null,
        lastStatusChange: daysAgo(10),
        now: NOW,
      }),
    ).toBe(true);
    // …and a completed-bucket age (between the two windows) would NOT hide it if
    // it were completed — confirming the bucket split actually bites.
    expect(
      isStaleResolved({
        status: "closed",
        closedReason: "completed",
        lastStatusChange: daysAgo(10),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("exposes the two windows as completed > canceled (Linear's 28 vs 7 default)", () => {
    expect(DEFAULT_STALE_HIDE_COMPLETED_DAYS).toBe(28);
    expect(DEFAULT_STALE_HIDE_CANCELED_DAYS).toBe(7);
    expect(STALE_COMPLETED_WINDOW_MS).toBe(28 * 24 * 60 * 60 * 1000);
    expect(STALE_CANCELED_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(STALE_COMPLETED_WINDOW_MS).toBeGreaterThan(STALE_CANCELED_WINDOW_MS);
  });

  it("uses caller-provided workspace window days", () => {
    expect(
      isStaleResolved({
        status: "done",
        lastStatusChange: daysAgo(10),
        now: NOW,
        completedWindowDays: 5,
      }),
    ).toBe(true);
    expect(
      isStaleResolved({
        status: "closed",
        closedReason: "wont_fix",
        lastStatusChange: daysAgo(3),
        now: NOW,
        canceledWindowDays: 2,
      }),
    ).toBe(true);
  });

  it("falls back to default windows for invalid caller-provided days", () => {
    expect(
      isStaleResolved({
        status: "done",
        lastStatusChange: daysAgo(20),
        now: NOW,
        completedWindowDays: -1,
      }),
    ).toBe(false);
    expect(
      isStaleResolved({
        status: "closed",
        closedReason: "wont_fix",
        lastStatusChange: daysAgo(10),
        now: NOW,
        canceledWindowDays: Number.NaN,
      }),
    ).toBe(true);
  });
});

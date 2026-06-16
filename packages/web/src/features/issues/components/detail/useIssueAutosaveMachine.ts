"use client";

import {
  notifyRetryableError,
  saveToastId,
} from "@/components/ui/toastFeedback";
import type { IssueUpdatePatch } from "@reef/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { SaveStatus } from "./IssueSaveStatus";

/** How long the transient "Saved" confirmation stays before fading to idle. */
const SAVED_INDICATOR_MS = 1500;

interface FailedCommit {
  patch: IssueUpdatePatch;
  content?: string;
  issueId: string;
  vault: string;
}

interface AutosaveSnapshot {
  status: SaveStatus;
}

interface UpdateIssueInput {
  id: string;
  vault: string;
  patch: IssueUpdatePatch;
  content?: string;
}

type MutateIssue = (input: UpdateIssueInput) => Promise<unknown>;

// A later auto-save resolves an earlier failure when it re-writes the same
// target: a body edit (carries `content`) or an overlapping field key. An
// unrelated success should not clear another field's pending failure.
function commitsOverlap(
  failed: FailedCommit,
  patch: IssueUpdatePatch,
  content: string | undefined,
): boolean {
  if (content !== undefined && failed.content !== undefined) return true;
  const failedKeys = Object.keys(failed.patch);
  if (failedKeys.length === 0) return false;
  const keys = new Set(Object.keys(patch));
  return failedKeys.some((k) => keys.has(k));
}

class IssueAutosaveMachine {
  private disposed = false;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private failedCommits: FailedCommit[] = [];
  private listeners = new Set<() => void>();
  private pendingCommits = 0;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: AutosaveSnapshot = { status: "idle" };
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly target: { issueId: string; vault: string },
    private readonly mutateIssue: MutateIssue,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AutosaveSnapshot => this.snapshot;

  activate(): void {
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    this.disposed = false;
  }

  commit = (patch: IssueUpdatePatch, content?: string): void => {
    if (this.disposed) return;
    const commit: FailedCommit = {
      patch,
      content,
      issueId: this.target.issueId,
      vault: this.target.vault,
    };

    this.pendingCommits += 1;
    this.clearSavedTimer();
    this.setStatus("saving");

    const run = () =>
      this.mutateIssue({
        id: commit.issueId,
        vault: commit.vault,
        patch,
        ...(content !== undefined ? { content } : {}),
      });

    this.tail = this.tail
      .catch(() => {})
      .then(run)
      .then(
        () => this.resolveCommit(commit),
        (err: unknown) => this.rejectCommit(commit, err),
      );
  };

  retry = (): void => {
    if (this.disposed) return;
    const failures = [...this.failedCommits];
    if (failures.length === 0) return;
    for (const failed of failures) {
      this.commit(failed.patch, failed.content);
    }
  };

  scheduleDispose(): void {
    if (this.disposeTimer) return;
    // React Strict Mode replays effect cleanup/setup on the same state
    // instance in development. Deferring lets the setup pass cancel that
    // rehearsal cleanup, while a real unmount still disposes on the next tick.
    this.disposeTimer = setTimeout(() => {
      this.disposeTimer = null;
      this.dispose();
    }, 0);
  }

  private dispose(): void {
    this.disposed = true;
    this.clearSavedTimer();
    this.failedCommits = [];
    this.pendingCommits = 0;
    this.tail = Promise.resolve();
    toast.dismiss(saveToastId(this.target.issueId));
    this.listeners.clear();
  }

  private resolveCommit(commit: FailedCommit): void {
    if (this.disposed) return;
    this.pendingCommits -= 1;
    this.failedCommits = this.failedCommits.filter(
      (f) => !commitsOverlap(f, commit.patch, commit.content),
    );

    if (this.pendingCommits > 0) return;
    if (this.failedCommits.length > 0) {
      this.setStatus("error");
      return;
    }

    toast.dismiss(saveToastId(commit.issueId));
    this.setStatus("saved");
    this.savedTimer = setTimeout(() => {
      if (this.disposed) return;
      this.setStatus("idle");
      this.savedTimer = null;
    }, SAVED_INDICATOR_MS);
  }

  private rejectCommit(commit: FailedCommit, err: unknown): void {
    if (this.disposed) return;
    this.pendingCommits -= 1;
    this.failedCommits = [
      ...this.failedCommits.filter(
        (f) => !commitsOverlap(f, commit.patch, commit.content),
      ),
      commit,
    ];
    this.setStatus("error");
    notifyRetryableError({
      id: saveToastId(commit.issueId),
      title:
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save changes",
      description: "Your changes weren't saved. Retry to try again.",
      onRetry: this.retry,
    });
  }

  private clearSavedTimer(): void {
    if (!this.savedTimer) return;
    clearTimeout(this.savedTimer);
    this.savedTimer = null;
  }

  private setStatus(status: SaveStatus): void {
    if (this.snapshot.status === status) return;
    this.snapshot = { status };
    for (const listener of this.listeners) listener();
  }
}

export function useIssueAutosaveMachine({
  issueId,
  vault,
  mutateIssue,
}: {
  issueId: string;
  vault: string;
  mutateIssue: MutateIssue;
}) {
  const [machine] = useState(
    () => new IssueAutosaveMachine({ issueId, vault }, mutateIssue),
  );
  useEffect(() => {
    machine.activate();
    return () => machine.scheduleDispose();
  }, [machine]);

  const snapshot = useSyncExternalStore(
    machine.subscribe,
    machine.getSnapshot,
    machine.getSnapshot,
  );

  return {
    commit: machine.commit,
    retryFailedCommits: machine.retry,
    saveStatus: snapshot.status,
  };
}

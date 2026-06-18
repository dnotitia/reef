// @vitest-environment node
import type { IssueDocument, IssueMetadata } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  createIssueDetailDraft,
  issueDetailDraftReducer,
} from "./IssueDetailDraft";

function makeDoc(over: Partial<IssueMetadata>, content = ""): IssueDocument {
  return {
    issue: {
      id: "REEF-001",
      title: "Title",
      status: "todo",
      created_at: "2026-05-01T00:00:00.000Z",
      created_by: "alice",
      updated_at: "2026-05-01T00:00:00.000Z",
      updated_by: "alice",
      ...over,
    },
    content,
  };
}

// The form-resync path REEF-227 root-cause #2 depends on: a background refetch
// brings a newer server snapshot while the same issue stays open, and the 3-way
// merge pulls it into fields the user has not touched without clobbering their
// in-flight edits. These guard that contract directly (the wiring effect is in
// IssueDetail.tsx; this reducer is its heart).
describe("issueDetailDraftReducer sync (REEF-227 form re-sync)", () => {
  it("pulls a newer server value into a field the user has not edited", () => {
    const previous = createIssueDetailDraft(makeDoc({ title: "Old" }));
    const next = createIssueDetailDraft(makeDoc({ title: "External edit" }));
    // state === previous: the form is idle (no local edits since the snapshot).
    const result = issueDetailDraftReducer(previous, {
      type: "sync",
      previous,
      next,
    });
    expect(result.title).toBe("External edit");
  });

  it("keeps a field the user edited since the last snapshot (no clobber)", () => {
    const previous = createIssueDetailDraft(makeDoc({ title: "Old" }));
    const dirty = { ...previous, title: "User typing" };
    const next = createIssueDetailDraft(makeDoc({ title: "External edit" }));
    const result = issueDetailDraftReducer(dirty, {
      type: "sync",
      previous,
      next,
    });
    expect(result.title).toBe("User typing");
  });

  it("re-syncs the body when it changed externally and is not dirty", () => {
    const previous = createIssueDetailDraft(makeDoc({}, "old body"));
    const next = createIssueDetailDraft(makeDoc({}, "external body"));
    const result = issueDetailDraftReducer(previous, {
      type: "sync",
      previous,
      next,
    });
    expect(result.body).toBe("external body");
  });

  it("is a no-op when the server snapshot did not change", () => {
    const previous = createIssueDetailDraft(makeDoc({ title: "Same" }));
    const next = createIssueDetailDraft(makeDoc({ title: "Same" }));
    const result = issueDetailDraftReducer(previous, {
      type: "sync",
      previous,
      next,
    });
    expect(result).toBe(previous); // same reference — nothing to update
  });

  it("reset discards a dirty conflicted field and shows the server value", () => {
    const server = createIssueDetailDraft(makeDoc({ title: "External edit" }));
    const dirty = { ...server, title: "My rejected edit" };
    // On a conflict the form resets wholesale, so the rejected local value is
    // dropped — it can no longer be re-saved over the change that won.
    const result = issueDetailDraftReducer(dirty, {
      type: "reset",
      next: server,
    });
    expect(result).toBe(server);
    expect(result.title).toBe("External edit");
  });
});

import { describe, expect, it } from "vitest";
import type { JiraImportedCommentInput } from "./contracts.js";
import {
  commentOperationInput,
  descriptionOperationInput,
  relatedOperation,
} from "./operations.js";

describe("related operation approval identities", () => {
  it("preserves attachment identity across dry-run and apply URIs", () => {
    const source = (id: string) => ({ id }) as never;
    const dryBindings = [
      { source: source("100"), fileUri: "dry-run://attachment/100" },
      { source: source("200"), fileUri: "dry-run://attachment/200" },
    ];
    const applyBindings = [
      { source: source("100"), fileUri: "akb://vault/coll/file/a" },
      { source: source("200"), fileUri: "akb://vault/coll/file/b" },
    ];
    const dryInput = descriptionOperationInput(
      "![a](dry-run://attachment/100) ![b](dry-run://attachment/200)",
      dryBindings,
    );
    const applyInput = descriptionOperationInput(
      "![a](akb://vault/coll/file/a) ![b](akb://vault/coll/file/b)",
      applyBindings,
    );
    const redirectedInput = descriptionOperationInput(
      "![a](akb://vault/coll/file/b) ![b](akb://vault/coll/file/a)",
      applyBindings,
    );

    expect(
      relatedOperation("update_description", "REEF-001", applyInput),
    ).toEqual(relatedOperation("update_description", "REEF-001", dryInput));
    expect(
      relatedOperation("update_description", "REEF-001", redirectedInput),
    ).not.toEqual(relatedOperation("update_description", "REEF-001", dryInput));
  });

  it("distinguishes redirected comment parents", () => {
    const input: JiraImportedCommentInput = {
      idempotencyKey: "comment-key",
      reefId: "REEF-001",
      body: "reply",
      author: "jira-import",
      createdAt: "2026-07-23T00:00:00.000Z",
      editedAt: null,
      parentCommentId: "dynamic-target",
      expectedThreadRootId: "dynamic-root",
    };

    expect(
      relatedOperation(
        "create_comment",
        input.idempotencyKey,
        commentOperationInput(input, "parent-1"),
      ),
    ).not.toEqual(
      relatedOperation(
        "create_comment",
        input.idempotencyKey,
        commentOperationInput(input, "parent-2"),
      ),
    );
  });
});

import { describe, expect, it } from "vitest";
import type { StatusChangeEvidence } from "../../schemas/activity/pendingDraft";
import type { ImplementationRef } from "../../schemas/issues/metadata";
import {
  implementationRefsFromStatusEvidence,
  mergeImplementationRefs,
} from "./artifacts";

const DETECTED_AT = "2026-05-01T00:00:00.000Z";

describe("implementationRefsFromStatusEvidence", () => {
  it("maps a PR evidence item to a pull_request ref with a synthesized url", () => {
    const evidence: StatusChangeEvidence[] = [
      { type: "pr", ref: "42", repo: "octo/cat", actor: "alice" },
    ];

    expect(implementationRefsFromStatusEvidence(evidence, DETECTED_AT)).toEqual(
      [
        {
          type: "pull_request",
          repo: "octo/cat",
          ref: "42",
          actor: "alice",
          detected_at: DETECTED_AT,
          url: "https://github.com/octo/cat/pull/42",
        },
      ],
    );
  });

  it("maps a commit evidence item to a commit ref with a synthesized url", () => {
    const evidence: StatusChangeEvidence[] = [
      { type: "commit", ref: "abc123", repo: "octo/cat", actor: "bob" },
    ];

    expect(implementationRefsFromStatusEvidence(evidence, DETECTED_AT)).toEqual(
      [
        {
          type: "commit",
          repo: "octo/cat",
          ref: "abc123",
          actor: "bob",
          detected_at: DETECTED_AT,
          url: "https://github.com/octo/cat/commit/abc123",
        },
      ],
    );
  });

  it("does not emit branch refs (status evidence carries no branch)", () => {
    const refs = implementationRefsFromStatusEvidence(
      [
        { type: "pr", ref: "7", repo: "octo/cat", actor: "alice" },
        { type: "commit", ref: "deadbeef", repo: "octo/cat", actor: "alice" },
      ],
      DETECTED_AT,
    );
    expect(refs.map((ref) => ref.type)).toEqual(["pull_request", "commit"]);
  });
});

describe("mergeImplementationRefs", () => {
  const prRef: ImplementationRef = {
    type: "pull_request",
    repo: "octo/cat",
    ref: "42",
    actor: "alice",
    detected_at: DETECTED_AT,
    url: "https://github.com/octo/cat/pull/42",
  };

  it("appends incoming refs when there are no existing ones", () => {
    expect(mergeImplementationRefs(undefined, [prRef])).toEqual([prRef]);
  });

  it("de-duplicates on type:repo:ref so re-approving never doubles an entry", () => {
    const merged = mergeImplementationRefs([prRef], [prRef]);
    expect(merged).toEqual([prRef]);
  });

  it("leaves unrelated existing refs untouched while adding the new one", () => {
    const existing: ImplementationRef = {
      type: "commit",
      repo: "octo/cat",
      ref: "feedface",
      actor: "carol",
    };
    const merged = mergeImplementationRefs([existing], [prRef]);
    expect(merged).toEqual([existing, prRef]);
  });

  it("treats the same ref under a different type as distinct", () => {
    const commitRef: ImplementationRef = {
      type: "commit",
      repo: "octo/cat",
      ref: "42",
      actor: "alice",
    };
    const merged = mergeImplementationRefs([prRef], [commitRef]);
    expect(merged).toEqual([prRef, commitRef]);
  });
});

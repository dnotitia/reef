import { describe, expect, it } from "vitest";
import {
  AddIssueReferenceRequestSchema,
  AkbDocumentReferenceSchema,
  IssueReferencesResponseSchema,
} from "./references";

describe("AddIssueReferenceRequestSchema", () => {
  it("accepts a canonical akb:// URI", () => {
    expect(
      AddIssueReferenceRequestSchema.safeParse({
        target_uri: "akb://v/coll/overview/doc/spec.md",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-akb URL so a web link can't masquerade as a reference", () => {
    expect(
      AddIssueReferenceRequestSchema.safeParse({
        target_uri: "https://example.com/spec",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty target", () => {
    expect(
      AddIssueReferenceRequestSchema.safeParse({ target_uri: "" }).success,
    ).toBe(false);
  });

  it("rejects a non-document akb URI (table/file) so only documents link", () => {
    expect(
      AddIssueReferenceRequestSchema.safeParse({
        target_uri: "akb://v/table/pipeline",
      }).success,
    ).toBe(false);
    expect(
      AddIssueReferenceRequestSchema.safeParse({
        target_uri: "akb://v/file/abc-123",
      }).success,
    ).toBe(false);
  });
});

describe("AkbDocumentReferenceSchema", () => {
  it("allows an absent or null title (cross-vault unresolved name)", () => {
    expect(
      AkbDocumentReferenceSchema.safeParse({ uri: "akb://v/doc/x.md" }).success,
    ).toBe(true);
    expect(
      AkbDocumentReferenceSchema.safeParse({
        uri: "akb://v/doc/x.md",
        title: null,
      }).success,
    ).toBe(true);
  });

  it("requires a non-empty uri", () => {
    expect(AkbDocumentReferenceSchema.safeParse({ uri: "" }).success).toBe(
      false,
    );
  });
});

describe("IssueReferencesResponseSchema", () => {
  it("wraps a list of references", () => {
    const parsed = IssueReferencesResponseSchema.parse({
      references: [
        { uri: "akb://v/doc/x.md", title: "X", resource_type: "doc" },
      ],
    });
    expect(parsed.references).toHaveLength(1);
  });
});

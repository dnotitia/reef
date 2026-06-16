import { describe, expect, it } from "vitest";
import {
  ExternalRefSchema,
  ExternalRefTypeEnum,
  IssueChangeProposalSchema,
  IssueCreateInputSchema,
  IssueDocumentSchema,
  IssueListItemSchema,
  IssueMetadataSchema,
  IssueSearchResultMetadataSchema,
  IssueUpdateInputSchema,
} from "./metadata";

const metadata = {
  id: "REEF-001",
  title: "Fix login",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
  issue_type: "bug",
  priority: "high",
  labels: ["auth"],
  source: "user:create_issue",
  external_refs: [{ type: "url", url: "https://example.com" }],
} as const;

describe("IssueMetadataSchema lineage", () => {
  it("parses canonical issue metadata", () => {
    expect(IssueMetadataSchema.parse(metadata).id).toBe("REEF-001");
  });

  it("derives document shape from issue metadata plus content", () => {
    expect(
      IssueDocumentSchema.parse({ issue: metadata, content: "## Body" }),
    ).toMatchObject({ content: "## Body" });
  });

  it("projects list items without hidden detail-only fields", () => {
    const item = IssueListItemSchema.parse(metadata);
    expect(item).toMatchObject({ id: "REEF-001", title: "Fix login" });
    expect(item).not.toHaveProperty("source");
    expect(item).not.toHaveProperty("external_refs");
  });

  it("derives model-facing search metadata from canonical issue metadata", () => {
    const item = IssueSearchResultMetadataSchema.parse(metadata);
    expect(item).toMatchObject({ id: "REEF-001", title: "Fix login" });
    expect(item).not.toHaveProperty("created_by");
    expect(item).not.toHaveProperty("updated_by");
    expect(item).not.toHaveProperty("source");
  });

  it("parses create input as fields plus content", () => {
    const parsed = IssueCreateInputSchema.parse({
      fields: { title: "Create me", labels: ["triage"] },
      content: "Markdown content",
    });
    expect(parsed.fields.title).toBe("Create me");
  });

  it("accepts an explicit non-closed status on create input (REEF-130)", () => {
    const parsed = IssueCreateInputSchema.parse({
      fields: { title: "From a merged PR", status: "done" },
      content: "",
    });
    expect(parsed.fields.status).toBe("done");
  });

  it("rejects `closed` on create input — closing needs the dedicated close flow (REEF-130)", () => {
    expect(() =>
      IssueCreateInputSchema.parse({
        fields: { title: "Sneaky close", status: "closed" },
        content: "",
      }),
    ).toThrow();
  });

  it("parses general update input with status as an ordinary patch field", () => {
    const parsed = IssueUpdateInputSchema.parse({
      issue_id: "REEF-001",
      patch: { status: "done" },
    });
    expect(parsed.patch.status).toBe("done");
  });

  it("parses create and update proposals through the same proposal schema", () => {
    expect(
      IssueChangeProposalSchema.parse({
        operation: "create",
        create: { fields: { title: "AI draft" }, content: "Draft content" },
      }).operation,
    ).toBe("create");

    expect(
      IssueChangeProposalSchema.parse({
        operation: "update",
        update: { issue_id: "REEF-001", patch: { assigned_to: "bob" } },
      }).operation,
    ).toBe("update");
  });
});

describe("ExternalRefSchema document → references migration (REEF-083)", () => {
  it("no longer offers `document` as a fresh external_ref kind", () => {
    expect(ExternalRefTypeEnum.options).not.toContain("document");
  });

  it("folds a older { type: 'document' } ref into 'other' so old rows still parse", () => {
    const parsed = ExternalRefSchema.parse({
      type: "document",
      ref: "akb://v/coll/overview/doc/spec.md",
      label: "Spec",
    });
    expect(parsed.type).toBe("other");
    expect(parsed.label).toBe("Spec");
  });

  it("keeps a non-akb kind untouched", () => {
    expect(ExternalRefSchema.parse({ type: "slack", ref: "#eng" }).type).toBe(
      "slack",
    );
  });
});

describe("IssueCreateInputSchema rank ownership (REEF-129)", () => {
  it("rejects a caller-supplied rank so manual order stays reorder-owned", () => {
    expect(
      IssueCreateInputSchema.safeParse({
        fields: { title: "New" },
        content: "",
      }).success,
    ).toBe(true);
    // `rank` is not a create field; the strict schema rejects it.
    expect(
      IssueCreateInputSchema.safeParse({
        fields: { title: "New", rank: 5 },
        content: "",
      }).success,
    ).toBe(false);
  });
});

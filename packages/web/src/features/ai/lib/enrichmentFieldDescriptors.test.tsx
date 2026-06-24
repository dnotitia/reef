import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { EnrichmentFieldEnum } from "@reef/core";
import type { EnrichmentField, EnrichmentSuggestion } from "@reef/core";
import { NO_SELECTION } from "@reef/core/fields";
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type EnrichmentFormApi,
  type EnrichmentFormValues,
  FIELD_DESCRIPTORS,
  applySuggestionToForm,
  fieldLabelKey,
  formatSuggestedValue,
} from "./enrichmentFieldDescriptors";

const EMPTY_VALUES: EnrichmentFormValues = {
  title: "",
  content: "",
  issueType: "task",
  priority: NO_SELECTION,
  assignee: "",
  requester: "",
  reporter: "",
  startDate: "",
  dueDate: "",
  milestoneId: "",
  sprintId: "",
  releaseId: "",
  estimatePoints: "",
  severity: "",
  parentId: "",
  labels: [],
  dependsOn: [],
  blocks: [],
  relatedTo: [],
  externalRefs: [],
};

function makeForm(
  values: Partial<EnrichmentFormValues> = {},
): EnrichmentFormApi & { setters: Record<string, ReturnType<typeof vi.fn>> } {
  const setters = {
    setTitle: vi.fn(),
    setBody: vi.fn(),
    setIssueType: vi.fn(),
    setPriority: vi.fn(),
    setAssignee: vi.fn(),
    setRequester: vi.fn(),
    setReporter: vi.fn(),
    setStartDate: vi.fn(),
    setDueDate: vi.fn(),
    setMilestoneId: vi.fn(),
    setSprintId: vi.fn(),
    setReleaseId: vi.fn(),
    setEstimatePoints: vi.fn(),
    setSeverity: vi.fn(),
    setParentId: vi.fn(),
    setLabels: vi.fn(),
    setDependsOn: vi.fn(),
    setBlocks: vi.fn(),
    setRelatedTo: vi.fn(),
    setExternalRefs: vi.fn(),
  };
  return {
    values: { ...EMPTY_VALUES, ...values },
    ...setters,
    setters,
  };
}

describe("FIELD_DESCRIPTORS", () => {
  it("has an entry for every enrichment field (exhaustive)", () => {
    for (const field of EnrichmentFieldEnum.options as EnrichmentField[]) {
      expect(FIELD_DESCRIPTORS[field]).toBeDefined();
      expect(typeof FIELD_DESCRIPTORS[field].labelKey).toBe("string");
    }
  });

  it("maps each field to a shared fieldNames catalog key (REEF-299)", () => {
    expect(fieldLabelKey("priority")).toBe("priority");
    expect(fieldLabelKey("due_date")).toBe("due");
    expect(fieldLabelKey("content")).toBe("description");
    expect(fieldLabelKey("external_refs")).toBe("externalRefs");
  });

  it("resolves the label key to a locale string through the catalog", () => {
    const { result } = renderHook(() => useFieldNameLabels());
    expect(result.current[fieldLabelKey("priority")]).toBe("Priority");
    expect(result.current[fieldLabelKey("due_date")]).toBe("Due");
    expect(result.current[fieldLabelKey("content")]).toBe("Description");
  });
});

describe("applySuggestionToForm", () => {
  it("routes a priority suggestion to setPriority", () => {
    const form = makeForm();
    const s: EnrichmentSuggestion = {
      field: "priority",
      value: "high",
      reasoning: "auth impact",
      confidence: 0.9,
    };
    applySuggestionToForm(form, s);
    expect(form.setters.setPriority).toHaveBeenCalledWith("high");
  });

  it("passes the labels array straight through to setLabels", () => {
    const form = makeForm();
    const s: EnrichmentSuggestion = {
      field: "labels",
      value: ["auth", "safari"],
      reasoning: "matched repo labels",
      confidence: 0.8,
    };
    applySuggestionToForm(form, s);
    expect(form.setters.setLabels).toHaveBeenCalledWith(["auth", "safari"]);
  });

  it("passes the blocks array straight through to setBlocks", () => {
    const form = makeForm();
    const s: EnrichmentSuggestion = {
      field: "blocks",
      value: ["REEF-002"],
      reasoning: "downstream work",
      confidence: 0.8,
    };
    applySuggestionToForm(form, s);
    expect(form.setters.setBlocks).toHaveBeenCalledWith(["REEF-002"]);
  });

  it("passes external_refs straight through to setExternalRefs", () => {
    const form = makeForm();
    const s: EnrichmentSuggestion = {
      field: "external_refs",
      value: [{ type: "url", url: "https://example.com/spec", label: "Spec" }],
      reasoning: "source material",
      confidence: 0.8,
    };
    applySuggestionToForm(form, s);
    expect(form.setters.setExternalRefs).toHaveBeenCalledWith([
      { type: "url", url: "https://example.com/spec", label: "Spec" },
    ]);
  });

  it("slices an ISO due_date to yyyy-mm-dd", () => {
    const form = makeForm();
    const s: EnrichmentSuggestion = {
      field: "due_date",
      value: "2026-06-10T00:00:00.000Z",
      reasoning: "sprint end",
      confidence: 0.5,
    };
    applySuggestionToForm(form, s);
    expect(form.setters.setDueDate).toHaveBeenCalledWith("2026-06-10");
  });

  it("stringifies estimate_points for the string-backed form field", () => {
    const form = makeForm();
    const s: EnrichmentSuggestion = {
      field: "estimate_points",
      value: 3,
      reasoning: "small",
      confidence: 0.7,
    };
    applySuggestionToForm(form, s);
    expect(form.setters.setEstimatePoints).toHaveBeenCalledWith("3");
  });
});

describe("formatSuggestedValue", () => {
  it("renders the issue-type label, not the raw enum", () => {
    render(
      <div>
        {formatSuggestedValue({
          field: "issue_type",
          value: "bug",
          reasoning: "",
          confidence: 1,
        })}
      </div>,
    );
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });

  it("renders each label as a chip", () => {
    render(
      <div>
        {formatSuggestedValue({
          field: "labels",
          value: ["auth", "safari"],
          reasoning: "",
          confidence: 0.9,
        })}
      </div>,
    );
    expect(screen.getByText("auth")).toBeInTheDocument();
    expect(screen.getByText("safari")).toBeInTheDocument();
  });
});

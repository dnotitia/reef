import type { EnrichmentSuggestion } from "@reef/core";
import { NO_SELECTION } from "@reef/core/fields";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EnrichmentFormApi,
  EnrichmentFormValues,
} from "../lib/enrichmentFieldDescriptors";
import { useInlineEnrichment } from "./useInlineEnrichment";

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

let setPriority: ReturnType<typeof vi.fn>;
let setLabels: ReturnType<typeof vi.fn>;
let setDueDate: ReturnType<typeof vi.fn>;
let form: EnrichmentFormApi;

beforeEach(() => {
  setPriority = vi.fn();
  setLabels = vi.fn();
  setDueDate = vi.fn();
  form = {
    values: EMPTY_VALUES,
    setTitle: vi.fn(),
    setBody: vi.fn(),
    setIssueType: vi.fn(),
    setPriority,
    setAssignee: vi.fn(),
    setRequester: vi.fn(),
    setReporter: vi.fn(),
    setStartDate: vi.fn(),
    setDueDate,
    setMilestoneId: vi.fn(),
    setSprintId: vi.fn(),
    setReleaseId: vi.fn(),
    setEstimatePoints: vi.fn(),
    setSeverity: vi.fn(),
    setParentId: vi.fn(),
    setLabels,
    setDependsOn: vi.fn(),
    setBlocks: vi.fn(),
    setRelatedTo: vi.fn(),
    setExternalRefs: vi.fn(),
  };
});

const PRIORITY_SUGGESTION: EnrichmentSuggestion = {
  field: "priority",
  value: "high",
  reasoning: "auth impact",
  confidence: 0.9,
};
const LABELS_SUGGESTION: EnrichmentSuggestion = {
  field: "labels",
  value: ["auth", "safari"],
  reasoning: "repo labels",
  confidence: 0.8,
};
const LOW_CONF_DUE: EnrichmentSuggestion = {
  field: "due_date",
  value: "2026-06-10T00:00:00.000Z",
  reasoning: "sprint end guess",
  confidence: 0.41,
};

describe("useInlineEnrichment", () => {
  it("ingests suggestions as pending and flags low confidence", () => {
    const { result } = renderHook(() => useInlineEnrichment(form));
    act(() => result.current.ingest([PRIORITY_SUGGESTION, LOW_CONF_DUE]));

    expect(result.current.hasAny).toBe(true);
    expect(result.current.counts.pending).toBe(2);
    expect(result.current.counts.needsReview).toBe(1);
    expect(result.current.getEntry("priority")?.status).toBe("pending");
    expect(result.current.getEntry("due_date")?.needsReview).toBe(true);
    expect(result.current.pendingFields).toEqual(["priority", "due_date"]);
  });

  it("accept applies to the form once and marks the field accepted", () => {
    const { result } = renderHook(() => useInlineEnrichment(form));
    act(() => result.current.ingest([PRIORITY_SUGGESTION]));
    act(() => result.current.accept("priority"));

    expect(setPriority).toHaveBeenCalledTimes(1);
    expect(setPriority).toHaveBeenCalledWith("high");
    expect(result.current.getEntry("priority")?.status).toBe("accepted");
    expect(result.current.counts).toMatchObject({ pending: 0, accepted: 1 });
  });

  it("accept is a no-op once the field is resolved", () => {
    const { result } = renderHook(() => useInlineEnrichment(form));
    act(() => result.current.ingest([PRIORITY_SUGGESTION]));
    act(() => result.current.accept("priority"));
    act(() => result.current.accept("priority"));
    expect(setPriority).toHaveBeenCalledTimes(1);
  });

  it("dismiss resolves the field without touching the form", () => {
    const { result } = renderHook(() => useInlineEnrichment(form));
    act(() => result.current.ingest([PRIORITY_SUGGESTION]));
    act(() => result.current.dismiss("priority"));

    expect(setPriority).not.toHaveBeenCalled();
    expect(result.current.getEntry("priority")?.status).toBe("dismissed");
    expect(result.current.counts).toMatchObject({ pending: 0, dismissed: 1 });
  });

  it("acceptAll applies every pending suggestion", () => {
    const { result } = renderHook(() => useInlineEnrichment(form));
    act(() =>
      result.current.ingest([
        PRIORITY_SUGGESTION,
        LABELS_SUGGESTION,
        LOW_CONF_DUE,
      ]),
    );
    act(() => result.current.acceptAll());

    expect(setPriority).toHaveBeenCalledWith("high");
    expect(setLabels).toHaveBeenCalledWith(["auth", "safari"]);
    expect(setDueDate).toHaveBeenCalledWith("2026-06-10");
    expect(result.current.counts).toMatchObject({ pending: 0, accepted: 3 });
  });

  it("dismissAll resolves every pending suggestion without applying", () => {
    const { result } = renderHook(() => useInlineEnrichment(form));
    act(() => result.current.ingest([PRIORITY_SUGGESTION, LABELS_SUGGESTION]));
    act(() => result.current.dismissAll());

    expect(setPriority).not.toHaveBeenCalled();
    expect(setLabels).not.toHaveBeenCalled();
    expect(result.current.counts).toMatchObject({ pending: 0, dismissed: 2 });
  });

  it("reset clears the map", () => {
    const { result } = renderHook(() => useInlineEnrichment(form));
    act(() => result.current.ingest([PRIORITY_SUGGESTION]));
    act(() => result.current.reset());
    expect(result.current.hasAny).toBe(false);
    expect(result.current.counts.pending).toBe(0);
  });
});

import type { EnrichmentFormApi } from "@/features/ai/lib/enrichmentFieldDescriptors";
import { apiFetch } from "@/lib/apiClient";
import type { IssueCreateFields } from "@reef/core";
import { NO_SELECTION } from "@reef/core/fields";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNewIssueEnrichment } from "./useNewIssueEnrichment";

vi.mock("@/lib/apiClient", () => ({
  apiFetch: vi.fn(),
}));

const mockApiFetch = vi.mocked(apiFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeFormApi(values: {
  title: string;
  content: string;
}): EnrichmentFormApi {
  return {
    values: {
      title: values.title,
      content: values.content,
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
    },
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
}

function createFields(title: string): IssueCreateFields {
  return {
    title,
    issue_type: "task",
    priority: null,
    assigned_to: null,
    requester: null,
    reporter: null,
    start_date: null,
    due_date: null,
    milestone_id: null,
    sprint_id: null,
    release_id: null,
    estimate_points: null,
    severity: null,
    parent_id: null,
    labels: [],
    depends_on: [],
    blocks: [],
    related_to: [],
    external_refs: [],
  };
}

describe("useNewIssueEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an AI-unavailable notice without calling enrichment", () => {
    const setSubmitError = vi.fn();
    const setReferenceCandidates = vi.fn();
    const { result } = renderHook(
      () =>
        useNewIssueEnrichment({
          vault: "reef-acme",
          prefix: "REEF",
          scanRepo: "",
          title: "Manual issue",
          body: "Draft body",
          estimatePoints: "",
          formApi: makeFormApi({
            title: "Manual issue",
            content: "Draft body",
          }),
          buildCreateFields: () => createFields("Manual issue"),
          setSubmitError,
          setReferenceCandidates,
          isAiAvailable: false,
          isAiAvailabilityLoading: false,
          aiUnavailableMessage:
            "AI is unavailable for this deployment. You can still create the issue manually.",
        }),
      { wrapper: createWrapper() },
    );

    act(() => result.current.handleEnrichClick());

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(setSubmitError).toHaveBeenCalledWith(null);
    expect(result.current.showEnrichmentBar).toBe(true);
    expect(result.current.enrichErrorMessage).toContain(
      "still create the issue manually",
    );
  });

  it("retries enrichment with the current draft after a request failure", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "AI enrichment is unavailable." }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            suggestions: [
              {
                field: "priority",
                value: "high",
                reasoning: "The draft describes user-visible work.",
                confidence: 0.8,
              },
            ],
            references: [],
          }),
          { status: 200 },
        ),
      );
    const setSubmitError = vi.fn();
    const setReferenceCandidates = vi.fn();

    const { result, rerender } = renderHook(
      (props: { title: string; body: string }) =>
        useNewIssueEnrichment({
          vault: "reef-acme",
          prefix: "REEF",
          scanRepo: "",
          title: props.title,
          body: props.body,
          estimatePoints: "",
          formApi: makeFormApi({
            title: props.title,
            content: props.body,
          }),
          buildCreateFields: ({ fallbackTitle } = {}) =>
            createFields(props.title || fallbackTitle || ""),
          setSubmitError,
          setReferenceCandidates,
          isAiAvailable: true,
          isAiAvailabilityLoading: false,
          aiUnavailableMessage: "AI unavailable.",
        }),
      {
        wrapper: createWrapper(),
        initialProps: {
          title: "Draft before failure",
          body: "Body before failure",
        },
      },
    );

    act(() => result.current.handleEnrichClick());

    await waitFor(() =>
      expect(result.current.enrichErrorMessage).toMatch(/unavailable/i),
    );

    rerender({
      title: "Draft after failure",
      body: "Body after failure",
    });
    act(() => result.current.handleRetry());

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    const retryBody = JSON.parse(
      mockApiFetch.mock.calls[1]?.[1]?.body as string,
    );
    expect(retryBody.draft.fields.title).toBe("Draft after failure");
    expect(retryBody.draft.content).toBe("Body after failure");
    await waitFor(() =>
      expect(result.current.enrichment.counts.pending).toBe(1),
    );
    expect(setReferenceCandidates).toHaveBeenCalledWith([]);
  });
});

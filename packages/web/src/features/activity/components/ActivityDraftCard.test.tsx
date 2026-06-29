import type { PlanningCatalog } from "@reef/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityFeedItem } from "../types";

const SPRINT_ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE_ID = "22222222-2222-4222-8222-222222222222";
const RELEASE_ID = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

const catalog: PlanningCatalog = {
  sprints: [
    {
      id: SPRINT_ID,
      name: "Sprint 3",
      status: "active",
      start_date: "2026-06-12",
      end_date: "2026-06-19",
      goal: "",
      capacity_points: null,
    },
  ],
  milestones: [
    {
      id: MILESTONE_ID,
      name: "MVP",
      status: "open",
      target_date: null,
      description: "",
    },
  ],
  releases: [
    {
      id: RELEASE_ID,
      name: "v0.5.0",
      status: "planned",
      target_date: null,
      released_at: null,
      notes: "",
    },
  ],
};

// Resolve the three data hooks to plain values so the card renders without a
// QueryClient and without firing network requests. `findPlanningName` stays the
// real implementation — the card under test should use it to resolve ids.
vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: () => ({ data: catalog }),
}));
vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: () => ({ data: [] }),
}));
vi.mock("@/features/issues/hooks/queries/useIssueRelations", () => ({
  useIssueRelations: () => ({ data: undefined }),
}));
// ActivityCardHeader now reads the active vault (REEF-315) via useActiveVault,
// which calls useQuery — resolve it to a fixed value so the card renders without
// a QueryClient, matching the `vault` prop the card is given below.
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-test",
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { ActivityDraftCard } from "./ActivityDraftCard";

function makeDraftItem(fields: {
  sprint_id?: string | null;
  milestone_id?: string | null;
  release_id?: string | null;
}): Extract<ActivityFeedItem, { type: "ai_draft" }> {
  const id = "reef-draft-0000000000000001";
  return {
    id,
    type: "ai_draft",
    timestamp: "2026-04-13T10:00:00.000Z",
    draft: {
      id,
      kind: "draft",
      proposal: {
        operation: "create",
        create: {
          fields: {
            title: "Draft with planning links",
            issue_type: "task",
            ...fields,
          },
          content: "Body",
        },
      },
      repo: "owner/repo",
      fingerprint: `owner/repo:commit:${id}`,
      provenance: {
        type: "commit",
        ref: "abc123",
        repo: "owner/repo",
        actor: "actor",
        detectedAt: "2026-04-13T10:00:00.000Z",
      },
      confidence: 0.87,
      reasoning: "reason",
      status: "pending",
      created_at: "2026-04-13T10:00:00.000Z",
      detected_at: "2026-04-13T10:00:00.000Z",
    },
  };
}

afterEach(cleanup);

describe("ActivityDraftCard planning chips", () => {
  it("renders sprint/milestone/release as resolved names, not raw ids", () => {
    render(
      <ActivityDraftCard
        item={makeDraftItem({
          sprint_id: SPRINT_ID,
          milestone_id: MILESTONE_ID,
          release_id: RELEASE_ID,
        })}
        vault="reef-test"
        isApproving={false}
      />,
    );

    expect(screen.getByText("sprint Sprint 3")).toBeInTheDocument();
    expect(screen.getByText("milestone MVP")).toBeInTheDocument();
    expect(screen.getByText("release v0.5.0")).toBeInTheDocument();
    // The raw uuid should not leak into a chip.
    expect(screen.queryByText(new RegExp(SPRINT_ID))).not.toBeInTheDocument();
  });

  it("hides the chip when a planning id cannot be resolved to a name", () => {
    render(
      <ActivityDraftCard
        item={makeDraftItem({ sprint_id: UNKNOWN_ID })}
        vault="reef-test"
        isApproving={false}
      />,
    );

    expect(screen.queryByText(/^sprint/)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(UNKNOWN_ID))).not.toBeInTheDocument();
  });
});

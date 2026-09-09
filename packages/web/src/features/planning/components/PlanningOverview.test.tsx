import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { IssueListItem, PlanningCatalog } from "@reef/core";
import { PlanningOverview } from "./PlanningOverview";

const SPRINT_OLD = "00000000-0000-4000-8000-000000000001";
const SPRINT_CURRENT = "00000000-0000-4000-8000-000000000002";
const SPRINT_UNDATED = "00000000-0000-4000-8000-000000000003";
const MILESTONE_EARLY = "00000000-0000-4000-8000-000000000011";
const MILESTONE_LATE = "00000000-0000-4000-8000-000000000012";
const MILESTONE_CLOSED = "00000000-0000-4000-8000-000000000013";
const RELEASE_PROGRESS = "00000000-0000-4000-8000-000000000021";
const RELEASE_PLANNED = "00000000-0000-4000-8000-000000000022";
const RELEASE_DONE = "00000000-0000-4000-8000-000000000023";

function issue(partial: Partial<IssueListItem>): IssueListItem {
  return partial as IssueListItem;
}

const catalog: PlanningCatalog = {
  sprints: [
    {
      id: SPRINT_UNDATED,
      name: "Undated active",
      status: "active",
      start_date: null,
      end_date: null,
      goal: "",
      capacity_points: 0,
    },
    {
      id: SPRINT_CURRENT,
      name: "Current sprint",
      status: "active",
      start_date: "2026-06-10",
      end_date: "2026-06-20",
      goal: "Ship the overview",
      capacity_points: 8,
    },
    {
      id: SPRINT_OLD,
      name: "Old planned",
      status: "planned",
      start_date: "2026-05-01",
      end_date: "2026-05-10",
      goal: "",
      capacity_points: null,
    },
  ],
  milestones: [
    {
      id: MILESTONE_LATE,
      name: "Late milestone",
      status: "open",
      target_date: "2026-07-01",
      description: "",
    },
    {
      id: MILESTONE_CLOSED,
      name: "Closed milestone",
      status: "closed",
      target_date: "2026-06-01",
      description: "",
    },
    {
      id: MILESTONE_EARLY,
      name: "Early milestone",
      status: "open",
      target_date: "2026-06-01",
      description: "",
    },
  ],
  releases: [
    {
      id: RELEASE_PLANNED,
      name: "Planned release",
      status: "planned",
      target_date: "2026-08-01",
      released_at: null,
      notes: "",
    },
    {
      id: RELEASE_PROGRESS,
      name: "Progress release",
      status: "in_progress",
      target_date: "2026-08-01",
      released_at: null,
      notes: "",
    },
    {
      id: RELEASE_DONE,
      name: "Released bundle",
      status: "released",
      target_date: "2026-07-01",
      released_at: "2026-07-01",
      notes: "",
    },
  ],
  rollover_resumes: [],
};

function renderOverview(
  overrides: Partial<ComponentProps<typeof PlanningOverview>> = {},
) {
  return render(
    <IntlTestProvider>
      <PlanningOverview
        catalog={catalog}
        vault="reef-acme"
        issues={[
          issue({
            sprint_id: SPRINT_CURRENT,
            status: "done",
            estimate_points: 3,
          }),
          issue({
            sprint_id: SPRINT_CURRENT,
            status: "todo",
            estimate_points: null,
          }),
          issue({ milestone_id: MILESTONE_EARLY, status: "in_progress" }),
          issue({
            release_id: RELEASE_PROGRESS,
            status: "todo",
            estimate_points: 2,
          }),
        ]}
        isLoading={false}
        isCatalogError={false}
        isCatalogFetching={false}
        onRetryCatalog={vi.fn()}
        issueAggregationState="available"
        isIssueFetching={false}
        onRetryIssues={vi.fn()}
        now={Date.parse("2026-09-09T00:00:00.000Z")}
        {...overrides}
      />
    </IntlTestProvider>,
  );
}

describe("PlanningOverview", () => {
  it("renders all three sections with stable selection, filtering, and rollups", () => {
    renderOverview();

    expect(screen.getByTestId("planning-overview")).toBeInTheDocument();
    const currentSection = screen.getByTestId(
      "planning-overview-section-currentSprint",
    );
    expect(within(currentSection).getByRole("heading")).toHaveClass(
      "type-group-title",
      "text-foreground",
    );
    const currentItem = screen.getByTestId(
      `planning-overview-item-${SPRINT_CURRENT}`,
    );
    expect(within(currentItem).getByRole("article")).toHaveClass(
      "border-border",
      "bg-surface-card",
      "p-4",
    );
    expect(
      within(currentSection).getByRole("link", {
        name: "Open Current sprint sprint details",
      }),
    ).toHaveAttribute(
      "href",
      "/workspace/reef-acme/planning/sprints/00000000-0000-4000-8000-000000000002",
    );

    const milestones = screen.getByTestId(
      "planning-overview-list-upcomingMilestones",
    );
    expect(
      within(
        screen.getByTestId("planning-overview-section-upcomingMilestones"),
      ).getByRole("heading"),
    ).toHaveClass("type-section-label", "text-muted-foreground");
    const milestoneItem = screen.getByTestId(
      `planning-overview-item-${MILESTONE_EARLY}`,
    );
    expect(within(milestoneItem).getByRole("article")).toHaveClass(
      "border-border-subtle",
      "bg-surface-subtle",
      "p-3",
    );
    expect(
      within(milestones)
        .getAllByTestId(/planning-overview-link-/)
        .map((item) => item.textContent),
    ).toEqual(["Early milestone", "Late milestone"]);
    expect(within(milestones).getAllByText("Overdue")).toHaveLength(2);
    expect(screen.queryByText("Closed milestone")).not.toBeInTheDocument();

    const releases = screen.getByTestId(
      "planning-overview-list-upcomingReleases",
    );
    expect(
      within(releases)
        .getAllByTestId(/planning-overview-link-/)
        .map((item) => item.textContent),
    ).toEqual(["Progress release", "Planned release"]);
    expect(screen.queryByText("Released bundle")).not.toBeInTheDocument();

    expect(within(currentItem).getByText("50% complete")).toBeInTheDocument();
    expect(within(currentItem).getByText("1 unestimated")).toBeInTheDocument();
    for (const segment of within(currentItem).getAllByTestId(
      /planning-rollup-segment-/,
    )) {
      expect(segment).not.toHaveClass("transition-[width]");
    }
  });

  it("keeps long planning names on one line with a full accessible value", () => {
    const longName =
      "A planning target with a deliberately long name that must stay on one line";
    const milestone = catalog.milestones[0];
    if (!milestone) throw new Error("Expected a milestone fixture");

    renderOverview({
      catalog: {
        ...catalog,
        milestones: [{ ...milestone, name: longName }],
      },
    });

    const link = screen.getByRole("link", {
      name: `Open ${longName} in the Planning list`,
    });
    expect(link).toHaveClass("flex-1", "truncate", "whitespace-nowrap");
    expect(link).toHaveAttribute("title", longName);
    expect(link).toHaveAttribute(
      "aria-label",
      `Open ${longName} in the Planning list`,
    );
    const name = link.querySelector("span");
    expect(name).not.toBeNull();
    expect(name).toHaveClass("block", "truncate");
  });

  it("keeps section-level empty states visible when one planning kind has no items", () => {
    renderOverview({
      catalog: {
        ...catalog,
        sprints: [],
        milestones: [],
        releases: [],
      },
    });

    for (const section of [
      "currentSprint",
      "upcomingMilestones",
      "upcomingReleases",
    ]) {
      expect(
        screen.getByTestId(`planning-overview-empty-${section}`),
      ).toBeInTheDocument();
    }
  });

  it("preserves metadata and detail links while issue rollups are unavailable", () => {
    renderOverview({ issues: undefined, issueAggregationState: "unavailable" });

    expect(screen.getByTestId("planning-issue-error")).toBeInTheDocument();
    const item = screen.getByTestId(`planning-overview-item-${SPRINT_CURRENT}`);
    expect(
      within(item).getByRole("link", {
        name: "Open Current sprint sprint details",
      }),
    ).toHaveAttribute(
      "href",
      "/workspace/reef-acme/planning/sprints/00000000-0000-4000-8000-000000000002",
    );
    expect(within(item).getByText("Current sprint")).toBeInTheDocument();
    expect(within(item).getByText("Active")).toBeInTheDocument();
    expect(within(item).getByText("Unable to verify")).toBeInTheDocument();
    expect(within(item).queryByText("0% complete")).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import {
  MilestoneSchema,
  PlanningCatalogSchema,
  ReleaseSchema,
  SprintSchema,
} from "./catalog";

describe("planning schemas", () => {
  it("accepts valid sprint, milestone, and release rows", () => {
    expect(
      PlanningCatalogSchema.parse({
        sprints: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Sprint 12",
            status: "active",
            start_date: "2026-06-01",
            end_date: "2026-06-14",
            goal: "Stabilize onboarding",
            capacity_points: 24,
          },
        ],
        milestones: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "MVP Beta",
            status: "open",
            target_date: "2026-06-30",
            description: "Beta readiness",
          },
        ],
        releases: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "v0.4.0",
            status: "planned",
            target_date: "2026-07-01",
            notes: "Planning metadata rollout",
          },
        ],
      }),
    ).toMatchObject({
      sprints: [{ name: "Sprint 12" }],
      milestones: [{ name: "MVP Beta" }],
      releases: [{ name: "v0.4.0" }],
    });
  });

  it("rejects sprint ranges where end is before start", () => {
    const result = SprintSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Backwards sprint",
      status: "planned",
      start_date: "2026-06-14",
      end_date: "2026-06-01",
      goal: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status values", () => {
    expect(
      MilestoneSchema.safeParse({
        id: "22222222-2222-4222-8222-222222222222",
        name: "MVP",
        status: "active",
        description: "",
      }).success,
    ).toBe(false);
    expect(
      ReleaseSchema.safeParse({
        id: "33333333-3333-4333-8333-333333333333",
        name: "v1",
        status: "closed",
        notes: "",
      }).success,
    ).toBe(false);
  });
});

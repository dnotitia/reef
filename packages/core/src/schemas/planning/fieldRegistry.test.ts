import { describe, expect, it } from "vitest";
import {
  MilestoneStatusEnum,
  ReleaseStatusEnum,
  SprintStatusEnum,
} from "./catalog";
import {
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_OPTIONS,
  RELEASE_STATUS_LABELS,
  RELEASE_STATUS_OPTIONS,
  SPRINT_STATUS_LABELS,
  SPRINT_STATUS_OPTIONS,
} from "./fieldRegistry";

describe("planning fieldRegistry", () => {
  const cases = [
    {
      name: "sprint",
      values: SprintStatusEnum.options,
      options: SPRINT_STATUS_OPTIONS,
      labels: SPRINT_STATUS_LABELS as Record<string, string>,
    },
    {
      name: "milestone",
      values: MilestoneStatusEnum.options,
      options: MILESTONE_STATUS_OPTIONS,
      labels: MILESTONE_STATUS_LABELS as Record<string, string>,
    },
    {
      name: "release",
      values: ReleaseStatusEnum.options,
      options: RELEASE_STATUS_OPTIONS,
      labels: RELEASE_STATUS_LABELS as Record<string, string>,
    },
  ];

  for (const { name, values, options, labels } of cases) {
    it(`${name}: option array mirrors the schema enum (cannot drift)`, () => {
      expect(options).toEqual(values);
    });

    it(`${name}: every status has a non-empty human label`, () => {
      for (const value of values) {
        expect(labels[value]).toBeTruthy();
        // Labels are display copy — does not the raw snake_case identifier.
        if (value.includes("_")) {
          expect(labels[value]).not.toBe(value);
        }
      }
    });
  }

  it("uses Title Case display copy for multi-word statuses", () => {
    expect(RELEASE_STATUS_LABELS.in_progress).toBe("In Progress");
    expect(SPRINT_STATUS_LABELS.active).toBe("Active");
    expect(MILESTONE_STATUS_LABELS.open).toBe("Open");
  });
});

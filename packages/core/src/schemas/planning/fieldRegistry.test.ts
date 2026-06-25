import { describe, expect, it } from "vitest";
import {
  MilestoneStatusEnum,
  ReleaseStatusEnum,
  SprintStatusEnum,
} from "./catalog";
import {
  MILESTONE_STATUS_OPTIONS,
  PLANNING_FIELD_MESSAGES_EN,
  RELEASE_STATUS_OPTIONS,
  SPRINT_STATUS_OPTIONS,
} from "./fieldRegistry";

describe("planning fieldRegistry", () => {
  // The enum value is the i18n message key (REEF-292): the en base catalog
  // carries one non-empty label per enum member, and the option array mirrors the
  // schema enum order.
  const cases = [
    {
      name: "sprint",
      values: SprintStatusEnum.options,
      options: SPRINT_STATUS_OPTIONS,
      labels: PLANNING_FIELD_MESSAGES_EN.sprintStatus as Record<string, string>,
    },
    {
      name: "milestone",
      values: MilestoneStatusEnum.options,
      options: MILESTONE_STATUS_OPTIONS,
      labels: PLANNING_FIELD_MESSAGES_EN.milestoneStatus as Record<
        string,
        string
      >,
    },
    {
      name: "release",
      values: ReleaseStatusEnum.options,
      options: RELEASE_STATUS_OPTIONS,
      labels: PLANNING_FIELD_MESSAGES_EN.releaseStatus as Record<
        string,
        string
      >,
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
    expect(PLANNING_FIELD_MESSAGES_EN.releaseStatus.in_progress).toBe(
      "In Progress",
    );
    expect(PLANNING_FIELD_MESSAGES_EN.sprintStatus.active).toBe("Active");
    expect(PLANNING_FIELD_MESSAGES_EN.milestoneStatus.open).toBe("Open");
  });
});

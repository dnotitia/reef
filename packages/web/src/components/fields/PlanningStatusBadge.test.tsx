import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PlanningStatusBadge,
  type PlanningStatusKind,
  planningStatusMeta,
} from "./PlanningStatusBadge";

const PLANNING_STATUS_EXPECTATIONS: ReadonlyArray<
  readonly [PlanningStatusKind, string, string]
> = [
  ["sprints", "planned", "text-planning-pending"],
  ["sprints", "active", "text-planning-active"],
  ["sprints", "closed", "text-planning-closed"],
  ["milestones", "open", "text-planning-open"],
  ["milestones", "closed", "text-planning-closed"],
  ["releases", "planned", "text-planning-pending"],
  ["releases", "in_progress", "text-planning-active"],
  ["releases", "released", "text-planning-released"],
];

const PLANNING_TOKENS = [
  "pending",
  "open",
  "active",
  "closed",
  "released",
] as const;

describe("PlanningStatusBadge", () => {
  it("renders the human label, never the raw enum identifier", () => {
    render(<PlanningStatusBadge kind="releases" status="in_progress" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByText("in_progress")).not.toBeInTheDocument();
  });

  it("maps every planning status onto a dedicated planning color token", () => {
    // Color is independent of the (locale-resolved) label map, so an empty map
    // is enough to exercise the color resolution.
    const noLabels: Record<string, string> = {};
    for (const [kind, status, expectedColor] of PLANNING_STATUS_EXPECTATIONS) {
      const colorClass = planningStatusMeta(kind, status, noLabels).colorClass;
      expect(colorClass).toBe(expectedColor);
      expect(colorClass).not.toMatch(/^text-status-/);
    }
  });

  it("exposes the planning tokens through Tailwind theme colors", () => {
    const globalsCss = readFileSync("src/app/globals.css", "utf8");
    for (const token of PLANNING_TOKENS) {
      expect(globalsCss).toContain(`--planning-${token}:`);
      expect(globalsCss).toContain(
        `--color-planning-${token}: var(--planning-${token});`,
      );
    }
  });

  it("falls back to the raw value + neutral color for an unknown status", () => {
    const meta = planningStatusMeta("sprints", "mystery", { active: "Active" });
    expect(meta.label).toBe("mystery");
    expect(meta.colorClass).toBe("text-planning-closed");
  });
});

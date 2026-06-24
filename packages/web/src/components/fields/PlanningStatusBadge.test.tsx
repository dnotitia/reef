import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanningStatusBadge, planningStatusMeta } from "./PlanningStatusBadge";

describe("PlanningStatusBadge", () => {
  it("renders the human label, never the raw enum identifier", () => {
    render(<PlanningStatusBadge kind="releases" status="in_progress" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByText("in_progress")).not.toBeInTheDocument();
  });

  it("maps each kind/status onto a shared status color token", () => {
    // Color is independent of the (locale-resolved) label map, so an empty map
    // is enough to exercise the color resolution.
    const noLabels: Record<string, string> = {};
    expect(planningStatusMeta("sprints", "active", noLabels).colorClass).toBe(
      "text-status-in-progress",
    );
    expect(planningStatusMeta("sprints", "planned", noLabels).colorClass).toBe(
      "text-status-open",
    );
    expect(
      planningStatusMeta("milestones", "closed", noLabels).colorClass,
    ).toBe("text-status-done");
    expect(
      planningStatusMeta("releases", "released", noLabels).colorClass,
    ).toBe("text-status-done");
  });

  it("falls back to the raw value + neutral color for an unknown status", () => {
    const meta = planningStatusMeta("sprints", "mystery", { active: "Active" });
    expect(meta.label).toBe("mystery");
    expect(meta.colorClass).toBe("text-status-closed");
  });
});

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanningKindIcon } from "./PlanningKindIcon";

afterEach(cleanup);

describe("PlanningKindIcon", () => {
  it("renders a distinct glyph per planning kind", () => {
    const { container: sprint } = render(<PlanningKindIcon kind="sprints" />);
    const { container: milestone } = render(
      <PlanningKindIcon kind="milestones" />,
    );
    const { container: release } = render(<PlanningKindIcon kind="releases" />);

    const sprintSvg = sprint.querySelector("svg")?.innerHTML;
    const milestoneSvg = milestone.querySelector("svg")?.innerHTML;
    const releaseSvg = release.querySelector("svg")?.innerHTML;

    // Shape carries the meaning — the three glyphs should differ.
    expect(sprintSvg).toBeTruthy();
    expect(sprintSvg).not.toBe(milestoneSvg);
    expect(milestoneSvg).not.toBe(releaseSvg);
    expect(sprintSvg).not.toBe(releaseSvg);
  });

  it("names itself for the a11y tree by default (icon-only contexts)", () => {
    const { container } = render(<PlanningKindIcon kind="milestones" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Milestone");
    expect(svg?.getAttribute("aria-hidden")).toBeNull();
  });

  it("is hidden from the a11y tree when decorative (paired with a visible label)", () => {
    const { container } = render(
      <PlanningKindIcon kind="releases" decorative />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBeNull();
    expect(svg?.getAttribute("aria-label")).toBeNull();
  });

  it("sizes the glyph from the size prop", () => {
    const { container } = render(<PlanningKindIcon kind="sprints" size={11} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("11");
    expect(svg?.getAttribute("height")).toBe("11");
  });
});

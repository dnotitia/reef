// @vitest-environment jsdom
import type { Status } from "@reef/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: () => ({ data: undefined }),
}));
import { CollapsedEventsRow } from "./CollapsedEventsRow";
import type { SystemEntry } from "./timelineModel";

function statusEntry(
  id: string,
  at: string,
  from: Status,
  to: Status,
): SystemEntry {
  return {
    type: "system",
    at,
    event: {
      id,
      at,
      actor: "bob",
      kind: "status_change",
      from,
      to,
      source: null,
    },
  };
}

const EVENTS: SystemEntry[] = [
  statusEntry("a1", "2026-06-02T00:00:00.000Z", "backlog", "todo"),
  statusEntry("a2", "2026-06-03T00:00:00.000Z", "todo", "in_progress"),
  statusEntry("a3", "2026-06-04T00:00:00.000Z", "in_progress", "in_review"),
];

describe("CollapsedEventsRow — focus & motion (REEF-287)", () => {
  it("gives the toggle a canonical focus-visible ring on the pill and a reduced-motion-safe chevron", () => {
    render(<CollapsedEventsRow events={EVENTS} vault="v" />);

    const toggle = screen.getByRole("button", { name: /status changes/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The button suppresses the default outline; the ring rides on the pill so
    // keyboard focus is shown without a full-width ring.
    expect(toggle.className).toContain("focus-visible:outline-none");

    const pill = toggle.querySelector("span.rounded-full");
    expect(pill?.className).toContain("group-focus-visible/collapse:ring-2");
    expect(pill?.className).toContain(
      "group-focus-visible/collapse:ring-brand-focus",
    );

    // The chevron animates when motion is allowed (prefers-reduced-motion).
    const chevron = toggle.querySelector("svg");
    expect(chevron?.getAttribute("class")).toContain(
      "motion-safe:transition-transform",
    );
  });

  it("resolves actors with the same roster after expanding a folded run", async () => {
    const user = userEvent.setup();
    render(
      <CollapsedEventsRow
        events={EVENTS}
        vault="v"
        members={[
          { username: "bob", display_name: "Bob Example", role: "writer" },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /status changes/ }));
    const rows = screen.getAllByTestId("activity-event");
    expect(rows).toHaveLength(EVENTS.length);
    for (const row of rows) {
      expect(row).toHaveTextContent("Bob Example");
      expect(row).not.toHaveTextContent("bob");
    }
  });
});

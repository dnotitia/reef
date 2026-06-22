// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// usePlanningCatalog uses useQuery; stub it so the row renders without a
// QueryClient — these cases never resolve a planning name.
vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: () => ({ data: undefined }),
}));

import { ActivityEventRow } from "./ActivityEventRow";
import type { TimelineSystemEvent } from "./timelineModel";

function renderEvent(event: TimelineSystemEvent) {
  return render(<ActivityEventRow event={event} vault="v" />);
}

const AT = "2026-06-02T00:00:00.000Z";

describe("ActivityEventRow — identifier i18n (REEF-287)", () => {
  it("marks the actor login as translate=no", () => {
    const { container } = renderEvent({
      id: "c",
      at: AT,
      actor: "alice",
      kind: "created",
    });
    const actor = container.querySelector('[translate="no"]');
    expect(actor).not.toBeNull();
    expect(actor).toHaveTextContent("alice");
  });

  it("marks both assignee logins as translate=no", () => {
    const { container } = renderEvent({
      id: "a",
      at: AT,
      actor: "alice",
      kind: "assignee_change",
      from: "bob",
      to: "carol",
    });
    const idTokens = [...container.querySelectorAll('[translate="no"]')].map(
      (n) => n.textContent,
    );
    expect(idTokens).toContain("bob");
    expect(idTokens).toContain("carol");
  });

  it("marks the delivery ref label as translate=no while leaving the title translatable", () => {
    const { container, getByText } = renderEvent({
      id: "d",
      at: AT,
      actor: "carol",
      kind: "delivery",
      ref: {
        type: "pull_request",
        repo: "o/r",
        ref: "25",
        url: "https://github.com/o/r/pull/25",
        title: "Forecast",
      },
    });
    const link = container.querySelector('a[translate="no"]');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent("PR #25");
    // The PR title is prose — it must NOT sit inside a translate="no" node.
    expect(getByText(/Forecast/).closest('[translate="no"]')).toBeNull();
  });

  it("does NOT mark a human-readable priority label as translate=no", () => {
    const { getByText } = renderEvent({
      id: "p",
      at: AT,
      actor: "alice",
      kind: "priority_change",
      from: null,
      to: "high",
    });
    expect(getByText("High").closest('[translate="no"]')).toBeNull();
  });
});

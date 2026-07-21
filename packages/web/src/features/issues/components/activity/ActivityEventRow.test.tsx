// @vitest-environment jsdom

import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// usePlanningCatalog uses useQuery; stub it so the row renders without a
// QueryClient — these cases do not resolve a planning name.
vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: () => ({ data: undefined }),
}));

import { ActivityEventRow } from "./ActivityEventRow";
import type { TimelineSystemEvent } from "./timelineModel";

function renderEvent(event: TimelineSystemEvent) {
  return render(<ActivityEventRow event={event} vault="v" />);
}

function renderLocalizedEvent(event: TimelineSystemEvent, locale: "en" | "ko") {
  return render(
    <IntlTestProvider locale={locale}>
      <ActivityEventRow event={event} vault="v" />
    </IntlTestProvider>,
  );
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
    // The PR title is prose — it should not sit inside a translate="no" node.
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

describe("ActivityEventRow — REEF-277 field-change rows", () => {
  it("renders a title rename with both ends, kept translatable", () => {
    const { getByText, container } = renderEvent({
      id: "t",
      at: AT,
      actor: "alice",
      kind: "title_change",
      from: "Old name",
      to: "New name",
    });
    expect(getByText(/changed the title/)).toBeInTheDocument();
    // Titles are prose, not code identifiers — does not translate="no".
    expect(getByText("New name").closest('[translate="no"]')).toBeNull();
    expect(container).toHaveTextContent("Old name");
  });

  it("renders a labels change naming the added and removed tags", () => {
    const { getByText } = renderEvent({
      id: "l",
      at: AT,
      actor: "alice",
      kind: "labels_change",
      added: ["backend"],
      removed: ["frontend"],
    });
    expect(getByText("backend")).toBeInTheDocument();
    expect(getByText("frontend")).toBeInTheDocument();
    // Label names are translatable prose.
    expect(getByText("backend").closest('[translate="no"]')).toBeNull();
  });

  it("renders a due-date set with a formatted YYYY-MM-DD value", () => {
    const { getByText } = renderEvent({
      id: "due",
      at: AT,
      actor: "alice",
      kind: "due_date_change",
      from: null,
      to: "2026-07-01T00:00:00.000Z",
    });
    expect(getByText(/set the due date to/)).toBeInTheDocument();
    expect(getByText("2026-07-01")).toBeInTheDocument();
  });

  it("renders an estimate change with the numeric points", () => {
    const { getByText } = renderEvent({
      id: "e",
      at: AT,
      actor: "alice",
      kind: "estimate_change",
      from: 3,
      to: 5,
    });
    expect(getByText(/changed the estimate/)).toBeInTheDocument();
    expect(getByText("5")).toBeInTheDocument();
  });

  it("marks a parent reef id as translate=no (a code identifier)", () => {
    const { getByText } = renderEvent({
      id: "par",
      at: AT,
      actor: "alice",
      kind: "parent_change",
      from: null,
      to: "REEF-012",
    });
    expect(getByText("REEF-012").closest('[translate="no"]')).not.toBeNull();
  });

  it("renders a relation change naming the dimension and reef ids", () => {
    const { getByText } = renderEvent({
      id: "rel",
      at: AT,
      actor: "alice",
      kind: "relation_change",
      relation: "depends_on",
      added: ["REEF-002"],
      removed: [],
    });
    expect(getByText(/depends on/)).toBeInTheDocument();
    expect(getByText("REEF-002").closest('[translate="no"]')).not.toBeNull();
  });

  it("renders archive and restore with direction-specific copy", () => {
    expect(
      renderEvent({
        id: "arc",
        at: AT,
        actor: "alice",
        kind: "archived_change",
        from: false,
        to: true,
      }).getByText(/archived this issue/),
    ).toBeInTheDocument();
    expect(
      renderEvent({
        id: "res",
        at: AT,
        actor: "alice",
        kind: "archived_change",
        from: true,
        to: false,
      }).getByText(/restored this issue/),
    ).toBeInTheDocument();
  });

  it("renders issue type and start date changes in English and Korean with one neutral glyph", () => {
    const issueTypeEvent = {
      id: "type",
      at: AT,
      actor: "alice",
      kind: "issue_type_change" as const,
      from: "story" as const,
      to: "bug" as const,
    };
    const startDateEvent = {
      id: "start",
      at: AT,
      actor: "alice",
      kind: "start_date_change" as const,
      from: null,
      to: "2026-07-21",
    };

    const enType = renderLocalizedEvent(issueTypeEvent, "en");
    expect(enType.getByText(/changed the issue type/)).toBeInTheDocument();
    enType.unmount();
    const koType = renderLocalizedEvent(issueTypeEvent, "ko");
    expect(koType.getByText(/이슈 유형을/)).toBeInTheDocument();
    koType.unmount();
    const enStart = renderLocalizedEvent(startDateEvent, "en");
    expect(enStart.getByText(/set the start date to/)).toBeInTheDocument();
    expect(enStart.container.querySelectorAll("svg")).toHaveLength(1);
    enStart.unmount();
    const koStart = renderLocalizedEvent(startDateEvent, "ko");
    expect(koStart.getByText(/시작일을/)).toBeInTheDocument();
    expect(koStart.container.querySelectorAll("svg")).toHaveLength(1);
  });
});

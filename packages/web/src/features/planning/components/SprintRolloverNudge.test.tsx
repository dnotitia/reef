import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { IssueListItem, Sprint } from "@reef/core";
import { SprintRolloverNudge } from "./SprintRolloverNudge";

const SPRINT: Sprint = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sprint 14",
  status: "active",
  start_date: "2026-09-01",
  end_date: "2026-09-05",
  goal: "",
  capacity_points: null,
};
const ISSUES = [
  { id: "REEF-001", sprint_id: SPRINT.id, status: "todo", archived_at: null },
] as unknown as IssueListItem[];

function wrap(ui: ReactNode) {
  return <IntlTestProvider>{ui}</IntlTestProvider>;
}

describe("SprintRolloverNudge", () => {
  it("shows the overdue action, supports dismiss, and resets on sprint re-entry", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      wrap(
        <SprintRolloverNudge
          sprint={SPRINT}
          issues={ISSUES}
          issueState="available"
          now={Date.parse("2026-09-06T00:00:00Z")}
          canEdit
          onOpen={onOpen}
        />,
      ),
    );

    expect(screen.getByTestId("sprint-rollover-nudge")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Close and roll over" }),
    );
    expect(onOpen).toHaveBeenCalledWith(SPRINT);
    const dismiss = screen.getByRole("button", {
      name: "Dismiss sprint rollover notice",
    });
    expect(dismiss.querySelector("svg")).toHaveClass("lucide-x");
    await user.click(dismiss);
    expect(screen.queryByTestId("sprint-rollover-nudge")).toBeNull();

    rerender(
      wrap(
        <SprintRolloverNudge
          sprint={{ ...SPRINT, id: "22222222-2222-4222-8222-222222222222" }}
          issues={
            [
              {
                id: "REEF-002",
                sprint_id: "22222222-2222-4222-8222-222222222222",
                status: "todo",
                archived_at: null,
              },
            ] as unknown as IssueListItem[]
          }
          issueState="available"
          now={Date.parse("2026-09-06T00:00:00Z")}
          canEdit
          onOpen={onOpen}
        />,
      ),
    );
    expect(screen.getByTestId("sprint-rollover-nudge")).toBeVisible();
  });

  it("keeps the action disabled with an edit-access reason for readers", () => {
    render(
      wrap(
        <SprintRolloverNudge
          sprint={SPRINT}
          issues={ISSUES}
          issueState="available"
          now={Date.parse("2026-09-06T00:00:00Z")}
          canEdit={false}
          onOpen={vi.fn()}
        />,
      ),
    );

    const button = screen.getByRole("button", {
      name: "Close and roll over",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      expect.stringContaining("edit access"),
    );
  });

  it("lowers the nudge when a resumable rollover is already visible", () => {
    render(
      wrap(
        <SprintRolloverNudge
          sprint={SPRINT}
          issues={ISSUES}
          issueState="available"
          now={Date.parse("2026-09-06T00:00:00Z")}
          canEdit
          priority="secondary"
          onOpen={vi.fn()}
        />,
      ),
    );

    const nudge = screen.getByTestId("sprint-rollover-nudge");
    expect(nudge).toHaveClass("border-border-subtle");
    expect(nudge).toHaveClass("sm:pr-12");
    expect(nudge).toHaveTextContent("Sprint 14 has passed its end date");
    expect(
      screen.getByRole("button", { name: "Close and roll over" }),
    ).toHaveClass("border");
  });
});

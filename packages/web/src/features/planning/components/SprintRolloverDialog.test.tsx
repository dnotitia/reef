import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mutationRef } = vi.hoisted(() => ({
  mutationRef: {
    current: {
      mutateAsync: vi.fn(),
      isPending: false,
    },
  },
}));

vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  useCloseSprintAndRollover: () => mutationRef.current,
}));

vi.mock("@/components/fields/DatePickerField", () => ({
  DatePickerField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import type {
  IssueListItem,
  PlanningCatalog,
  SprintRolloverResult,
} from "@reef/core";
import { SprintRolloverDialog } from "./SprintRolloverDialog";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE: PlanningCatalog["sprints"][number] = {
  id: SOURCE_ID,
  name: "Sprint 14",
  status: "active",
  start_date: "2026-09-04",
  end_date: "2026-09-11",
  goal: "",
  capacity_points: null,
};
const TARGET: PlanningCatalog["sprints"][number] = {
  id: TARGET_ID,
  name: "Sprint 15",
  status: "planned",
  start_date: "2026-09-12",
  end_date: "2026-09-19",
  goal: "",
  capacity_points: null,
};
const CATALOG: PlanningCatalog = {
  sprints: [SOURCE, TARGET],
  milestones: [],
  releases: [],
};
const ISSUES = [
  { id: "REEF-001", sprint_id: SOURCE_ID, status: "todo", archived_at: null },
  { id: "REEF-002", sprint_id: SOURCE_ID, status: "done", archived_at: null },
] as unknown as IssueListItem[];

function result(
  overrides: Partial<SprintRolloverResult> = {},
): SprintRolloverResult {
  return {
    status: "completed",
    source_sprint: { ...SOURCE, status: "closed" },
    target_sprint: { ...TARGET, status: "active" },
    source_sprint_id: SOURCE_ID,
    target_sprint_id: TARGET_ID,
    phases: {
      target_preparation: "completed",
      source_close: "completed",
      target_activation: "completed",
      issue_rollover: "completed",
    },
    counts: {
      eligible: 1,
      done: 1,
      closed: 0,
      backlog: 0,
      archived: 0,
      moved: 1,
      skipped: 0,
      failed: 0,
      conflicts: 0,
    },
    issue_results: [],
    phase_errors: [],
    retryable: false,
    no_op: false,
    ...overrides,
  };
}

function wrap(ui: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <IntlTestProvider>{ui}</IntlTestProvider>
    </QueryClientProvider>
  );
}

function renderDialog(onOpenChange = vi.fn()) {
  return render(
    wrap(
      <SprintRolloverDialog
        open
        onOpenChange={onOpenChange}
        vault="reef-acme"
        source={SOURCE}
        catalog={CATALOG}
        issues={ISSUES}
        issueState="available"
        now={Date.parse("2026-09-07T00:00:00Z")}
        canEdit
      />,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mutationRef.current = {
    mutateAsync: vi.fn().mockResolvedValue(result()),
    isPending: false,
  };
});

describe("SprintRolloverDialog", () => {
  it("shows the candidate preview and UTC-derived new-target defaults", () => {
    renderDialog();

    const preview = screen.getByRole("region", { name: "Before you confirm" });
    expect(
      within(preview).getByText("Unfinished issues to move"),
    ).toBeVisible();
    expect(within(preview).getAllByRole("definition")[0]).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("sprint-rollover-target-name")).toHaveValue(
      "Sprint 15",
    );
    expect(screen.getByLabelText("New sprint start")).toHaveValue("2026-09-12");
    expect(screen.getByLabelText("New sprint end")).toHaveValue("2026-09-19");
  });

  it("recalculates suggested target dates when the source end changes", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByLabelText("Close date"));
    await user.type(screen.getByLabelText("Close date"), "2026-09-14");

    expect(screen.getByLabelText("New sprint start")).toHaveValue("2026-09-15");
    expect(screen.getByLabelText("New sprint end")).toHaveValue("2026-09-25");
  });

  it("blocks a reversed new-target date range before calling the mutation", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(result());
    mutationRef.current = { mutateAsync, isPending: false };
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByTestId("sprint-rollover-target-name"));
    await user.type(
      screen.getByTestId("sprint-rollover-target-name"),
      "Fresh Sprint",
    );
    await user.clear(screen.getByLabelText("New sprint start"));
    await user.type(screen.getByLabelText("New sprint start"), "2026-09-20");
    await user.clear(screen.getByLabelText("New sprint end"));
    await user.type(screen.getByLabelText("New sprint end"), "2026-09-19");
    await user.click(screen.getByTestId("sprint-rollover-submit"));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("sprint-rollover-error")).toHaveTextContent(
      "Target end date must be on or after target start date.",
    );
  });

  it("submits an explicitly selected existing target and closes after completion", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog(onOpenChange);

    await user.click(
      screen.getByRole("button", { name: "Use an existing planned sprint" }),
    );
    await user.selectOptions(
      screen.getByTestId("sprint-rollover-existing-target"),
      TARGET_ID,
    );
    await user.click(screen.getByTestId("sprint-rollover-submit"));

    expect(mutationRef.current.mutateAsync).toHaveBeenCalledWith({
      sourceSprintId: SOURCE_ID,
      endDate: "2026-09-11",
      target: { kind: "existing", id: TARGET_ID },
    });
    expect(screen.getByTestId("sprint-rollover-result")).toBeVisible();
    expect(screen.getByTestId("sprint-rollover-target-link")).toHaveTextContent(
      "Sprint 15",
    );
    await user.click(screen.getByTestId("sprint-rollover-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps partial results visible and retries with the durable target id", async () => {
    const partial = result({
      status: "partial",
      counts: {
        eligible: 1,
        done: 0,
        closed: 0,
        backlog: 0,
        archived: 0,
        moved: 0,
        skipped: 0,
        failed: 1,
        conflicts: 0,
      },
      issue_results: [
        {
          id: "REEF-001",
          disposition: "failed",
          activity: "pending",
          reason: "activity_pending",
        },
      ],
      retryable: true,
    });
    const mutateAsync = vi
      .fn()
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(result());
    mutationRef.current = { mutateAsync, isPending: false };
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByTestId("sprint-rollover-target-name"));
    await user.type(
      screen.getByTestId("sprint-rollover-target-name"),
      "Unique Sprint",
    );
    await user.click(screen.getByTestId("sprint-rollover-submit"));
    expect(screen.getByTestId("sprint-rollover-result")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry rollover" }));
    expect(mutateAsync).toHaveBeenNthCalledWith(2, {
      sourceSprintId: SOURCE_ID,
      endDate: "2026-09-11",
      target: { kind: "existing", id: TARGET_ID },
    });
  });
});

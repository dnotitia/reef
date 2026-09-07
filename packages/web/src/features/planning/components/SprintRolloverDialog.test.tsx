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
    id,
    ariaDescribedBy,
    ariaInvalid,
    ariaRequired,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    id?: string;
    ariaDescribedBy?: string;
    ariaInvalid?: boolean;
    ariaRequired?: boolean;
  }) => (
    <input
      id={id}
      aria-label={label}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid || undefined}
      aria-required={ariaRequired || undefined}
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

function wrap(ui: ReactNode, locale: "en" | "ko" = "en") {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <IntlTestProvider locale={locale}>{ui}</IntlTestProvider>
    </QueryClientProvider>
  );
}

function dialogElement(
  onOpenChange = vi.fn(),
  source: PlanningCatalog["sprints"][number] | null = SOURCE,
) {
  return (
    <SprintRolloverDialog
      open
      onOpenChange={onOpenChange}
      vault="reef-acme"
      source={source}
      catalog={CATALOG}
      issues={ISSUES}
      issueState="available"
      now={Date.parse("2026-09-07T00:00:00Z")}
      canEdit
    />
  );
}

function renderDialog(
  onOpenChange = vi.fn(),
  locale: "en" | "ko" = "en",
  source: PlanningCatalog["sprints"][number] | null = SOURCE,
) {
  return render(wrap(dialogElement(onOpenChange, source), locale));
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
    expect(screen.getByTestId("sprint-rollover-target-name")).toHaveClass(
      "[@media(pointer:coarse)]:min-h-11",
    );
    expect(screen.getByText("Current sprint end")).toBeVisible();
    expect(screen.getByText("Next sprint start")).toBeVisible();
    expect(screen.getByText("Next sprint end")).toBeVisible();
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
    const targetEnd = screen.getByLabelText("New sprint end");
    expect(targetEnd).toHaveAttribute("aria-invalid", "true");
    expect(targetEnd).toHaveAttribute("aria-describedby");
    expect(
      screen.getByText(
        "Target end date must be on or after target start date.",
      ),
    ).toBeVisible();
  });

  it.each([
    [
      "en",
      "Close date",
      "Enter a valid close date on or after the sprint start date.",
    ],
    ["ko", "종료일", "스프린트 시작일 이후의 올바른 종료일을 입력하세요."],
  ] as const)(
    "shows the localized source-date error in %s",
    async (locale, label, expected) => {
      const user = userEvent.setup();
      renderDialog(vi.fn(), locale);

      await user.clear(screen.getByLabelText(label));
      await user.type(screen.getByLabelText(label), "2026-09-01");
      await user.click(screen.getByTestId("sprint-rollover-submit"));

      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAttribute("aria-describedby");
      expect(screen.getByText(expected)).toBeVisible();
      expect(screen.queryByTestId("sprint-rollover-error")).toBeNull();
    },
  );

  it.each([
    ["en", "New sprint end", "A new sprint needs a valid start and end date."],
    [
      "ko",
      "새 스프린트 종료일",
      "새 스프린트에는 올바른 시작일과 종료일이 필요합니다.",
    ],
  ] as const)(
    "shows the localized target-date error when the new target end is empty in %s",
    async (locale, label, expected) => {
      const user = userEvent.setup();
      renderDialog(vi.fn(), locale);

      await user.clear(screen.getByTestId("sprint-rollover-target-name"));
      await user.type(
        screen.getByTestId("sprint-rollover-target-name"),
        "Fresh Sprint",
      );
      await user.clear(screen.getByLabelText(label));
      await user.click(screen.getByTestId("sprint-rollover-submit"));

      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAttribute("aria-describedby");
      expect(screen.getByText(expected)).toBeVisible();
      expect(screen.queryByTestId("sprint-rollover-error")).toBeNull();
    },
  );

  it("shows a field-local name error without a common error box", async () => {
    const user = userEvent.setup();
    renderDialog();

    const name = screen.getByTestId("sprint-rollover-target-name");
    await user.clear(name);
    await user.click(screen.getByTestId("sprint-rollover-submit"));

    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby");
    expect(screen.getByText("New sprint name is required.")).toBeVisible();
    expect(screen.queryByTestId("sprint-rollover-error")).toBeNull();
  });

  it("surfaces the named active-sprint conflict from the route", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Cannot activate the selected sprint while “Rollover Target A” is active. Close it or choose a different target.",
        ),
      );
    mutationRef.current = { mutateAsync, isPending: false };
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByTestId("sprint-rollover-target-name"));
    await user.type(
      screen.getByTestId("sprint-rollover-target-name"),
      "Fresh Sprint",
    );
    await user.click(screen.getByTestId("sprint-rollover-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Rollover Target A",
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
    expect(screen.getByTestId("sprint-rollover-complete")).toBeVisible();
    expect(screen.queryByText("Before you confirm")).toBeNull();
    expect(screen.queryByTestId("sprint-rollover-target-name")).toBeNull();
    expect(screen.queryByTestId("sprint-rollover-result")).toBeNull();
    expect(
      screen.getByTestId("sprint-rollover-completed-count"),
    ).toHaveTextContent("1 issue rolled over");
    expect(
      screen.getByTestId("sprint-rollover-completed-route"),
    ).toHaveTextContent("Sprint 14");
    expect(
      screen.getByTestId("sprint-rollover-completed-route"),
    ).toHaveTextContent("Sprint 15");
    expect(screen.getByText("Confirmed close date")).toBeVisible();
    expect(screen.getByText("2026-09-11")).toBeVisible();
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

    await user.click(
      screen.getByRole("button", { name: "Use an existing planned sprint" }),
    );
    await user.selectOptions(
      screen.getByTestId("sprint-rollover-existing-target"),
      TARGET_ID,
    );
    await user.click(screen.getByTestId("sprint-rollover-submit"));
    expect(screen.getByTestId("sprint-rollover-result")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.queryByTestId("sprint-rollover-target-link")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry rollover" }));
    expect(await screen.findByTestId("sprint-rollover-complete")).toBeVisible();
    expect(screen.queryByTestId("sprint-rollover-result")).toBeNull();
    expect(mutateAsync).toHaveBeenNthCalledWith(2, {
      sourceSprintId: SOURCE_ID,
      endDate: "2026-09-11",
      target: { kind: "existing", id: TARGET_ID },
    });
  });

  it("retries a newly created target with its original new-target payload", async () => {
    const partial = result({
      status: "partial",
      target_sprint: { ...TARGET, name: "Unique Sprint" },
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
    expect(screen.getByTestId("sprint-rollover-target-name")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retry rollover" }));
    expect(mutateAsync).toHaveBeenNthCalledWith(2, {
      sourceSprintId: SOURCE_ID,
      endDate: "2026-09-11",
      target: {
        kind: "new",
        item: {
          name: "Unique Sprint",
          status: "planned",
          start_date: "2026-09-12",
          end_date: "2026-09-19",
          goal: "",
          capacity_points: null,
        },
      },
    });
  });

  it("keeps the captured source when the parent loses its active-sprint selection", () => {
    const rendered = renderDialog();

    rendered.rerender(wrap(dialogElement(vi.fn(), null)));

    expect(screen.getByTestId("sprint-rollover-dialog")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Close Sprint 14 & roll over" }),
    ).toBeVisible();
  });
});

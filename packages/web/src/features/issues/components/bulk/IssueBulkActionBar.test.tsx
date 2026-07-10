import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runner } = vi.hoisted(() => ({
  runner: {
    failures: [],
    processed: 0,
    reset: vi.fn(),
    retry: vi.fn(),
    run: vi.fn(),
    running: false,
    total: 0,
  },
}));

vi.mock("@/features/issues/hooks/mutations/useBulkUpdateIssues", () => ({
  useBulkUpdateIssues: () => runner,
}));

vi.mock("@/components/fields/EnumSelectField", () => ({
  EnumSelectField: ({
    placeholder,
    testId,
  }: {
    placeholder: ReactNode;
    testId?: string;
  }) => (
    <button type="button" data-testid={testId}>
      {placeholder}
    </button>
  ),
}));

vi.mock("@/components/AssigneeCombobox", () => ({
  AssigneeCombobox: ({ placeholder }: { placeholder: ReactNode }) => (
    <button type="button" data-testid="bulk-assignee">
      {placeholder}
    </button>
  ),
}));

vi.mock("@/features/planning/components/PlanningItemCombobox", () => ({
  PlanningItemCombobox: ({
    placeholder,
    testId,
  }: {
    placeholder: ReactNode;
    testId?: string;
  }) => (
    <button type="button" data-testid={testId}>
      {placeholder}
    </button>
  ),
}));

vi.mock("@/features/issues/components/detail/CloseIssueDialog", () => ({
  CloseIssueDialog: () => null,
}));

import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { IssueBulkActionBar } from "./IssueBulkActionBar";

describe("IssueBulkActionBar", () => {
  beforeEach(() => {
    runner.reset.mockClear();
    runner.run.mockReset();
    runner.run.mockResolvedValue({
      failures: [],
      succeeded: ["REEF-101"],
      total: 1,
      unchanged: [],
    });
    useIssueSelectionStore.getState().clear();
    useIssueSelectionStore.getState().toggle("REEF-101");
  });

  it("exposes every bulk field directly and lets the action group wrap", () => {
    render(
      <IntlTestProvider>
        <IssueBulkActionBar vault="reef-acme" />
      </IntlTestProvider>,
    );

    expect(screen.getByTestId("bulk-status")).toBeVisible();
    expect(screen.getByTestId("bulk-assignee")).toBeVisible();
    expect(screen.getByTestId("bulk-priority")).toBeVisible();
    expect(screen.getByTestId("bulk-sprint")).toBeVisible();
    expect(screen.getByTestId("bulk-add-labels")).toBeVisible();
    expect(screen.getByTestId("bulk-remove-labels")).toBeVisible();
    expect(screen.getByTestId("bulk-actions")).toHaveClass("flex-wrap");
    expect(screen.queryByTestId("bulk-more")).toBeNull();
  });

  it("applies the current label draft without requiring Enter", async () => {
    const user = userEvent.setup();
    render(
      <IntlTestProvider>
        <IssueBulkActionBar vault="reef-acme" />
      </IntlTestProvider>,
    );

    await user.click(screen.getByTestId("bulk-add-labels"));
    await user.type(screen.getByTestId("bulk-add-labels-input"), "frontend");
    await user.click(screen.getAllByRole("button", { name: "Add labels" })[1]);

    expect(runner.run).toHaveBeenCalledWith(["REEF-101"], {
      kind: "labels:add",
      value: ["frontend"],
    });
  });
});

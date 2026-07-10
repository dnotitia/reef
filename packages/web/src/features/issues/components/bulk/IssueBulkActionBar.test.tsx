import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
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
});

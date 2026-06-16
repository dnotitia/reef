import { mockIssueList } from "@/__stories__/fixtures";
import type { Meta, StoryObj } from "@storybook/react";
import { IssueOptionRow } from "./IssueOptionRow";

// Presentational leaf: normally a child of a cmdk CommandItem. The decorator
// reproduces the popover panel + item chrome so the row reads in context.
const meta = {
  title: "Fields/IssueOptionRow",
  component: IssueOptionRow,
  decorators: [
    (Story) => (
      <div className="w-[420px] rounded-md border border-border bg-popover p-1 shadow-lg">
        <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 data-[active=true]:bg-accent">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof IssueOptionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const [done, open, inProgress] = mockIssueList;

export const Default: Story = {
  args: {
    issue: { ...open, issue_type: "bug" },
  },
};

export const WithQueryHighlight: Story = {
  args: {
    issue: { ...inProgress, issue_type: "story" },
    query: "issue",
  },
};

export const Blocked: Story = {
  args: {
    // REEF-003 depends on REEF-002 (open) → one unresolved blocker.
    issue: { ...inProgress, issue_type: "task" },
    blockerCount: 1,
  },
};

export const SelectedSingle: Story = {
  args: {
    issue: { ...done, issue_type: "chore" },
    selected: true,
  },
};

export const MinimalFields: Story = {
  args: {
    issue: {
      id: "REEF-010",
      title: "Minimal issue with no type or priority",
      status: "todo",
      created_at: "2026-04-01T00:00:00.000Z",
      created_by: "alice",
      updated_at: "2026-04-01T00:00:00.000Z",
      updated_by: "alice",
    },
  },
};

export const LongTitle: Story = {
  args: {
    issue: {
      ...open,
      issue_type: "epic",
      title:
        "This is a very long issue title that should be truncated with an ellipsis inside the dropdown row instead of wrapping or overflowing the panel",
    },
  },
};

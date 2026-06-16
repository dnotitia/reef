import { mockIssueList } from "@/__stories__/fixtures";
import type { Meta, StoryObj } from "@storybook/react";
import { IssueListRow } from "./IssueListRow";

// Storybook wraps with QueryClient + MSW — see .storybook/preview.tsx
const meta = {
  title: "Issues/IssueListRow",
  component: IssueListRow,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <table>
        <tbody>
          <Story />
        </tbody>
      </table>
    ),
  ],
} satisfies Meta<typeof IssueListRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const [done, open, inProgress, lowPrio, inReview] = mockIssueList;

export const Default: Story = {
  args: {
    issue: open,
    allIssues: mockIssueList,
  },
};

export const WithPriority: Story = {
  args: {
    issue: { ...inProgress, priority: "critical" },
    allIssues: mockIssueList,
  },
};

export const Blocked: Story = {
  args: {
    issue: inProgress, // depends_on REEF-002 which is open
    allIssues: mockIssueList,
  },
};

export const LongTitle: Story = {
  args: {
    issue: {
      ...open,
      title:
        "This is a very long issue title that should be truncated with line-clamp-1 in the table row component",
    },
    allIssues: mockIssueList,
  },
};

export const MinimalFields: Story = {
  args: {
    issue: {
      id: "REEF-010",
      title: "Minimal issue",
      status: "todo",
      created_at: "2026-04-01T00:00:00.000Z",
      created_by: "alice",
      updated_at: "2026-04-01T00:00:00.000Z",
      updated_by: "alice",
    },
    allIssues: mockIssueList,
  },
};

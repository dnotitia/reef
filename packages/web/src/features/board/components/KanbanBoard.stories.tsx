import { mockIssues } from "@/__stories__/fixtures";
/**
 * Storybook stories for KanbanBoard.
 *
 * Uses MSW handlers to mock the underlying HTTP calls.
 * Fixtures are typed from IssueMetadataSchema-derived types (via @reef/core) —
 * no inline `any` types.
 *
 * Run with: pnpm --filter web storybook (port 6006)
 */
import type { Meta, StoryObj } from "@storybook/react";
import { http, HttpResponse } from "msw";
import { KanbanBoard } from "./KanbanBoard";

const meta: Meta<typeof KanbanBoard> = {
  title: "Features/Board/KanbanBoard",
  component: KanbanBoard,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    vault: "reef-acme",
  },
};

export default meta;
type Story = StoryObj<typeof KanbanBoard>;

/**
 * Default — 6 mock issues spread across all 5 statuses.
 * MSW intercepts GET /api/issues and returns mockIssues.
 */
export const Default: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/issues", () => {
          return HttpResponse.json({ issues: mockIssues });
        }),
        http.get("/api/issues/:id", ({ params }) => {
          const issue = mockIssues.find((i) => i.id === params.id);
          return HttpResponse.json({ issue, content: "" });
        }),
      ],
    },
  },
};

/**
 * EmptyBoard — no issues in any column.
 */
export const EmptyBoard: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/issues", () => {
          return HttpResponse.json({ issues: [] });
        }),
      ],
    },
  },
};

/**
 * LoadingState — simulates the loading skeleton while issues are being fetched.
 *
 * MSW does not resolves the request to keep the component in loading state.
 * In practice, useIssueList returns isLoading=true on first fetch.
 */
export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/issues", async () => {
          // does not resolve to keep isLoading state
          await new Promise(() => {});
          return HttpResponse.json({ issues: [] });
        }),
      ],
    },
  },
};

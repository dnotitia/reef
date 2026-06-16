import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useIssueStore } from "../../stores/useIssueStore";
import { FilterBar } from "./FilterBar";

// FilterBar reads the active vault via TanStack Query, so stories need a
// QueryClientProvider. With no vault configured the assignee/requester
// comboboxes render their plain-input fallback.
function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

const meta = {
  title: "Issues/FilterBar",
  component: FilterBar,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => {
      // Reset store before each story
      useIssueStore.setState({
        filter: {},
        searchQuery: "",
        selectedIssueId: null,
      });
      return (
        <QueryClientProvider client={createQueryClient()}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithActiveFilters: Story = {
  decorators: [
    (Story) => {
      useIssueStore.setState({
        filter: { status: ["todo"], priority: ["high"] },
        searchQuery: "",
        selectedIssueId: null,
      });
      return <Story />;
    },
  ],
};

export const AllFiltersActive: Story = {
  decorators: [
    (Story) => {
      useIssueStore.setState({
        filter: {
          status: ["todo"],
          priority: ["critical"],
          assignee: "alice",
          label: "auth",
          due: ["overdue"],
          dependencyFilter: ["blocked"],
        },
        searchQuery: "",
        selectedIssueId: null,
      });
      return <Story />;
    },
  ],
};

import type { Meta, StoryObj } from "@storybook/react";
import { UnreviewedSummaryCard } from "./UnreviewedSummaryCard";

const meta: Meta<typeof UnreviewedSummaryCard> = {
  title: "Activity/UnreviewedSummaryCard",
  component: UnreviewedSummaryCard,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof UnreviewedSummaryCard>;

export const WithDraftsAndNotes: Story = {
  args: {
    draftCount: 2,
    noteCount: 1,
    onDismiss: () => console.log("dismissed"),
  },
};

export const OnlyNotes: Story = {
  args: {
    draftCount: 0,
    noteCount: 3,
    onDismiss: () => console.log("dismissed"),
  },
};

export const OnlyDrafts: Story = {
  args: {
    draftCount: 4,
    noteCount: 0,
    onDismiss: () => console.log("dismissed"),
  },
};

export const ZeroCounts: Story = {
  args: {
    draftCount: 0,
    noteCount: 0,
    onDismiss: () => console.log("dismissed"),
  },
};

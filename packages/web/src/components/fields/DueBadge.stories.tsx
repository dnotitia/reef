import type { Meta, StoryObj } from "@storybook/react";
import { DueBadge } from "./DueBadge";

// Presentational leaf: a glyph + label shown in the Due filter dropdown rows.
// The Due facet buckets an issue by deadline STATE, not a concrete date, so it
// gets its own glyph+color language (calendar-X for overdue, calendar-clock for
// due soon) instead of reusing the date renderer.
const meta = {
  title: "Fields/DueBadge",
  component: DueBadge,
} satisfies Meta<typeof DueBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overdue: Story = { args: { due: "overdue" } };
export const DueSoon: Story = { args: { due: "due_soon" } };

// Both states stacked, so the red (overdue) vs amber (due soon) reading and the
// distinct calendar glyphs are obvious at a glance.
export const All: Story = {
  args: { due: "overdue" },
  render: () => (
    <div className="flex flex-col gap-2">
      {(["overdue", "due_soon"] as const).map((d) => (
        <DueBadge key={d} due={d} />
      ))}
    </div>
  ),
};

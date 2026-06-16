import type { Meta, StoryObj } from "@storybook/react";
import { DependencyBadge } from "./DependencyBadge";

// Presentational leaf: a glyph + label shown in the Dependency filter dropdown
// rows. The facet buckets an issue by its direction in the blocker graph —
// `blocked` (waiting on others, a Ban glyph) vs `blocking` (holding others up, a
// Split glyph) — distinct from BlockedBadge, which counts a single issue's
// unresolved blockers.
const meta = {
  title: "Fields/DependencyBadge",
  component: DependencyBadge,
} satisfies Meta<typeof DependencyBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blocked: Story = { args: { dependency: "blocked" } };
export const Blocking: Story = { args: { dependency: "blocking" } };

// Both directions stacked, so the halted (blocked) vs fans-out (blocking)
// glyphs and their red/amber colors read as a pair.
export const All: Story = {
  args: { dependency: "blocked" },
  render: () => (
    <div className="flex flex-col gap-2">
      {(["blocked", "blocking"] as const).map((d) => (
        <DependencyBadge key={d} dependency={d} />
      ))}
    </div>
  ),
};

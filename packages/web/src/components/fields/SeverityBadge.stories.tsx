import type { Meta, StoryObj } from "@storybook/react";
import { SeverityBadge } from "./SeverityBadge";

// Presentational leaf: a glyph + label shown in severity filter/edit dropdown
// rows. severity is ORDINAL, so the glyph escalates (octagon → triangle →
// circle → info → minus) over a red→gray color ramp, kept visually distinct
// from the priority dot.
const meta = {
  title: "Fields/SeverityBadge",
  component: SeverityBadge,
} satisfies Meta<typeof SeverityBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blocker: Story = { args: { severity: "blocker" } };
export const Critical: Story = { args: { severity: "critical" } };
export const Major: Story = { args: { severity: "major" } };
export const Minor: Story = { args: { severity: "minor" } };
export const Trivial: Story = { args: { severity: "trivial" } };

// The full ordinal ramp, top to bottom, so the red→gray progression reads at a
// glance and does not collides with the priority dot's shape.
export const Ramp: Story = {
  args: { severity: "blocker" },
  render: () => (
    <div className="flex flex-col gap-2">
      {(["blocker", "critical", "major", "minor", "trivial"] as const).map(
        (s) => (
          <SeverityBadge key={s} severity={s} />
        ),
      )}
    </div>
  ),
};

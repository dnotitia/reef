// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "./segmentedControl";

// REEF-261: these tokens are the single canonical reference for the segmented-control
// family (ViewSwitcher / SettingsTabs / Planning kind toggle). Locking them here
// is what keeps the three from drifting apart again.
describe("segmentedControl shared tokens (REEF-261)", () => {
  it("track is the bordered bg-elevated rail shared by the family", () => {
    const classes = SEGMENTED_CONTROL_TRACK.split(/\s+/);
    expect(classes).toContain("border");
    expect(classes).toContain("border-border-subtle");
    expect(classes).toContain("bg-elevated");
    expect(classes).toContain("gap-0.5");
    expect(classes).toContain("p-0.5");
  });

  it("item carries the canonical ViewSwitcher dimensions and ring-brand focus", () => {
    const classes = SEGMENTED_CONTROL_ITEM.split(/\s+/);
    expect(classes).toContain("px-2");
    expect(classes).toContain("py-1");
    expect(classes).toContain("text-[12px]");
    expect(classes).toContain("font-medium");
    expect(classes).toContain("focus-visible:ring-2");
    expect(classes).toContain("focus-visible:ring-brand");
    // None of the prior Planning-toggle outlier classes.
    expect(classes).not.toContain("text-sm");
    expect(classes).not.toContain("px-3");
    expect(classes).not.toContain("py-1.5");
    expect(classes).not.toContain("focus-visible:ring-ring");
    expect(classes).not.toContain("focus-visible:ring-offset-1");
  });

  it("active and inactive fills match the family", () => {
    expect(SEGMENTED_CONTROL_ITEM_ACTIVE.split(/\s+/)).toContain(
      "bg-surface-hover",
    );
    expect(SEGMENTED_CONTROL_ITEM_INACTIVE.split(/\s+/)).toContain(
      "text-muted-foreground",
    );
  });
});

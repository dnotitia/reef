// @vitest-environment node

// fake-indexeddb/auto should be imported first — before any Dexie/db imports
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  DETECTION_COOLDOWN_MS,
  getLastScanAt,
  setLastScanAt,
  shouldAutoScan,
} from "./lastScan";

describe("lastScan", () => {
  beforeEach(async () => {
    await db.config.clear();
  });

  afterEach(async () => {
    await db.config.clear();
  });

  it("returns undefined when no scan has been recorded", async () => {
    expect(await getLastScanAt("octo/cat")).toBeUndefined();
  });

  it("round-trips a stored timestamp", async () => {
    const ts = "2026-05-08T09:45:00.000Z";
    await setLastScanAt("octo/cat", ts);
    expect(await getLastScanAt("octo/cat")).toBe(ts);
  });

  it("keys are per-repo so two repos do not collide", async () => {
    await setLastScanAt("octo/cat", "2026-05-08T08:00:00.000Z");
    await setLastScanAt("octo/dog", "2026-05-08T09:00:00.000Z");
    expect(await getLastScanAt("octo/cat")).toBe("2026-05-08T08:00:00.000Z");
    expect(await getLastScanAt("octo/dog")).toBe("2026-05-08T09:00:00.000Z");
  });

  it("shouldAutoScan returns true when no scan recorded", async () => {
    expect(await shouldAutoScan("octo/cat")).toBe(true);
  });

  it("shouldAutoScan returns false within cooldown", async () => {
    const now = new Date("2026-05-08T10:00:00.000Z");
    const fresh = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    await setLastScanAt("octo/cat", fresh);
    expect(await shouldAutoScan("octo/cat", now)).toBe(false);
  });

  it("shouldAutoScan returns true after cooldown elapses", async () => {
    const now = new Date("2026-05-08T10:00:00.000Z");
    const stale = new Date(
      now.getTime() - DETECTION_COOLDOWN_MS - 60_000,
    ).toISOString();
    await setLastScanAt("octo/cat", stale);
    expect(await shouldAutoScan("octo/cat", now)).toBe(true);
  });

  it("shouldAutoScan returns true when stored timestamp is unparseable", async () => {
    await setLastScanAt("octo/cat", "not-a-date");
    expect(await shouldAutoScan("octo/cat")).toBe(true);
  });
});

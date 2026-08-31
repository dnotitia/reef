// @vitest-environment node

// fake-indexeddb/auto should be imported first — before any Dexie/db imports
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllIssueChangeReviewPeriods,
  getActiveVault,
  getConfigValue,
  getIssueChangeReviewPeriod,
  setActiveVault,
  setConfigValue,
  setIssueChangeReviewPeriod,
} from "./config";
import { db } from "./db";

describe("config setters — vault + key-value bag", () => {
  beforeEach(async () => {
    await db.config.clear();
  });

  afterEach(async () => {
    await db.config.clear();
  });

  describe("setActiveVault / getActiveVault", () => {
    it("round-trips a valid vault name and reads it back", async () => {
      await setActiveVault("reef-acme");
      expect(await getActiveVault()).toBe("reef-acme");
    });

    it("accepts the empty string sentinel (clears the active vault)", async () => {
      await setActiveVault("reef-acme");
      await setActiveVault("");
      expect(await getActiveVault()).toBe("");
    });

    it("returns empty string when no vault has been set", async () => {
      expect(await getActiveVault()).toBe("");
    });

    it("throws TypeError on a non-string value", async () => {
      await expect(
        // biome-ignore lint/suspicious/noExplicitAny: probing type guard
        setActiveVault(42 as any),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it("throws TypeError on a malformed vault name", async () => {
      await expect(setActiveVault("Bad Vault")).rejects.toBeInstanceOf(
        TypeError,
      );
      await expect(setActiveVault("Bad/Vault")).rejects.toBeInstanceOf(
        TypeError,
      );
    });
  });

  describe("setConfigValue / getConfigValue (key-value bag)", () => {
    it("round-trips an arbitrary key", async () => {
      await setConfigValue("custom_key", "custom_value");
      expect(await getConfigValue("custom_key")).toBe("custom_value");
    });

    it("replaces the value on subsequent writes (single row per key)", async () => {
      await setConfigValue("custom_key", "v1");
      await setConfigValue("custom_key", "v2");
      expect(await getConfigValue("custom_key")).toBe("v2");
      const rows = await db.config.where("key").equals("custom_key").toArray();
      expect(rows).toHaveLength(1);
    });
  });

  describe("issue change-review period preference", () => {
    it("round-trips per-vault relative days and rejects invalid values", async () => {
      expect(await getIssueChangeReviewPeriod("reef-acme")).toBeUndefined();

      await setIssueChangeReviewPeriod("reef-acme", 3);

      expect(await getIssueChangeReviewPeriod("reef-acme")).toBe(3);
      expect(await getIssueChangeReviewPeriod("reef-other")).toBeUndefined();
      await expect(
        setIssueChangeReviewPeriod("reef-acme", 0),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        setIssueChangeReviewPeriod("reef-acme", 366),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it("discards corrupt values and clears every vault slot", async () => {
      await setConfigValue("change-review-period:reef-acme", "not-json");
      await setIssueChangeReviewPeriod("reef-other", 14);

      expect(await getIssueChangeReviewPeriod("reef-acme")).toBeUndefined();
      expect(await getIssueChangeReviewPeriod("reef-other")).toBe(14);

      await clearAllIssueChangeReviewPeriods();

      expect(await getIssueChangeReviewPeriod("reef-acme")).toBeUndefined();
      expect(await getIssueChangeReviewPeriod("reef-other")).toBeUndefined();
    });
  });
});

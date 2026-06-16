// @vitest-environment node

// fake-indexeddb/auto should be imported first — before any Dexie/db imports
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getActiveVault,
  getActivityRepo,
  getConfigValue,
  setActiveVault,
  setActivityRepo,
  setConfigValue,
} from "./config";
import { db } from "./db";

describe("config setters — vault + activityRepo (akb pivot)", () => {
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

  describe("setActivityRepo / getActivityRepo (per-vault pointer)", () => {
    it("scopes the activityRepo by vault — distinct vaults have distinct pointers", async () => {
      await setActivityRepo("reef-acme", "octo/cat");
      await setActivityRepo("reef-zen", "moshi/koi");
      expect(await getActivityRepo("reef-acme")).toBe("octo/cat");
      expect(await getActivityRepo("reef-zen")).toBe("moshi/koi");
    });

    it("returns undefined when no pointer is saved yet", async () => {
      expect(await getActivityRepo("reef-acme")).toBeUndefined();
    });

    it("returns undefined when vault is empty", async () => {
      expect(await getActivityRepo("")).toBeUndefined();
    });

    it("accepts an empty string to clear the pointer (so consumers fall back to monitored_repos[0])", async () => {
      await setActivityRepo("reef-acme", "octo/cat");
      await setActivityRepo("reef-acme", "");
      expect(await getActivityRepo("reef-acme")).toBe("");
    });

    it("throws TypeError on a malformed `owner/repo`", async () => {
      await expect(
        setActivityRepo("reef-acme", "no-slash"),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it("throws TypeError when vault is empty", async () => {
      await expect(setActivityRepo("", "octo/cat")).rejects.toBeInstanceOf(
        TypeError,
      );
    });

    it("uses the canonical `activity_repo:{vault}` key in the config store", async () => {
      await setActivityRepo("reef-acme", "octo/cat");
      expect(await getConfigValue("activity_repo:reef-acme")).toBe("octo/cat");
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
});

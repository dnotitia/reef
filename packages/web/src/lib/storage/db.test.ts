// @vitest-environment node

// fake-indexeddb/auto should be imported first — before any Dexie/db imports
import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";

describe("Dexie schema — reef IndexedDB (akb pivot)", () => {
  beforeEach(async () => {
    await db.config.clear();
  });

  afterEach(async () => {
    await db.config.clear();
  });

  describe("store shape", () => {
    it("opens at the current claimed version (>= 11)", async () => {
      await db.open();
      expect(db.verno).toBeGreaterThanOrEqual(11);
    });

    it("exposes the expected live store", () => {
      const names = db.tables.map((t) => t.name).sort();
      expect(names).toEqual(["config"]);
    });
  });

  describe("config store (key-value bag)", () => {
    it("stores client-only keys (vault, theme)", async () => {
      await db.config.bulkAdd([
        { key: "vault", value: "reef-acme" },
        { key: "theme", value: "dark" },
      ]);
      expect(
        (await db.config.where("key").equals("vault").first())?.value,
      ).toBe("reef-acme");
    });

    it("supports per-vault scoped keys (activity_repo:{vault})", async () => {
      await db.config.add({
        key: "activity_repo:reef-acme",
        value: "octo/cat",
      });
      const row = await db.config
        .where("key")
        .equals("activity_repo:reef-acme")
        .first();
      expect(row?.value).toBe("octo/cat");
    });
  });

  // reverse-move guard: removing a store from a SAME-version declaration does
  // not drop it for a browser already at that version — IndexedDB deletes object
  // stores only inside a higher-version transaction. The schema therefore bumps
  // through v10/v11 and declares removed stores as `null`.
  describe("older store removal (v9 -> v11 upgrade)", () => {
    it("drops removed draft/cache stores and the stale browser credential store", async () => {
      const NAME = "reef-upgrade-regression";
      await Dexie.delete(NAME);

      // Simulate a browser already at the old 5-store v9 schema.
      const older = new Dexie(NAME);
      older.version(9).stores({
        credentials: "++id, key",
        config: "++id, key",
        auto_issue_drafts: "id, status",
        dismissed_suggestions: "++id, ref",
        cache: "id, fetchedAt",
      });
      await older.open();
      await older.table("credentials").add({
        key: "github_token",
        value: "ghp_stale",
      });
      expect(older.tables.map((t) => t.name).sort()).toEqual(
        [
          "auto_issue_drafts",
          "cache",
          "config",
          "credentials",
          "dismissed_suggestions",
        ].sort(),
      );
      older.close();

      // re-open the SAME database with the production schema (full v9 set + the
      // v10/v11 null-drops). The upgrade should delete old stores and any stale
      // browser GitHub PAT row with them.
      const upgraded = new Dexie(NAME);
      upgraded.version(9).stores({
        credentials: "++id, key",
        config: "++id, key",
        auto_issue_drafts: "id, status",
        dismissed_suggestions: "++id, ref",
        cache: "id, fetchedAt",
      });
      upgraded.version(10).stores({
        auto_issue_drafts: null,
        dismissed_suggestions: null,
        cache: null,
      });
      upgraded.version(11).stores({
        credentials: null,
      });
      await upgraded.open();
      expect(upgraded.verno).toBe(11);
      expect(upgraded.tables.map((t) => t.name).sort()).toEqual(["config"]);
      upgraded.close();
      await Dexie.delete(NAME);
    });
  });
});

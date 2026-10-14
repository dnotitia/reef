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

    it("supports per-vault scoped issue filter keys", async () => {
      await db.config.add({
        key: "filter:reef-acme",
        value: "{}",
      });
      const row = await db.config
        .where("key")
        .equals("filter:reef-acme")
        .first();
      expect(row?.value).toBe("{}");
    });
  });

  // reverse-move guard: removing a store from a SAME-version declaration does
  // not drop it for a browser already at that version — IndexedDB deletes object
  // stores just inside a higher-version transaction. The schema therefore bumps
  // through v10/v11 and declares removed stores as `null`.
  describe("older store removal (v9 -> v11 upgrade)", () => {
    it("drops removed draft/cache stores and the stale browser credential store", async () => {
      db.close();
      await db.delete();
      const older = new Dexie(db.name);
      try {
        // Historical fixture only; the production owner performs the upgrade.
        older.version(9).stores({
          credentials: "++id, key",
          config: "++id, key",
          auto_issue_drafts: "id, status",
          dismissed_suggestions: "++id, ref",
          cache: "id, fetchedAt",
        });
        await older.open();
        await older
          .table("credentials")
          .add({ key: "github_token", value: "ghp_stale" });
        await older.table("config").add({ key: "theme", value: "dark" });
        older.close();

        await db.open();
        expect(Array.from(db.backendDB().objectStoreNames)).toEqual(["config"]);
        expect(
          (await db.config.where("key").equals("theme").first())?.value,
        ).toBe("dark");
      } finally {
        older.close();
        db.close();
        await db.delete();
        await db.open();
      }
    });
  });
});

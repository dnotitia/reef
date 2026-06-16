// @vitest-environment node

// fake-indexeddb/auto should be imported first — before any Dexie/db imports
import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";

describe("Dexie schema — reef IndexedDB (akb pivot)", () => {
  beforeEach(async () => {
    await Promise.all([db.credentials.clear(), db.config.clear()]);
  });

  afterEach(async () => {
    await Promise.all([db.credentials.clear(), db.config.clear()]);
  });

  describe("store shape", () => {
    it("opens at the current claimed version (>= 9)", async () => {
      await db.open();
      expect(db.verno).toBeGreaterThanOrEqual(9);
    });

    it("exposes the two expected stores", () => {
      const names = db.tables.map((t) => t.name).sort();
      expect(names).toEqual(["config", "credentials"].sort());
    });
  });

  describe("credentials store (per-user secrets)", () => {
    it("stores arbitrary key/value entries (github_token, llm_api_key)", async () => {
      await db.credentials.add({ key: "github_token", value: "ghp_xxx" });
      await db.credentials.add({ key: "llm_api_key", value: "sk-xxx" });

      const gh = await db.credentials
        .where("key")
        .equals("github_token")
        .first();
      const llm = await db.credentials
        .where("key")
        .equals("llm_api_key")
        .first();
      expect(gh?.value).toBe("ghp_xxx");
      expect(llm?.value).toBe("sk-xxx");
    });

    it("does NOT store the akb session JWT — that belongs in the __reef_session httpOnly cookie", async () => {
      // Sanity invariant: no row should ever be keyed "akb_session" / "reef_session".
      // Test future-proofs against accidental migrations that try to mirror the JWT.
      const akb = await db.credentials
        .where("key")
        .anyOf(["akb_session", "reef_session", "session_jwt"])
        .first();
      expect(akb).toBeUndefined();
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

  // reverse-move guard: removing a store from a SAME-version declaration does not
  // drop it for a browser already at that version — IndexedDB just deletes
  // object stores inside a versionchange (higher-version) transaction. The
  // schema therefore bumps to v10 and declares the removed stores as `null`.
  // Uses a throwaway DB name so it does not collides with the `reef` singleton the
  // other tests open. Mirrors the production schema in `db.ts`.
  describe("older store removal (v9 -> v10 upgrade)", () => {
    it("drops auto_issue_drafts / dismissed_suggestions / cache for an existing v9 database", async () => {
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
      // v10 null-drops). The v9 -> v10 upgrade should delete the three old stores.
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
      await upgraded.open();
      expect(upgraded.verno).toBe(10);
      expect(upgraded.tables.map((t) => t.name).sort()).toEqual(
        ["config", "credentials"].sort(),
      );
      upgraded.close();
      await Dexie.delete(NAME);
    });
  });
});

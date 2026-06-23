// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setConfigValue } from "../../../lib/storage/config";
import { db } from "../../../lib/storage/db";
import { useLocaleStore } from "./useLocaleStore";

function resetStore() {
  useLocaleStore.setState({ locale: null, hydrated: false, hydrating: false });
}

function clearCookies() {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

describe("useLocaleStore", () => {
  beforeEach(async () => {
    resetStore();
    document.documentElement.lang = "";
    clearCookies();
    await db.config.clear();
  });

  afterEach(async () => {
    resetStore();
    document.documentElement.lang = "";
    clearCookies();
    await db.config.clear();
  });

  it("hydrate loads a stored choice and restores lang + cookie", async () => {
    await setConfigValue("locale", "ko");

    await useLocaleStore.getState().hydrate();

    expect(useLocaleStore.getState().locale).toBe("ko");
    expect(useLocaleStore.getState().hydrated).toBe(true);
    expect(document.documentElement.lang).toBe("ko");
    expect(document.cookie).toContain("NEXT_LOCALE=ko");
  });

  it("hydrate leaves locale null when nothing is stored (detection governs)", async () => {
    await useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBeNull();
    expect(useLocaleStore.getState().hydrated).toBe(true);
  });

  it("hydrate ignores an unsupported stored value", async () => {
    await setConfigValue("locale", "fr");
    await useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBeNull();
  });

  it("hydrate is idempotent — a second call does not clobber a newer value", async () => {
    await setConfigValue("locale", "ko");
    await useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBe("ko");

    useLocaleStore.setState({ locale: "en" });
    await useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBe("en");
  });

  it("does not revert a choice picked while the initial read is in flight", async () => {
    await setConfigValue("locale", "en");

    const hydrating = useLocaleStore.getState().hydrate();
    await useLocaleStore.getState().setLocale("ko");
    await hydrating;

    expect(useLocaleStore.getState().locale).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");
    expect(useLocaleStore.getState().hydrated).toBe(true);
  });

  it("setLocale persists to Dexie, applies lang, and mirrors the cookie (AC2)", async () => {
    await useLocaleStore.getState().setLocale("ko");

    expect(useLocaleStore.getState().locale).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");
    expect(document.cookie).toContain("NEXT_LOCALE=ko");
    const row = await db.config.where("key").equals("locale").first();
    expect(row?.value).toBe("ko");
  });
});

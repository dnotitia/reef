// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSql: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("../core/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("../core/shared")>();
  return {
    ...original,
    runSql: mocks.runSql,
    verifyWorkspaceSchema: mocks.verify,
  };
});

import { writeInitialConfig } from "./config";

const config = {
  project_prefix: "REEF",
  monitored_repos: [
    {
      github_id: 42,
      owner: "dnotitia",
      name: "reef",
      description: "PM workspace",
    },
  ],
  authoring_language: "ko" as const,
  stale_hide_completed_days: 28,
  stale_hide_canceled_days: 7,
  ai_scanning_enabled: false,
};

describe("writeInitialConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runSql.mockResolvedValue({ kind: "table_sql", result: "INSERT 0 1" });
    mocks.verify.mockResolvedValue({
      schemaVersion: 1,
      manifestVerified: true,
    });
  });

  it("uses deterministic primary-key upserts with no destructive statement", async () => {
    const adapter = { request: vi.fn() };
    const invoke = () =>
      writeInitialConfig({
        adapter,
        vault: "reef-sample",
        config,
        fingerprint: "a".repeat(64),
      });

    await invoke();
    const firstSql = mocks.runSql.mock.calls.map((call) => String(call[2]));
    mocks.runSql.mockClear();
    await invoke();
    const retrySql = mocks.runSql.mock.calls.map((call) => String(call[2]));

    expect(firstSql).toEqual(retrySql);
    expect(firstSql).toHaveLength(6);
    expect(firstSql.every((sql) => sql.startsWith("INSERT INTO "))).toBe(true);
    expect(firstSql.every((sql) => sql.includes("ON CONFLICT (id)"))).toBe(
      true,
    );
    expect(firstSql.join("\n")).not.toContain("DELETE");

    const ids = firstSql.map(
      (sql) => sql.match(/VALUES \('([0-9a-f-]{36})'/)?.[1],
    );
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives a disjoint row set for a different request fingerprint", async () => {
    const adapter = { request: vi.fn() };
    await writeInitialConfig({
      adapter,
      vault: "reef-sample",
      config,
      fingerprint: "a".repeat(64),
    });
    const firstSql = mocks.runSql.mock.calls.map((call) => String(call[2]));
    mocks.runSql.mockClear();

    await writeInitialConfig({
      adapter,
      vault: "reef-sample",
      config,
      fingerprint: "b".repeat(64),
    });
    const secondSql = mocks.runSql.mock.calls.map((call) => String(call[2]));

    expect(firstSql).not.toEqual(secondSql);
  });
});

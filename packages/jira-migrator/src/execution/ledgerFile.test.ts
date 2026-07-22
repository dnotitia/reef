import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJiraMigrationLedger, openJiraMigrationRun } from "../ledger.js";
import { fingerprintJiraState } from "./diff.js";
import {
  JiraMigrationLedgerFileError,
  loadJiraMigrationLedger,
  writeJiraMigrationLedger,
} from "./ledgerFile.js";

const scope = { jiraCloudId: "cloud-1", targetVault: "reef-target" } as const;

describe("Jira migration ledger file", () => {
  it("treats only a missing file as an empty v1 artifact and round-trips privately", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) =>
      mkdtemp(join(process.env.TMPDIR ?? "/tmp", "reef-ledger-")),
    );
    await chmod(root, 0o700);
    const path = join(root, "ledger.json");
    const empty = await loadJiraMigrationLedger({ path, ...scope });
    expect(empty).toEqual(createJiraMigrationLedger(scope));
    await writeJiraMigrationLedger({ path, ledger: empty });
    expect(await loadJiraMigrationLedger({ path, ...scope })).toEqual(empty);
    expect(
      (await import("node:fs/promises").then(({ stat }) => stat(path))).mode &
        0o777,
    ).toBe(0o600);
  });

  it.each([
    ["malformed", "{", "malformed_json"],
    ["version", '{"schema_version":2}', "unsupported_schema_version"],
  ])(
    "rejects %s content without replacing it",
    async (_name, content, code) => {
      const root = await import("node:fs/promises").then(({ mkdtemp }) =>
        mkdtemp(join(process.env.TMPDIR ?? "/tmp", "reef-ledger-invalid-")),
      );
      await chmod(root, 0o700);
      const path = join(root, "ledger.json");
      await writeFile(path, content, { mode: 0o600 });
      await expect(
        loadJiraMigrationLedger({ path, ...scope }),
      ).rejects.toMatchObject({ code });
      expect(await readFile(path, "utf8")).toBe(content);
    },
  );

  it("rejects scope mismatch, stale lock, and secret material without damaging the ledger", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) =>
      mkdtemp(join(process.env.TMPDIR ?? "/tmp", "reef-ledger-safe-")),
    );
    await chmod(root, 0o700);
    const path = join(root, "ledger.json");
    const ledger = createJiraMigrationLedger(scope);
    await writeJiraMigrationLedger({ path, ledger });
    const before = await readFile(path, "utf8");
    await expect(
      loadJiraMigrationLedger({
        path,
        jiraCloudId: "other",
        targetVault: "reef-target",
      }),
    ).rejects.toMatchObject({ code: "source_scope_mismatch" });
    await expect(
      loadJiraMigrationLedger({
        path,
        jiraCloudId: "cloud-1",
        targetVault: "other",
      }),
    ).rejects.toMatchObject({ code: "target_scope_mismatch" });

    await writeFile(`${path}.lock`, "held\n", { mode: 0o600, flag: "wx" });
    await expect(
      loadJiraMigrationLedger({ path, ...scope }),
    ).rejects.toMatchObject({ code: "lock_conflict" });
    await expect(
      writeJiraMigrationLedger({ path, ledger }),
    ).rejects.toMatchObject({
      code: "lock_conflict",
    });
    expect(await readFile(path, "utf8")).toBe(before);

    await expect(
      writeJiraMigrationLedger({
        path: join(root, "secret.json"),
        ledger: { ...ledger, authorization: "Bearer hidden" } as never,
        forbiddenSecretValues: ["hidden"],
      }),
    ).rejects.toBeInstanceOf(JiraMigrationLedgerFileError);
  });

  it("rejects a stale whole-ledger write after another writer commits", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) =>
      mkdtemp(join(process.env.TMPDIR ?? "/tmp", "reef-ledger-cas-")),
    );
    await chmod(root, 0o700);
    const path = join(root, "ledger.json");
    const initial = createJiraMigrationLedger(scope);
    await writeJiraMigrationLedger({ path, ledger: initial });
    const loaded = await loadJiraMigrationLedger({ path, ...scope });
    const firstWriter = openJiraMigrationRun(loaded, {
      runId: "run-first",
      projectKeys: ["ALPHA"],
      planFingerprint: fingerprintJiraState({ plan: "first" }),
      at: "2026-07-21T00:00:00.000Z",
    });
    await writeJiraMigrationLedger({
      path,
      ledger: firstWriter,
      expectedLedger: loaded,
    });
    const staleWriter = openJiraMigrationRun(loaded, {
      runId: "run-stale",
      projectKeys: ["BETA"],
      planFingerprint: fingerprintJiraState({ plan: "stale" }),
      at: "2026-07-21T00:00:01.000Z",
    });

    await expect(
      writeJiraMigrationLedger({
        path,
        ledger: staleWriter,
        expectedLedger: loaded,
      }),
    ).rejects.toMatchObject({ code: "stale_ledger" });
    await expect(
      writeJiraMigrationLedger({ path, ledger: firstWriter }),
    ).rejects.toMatchObject({ code: "write_precondition_required" });
    expect(await loadJiraMigrationLedger({ path, ...scope })).toEqual(
      firstWriter,
    );
  });
});

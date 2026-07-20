import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJiraMigrationLedger } from "./ledger.js";
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
});

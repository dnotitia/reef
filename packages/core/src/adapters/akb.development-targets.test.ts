import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
  DevelopmentTargetError,
} from "../index";
import {
  ALL_REEF_TABLES,
  listDevelopmentTargets,
  makeAdapter,
  makeListTablesResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  setupFetch,
  writeDevelopmentTarget,
} from "./akb.testSupport";

const catalog = DEFAULT_DEVELOPMENT_PROFILE_CATALOG;
const target = {
  github_id: 1001,
  enabled: true,
  recipe_path: ".reef/agent.yml",
  runner_profile: "default",
  permission_profile: ":workspace",
  branch_template: "agent/{issue_id}/{run_id}",
};

describe("development target adapter", () => {
  it("left joins monitored repos and keeps missing targets fail closed", async () => {
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [
            {
              github_id: "1001",
              owner: "octo",
              name: "reef",
              description: null,
              target_github_id: null,
            },
          ],
          ["github_id", "owner", "name", "description", "target_github_id"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const items = await listDevelopmentTargets({
      adapter,
      vault: "reef-sample",
      catalog,
    });
    expect(items[0]).toMatchObject({
      repo: { github_id: 1001, owner: "octo", name: "reef" },
      config: null,
      eligibility: { eligible: false, reason: "target_missing" },
    });
  });

  it("marks duplicate target rows invalid instead of selecting a winner", async () => {
    const duplicate = {
      owner: "octo",
      name: "reef",
      target_github_id: 1001,
      ...target,
    };
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [duplicate, duplicate],
          Object.keys(duplicate),
        ),
      },
    ]);
    const adapter = makeAdapter();
    const [item] = await listDevelopmentTargets({
      adapter,
      vault: "reef-sample",
      catalog,
    });
    expect(item?.eligibility).toEqual({
      eligible: false,
      reason: "target_invalid",
    });
    expect(item?.config).toBeNull();
  });

  it("validates monitored membership before inserting a new target", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ github_id: 1001 }], ["github_id"]) },
      { body: makeSqlQueryResponse([], ["id"]) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    await expect(
      writeDevelopmentTarget({
        adapter,
        vault: "reef-sample",
        catalog,
        target,
      }),
    ).resolves.toEqual(target);
    const insertSql = JSON.parse(String(calls[3]?.init?.body)).sql as string;
    expect(insertSql).toContain("INSERT INTO reef_development_targets");
    expect(insertSql).not.toContain("credential");
  });

  it("updates an existing target without deleting the last known policy", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ github_id: 1001 }], ["github_id"]) },
      { body: makeSqlQueryResponse([{ id: "target-row-1" }], ["id"]) },
      { body: makeSqlMutationResponse("UPDATE 1") },
    ]);
    const adapter = makeAdapter();
    await expect(
      writeDevelopmentTarget({
        adapter,
        vault: "reef-sample",
        catalog,
        target,
      }),
    ).resolves.toEqual(target);
    const updateSql = JSON.parse(String(calls[3]?.init?.body)).sql as string;
    expect(updateSql).toContain("UPDATE reef_development_targets SET");
    expect(updateSql).toContain("WHERE id = 'target-row-1'");
    expect(updateSql).not.toContain("DELETE FROM");
  });

  it("retains one updated policy while cleaning up duplicate rows", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ github_id: 1001 }], ["github_id"]) },
      {
        body: makeSqlQueryResponse(
          [{ id: "target-row-1" }, { id: "target-row-2" }],
          ["id"],
        ),
      },
      { body: makeSqlMutationResponse("UPDATE 1") },
      { body: makeSqlMutationResponse("DELETE 1") },
    ]);
    const adapter = makeAdapter();
    await writeDevelopmentTarget({
      adapter,
      vault: "reef-sample",
      catalog,
      target,
    });
    const cleanupSql = JSON.parse(String(calls[4]?.init?.body)).sql as string;
    expect(cleanupSql).toContain("DELETE FROM reef_development_targets");
    expect(cleanupSql).toContain("id <> 'target-row-1'");
  });

  it("rejects an unmonitored github id without creating a row", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([], ["github_id"]) },
    ]);
    const adapter = makeAdapter();
    await expect(
      writeDevelopmentTarget({
        adapter,
        vault: "reef-sample",
        catalog,
        target,
      }),
    ).rejects.toBeInstanceOf(DevelopmentTargetError);
    expect(calls).toHaveLength(2);
  });
});

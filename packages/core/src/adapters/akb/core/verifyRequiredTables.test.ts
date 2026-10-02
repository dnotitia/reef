import { describe, expect, it, vi } from "vitest";
import {
  AkbApiError,
  AuthError,
  WorkspaceReadinessError,
} from "../../../errors";
import { REEF_DESIRED_TABLES, type AkbTableColumn } from "./tableManifest";
import { verifyRequiredTables } from "./verifyRequiredTables";
import type { AkbAdapter } from "./http";

function tableList(vault = "reef-sample") {
  return {
    kind: "table",
    vault,
    items: REEF_DESIRED_TABLES.map((table) => ({
      name: table.name,
      columns: table.columns.map(({ required, ...column }) =>
        required === true ? { ...column, required: true } : column,
      ),
      unique_keys: structuredClone(table.unique_keys ?? []),
      indexes: structuredClone(table.indexes ?? []),
    })),
  };
}

function notificationTable(payload: ReturnType<typeof tableList>) {
  const table = payload.items.find(
    (item) => item.name === "reef_notifications",
  );
  if (!table) throw new Error("notification table missing from test fixture");
  return table;
}

function issueTable(payload: ReturnType<typeof tableList>) {
  const table = payload.items.find((item) => item.name === "reef_issues");
  if (!table) throw new Error("issue table missing from test fixture");
  return table;
}

function notificationFirstColumn(
  payload: ReturnType<typeof tableList>,
): AkbTableColumn {
  const column = notificationTable(payload).columns[0];
  if (!column) throw new Error("notification column missing from test fixture");
  return column;
}

function makeAdapter(response: unknown = tableList()) {
  const request = vi.fn(async () => response);
  return { adapter: { request } as unknown as AkbAdapter, request };
}

describe("verifyRequiredTables", () => {
  it("verifies the full canonical table shape with one read-only catalog request", async () => {
    const { adapter, request } = makeAdapter();

    await verifyRequiredTables({
      adapter,
      vault: "reef-sample",
      canManage: true,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/v1/tables/reef-sample", {
      resource: "tables in vault reef-sample",
    });
  });

  it("blocks a missing canonical lookup index using only the read-only catalog", async () => {
    const expected = issueTable(tableList());
    expect(expected.indexes.map((index) => index.columns)).toEqual([
      ["reef_id"],
      ["document_uri"],
      ["parent_id"],
      ["status"],
    ]);

    const response = tableList();
    issueTable(response).indexes.pop();
    const { adapter, request } = makeAdapter(response);

    await expect(
      verifyRequiredTables({ adapter, vault: "reef-sample", canManage: true }),
    ).rejects.toMatchObject({
      name: "WorkspaceReadinessError",
      reason: "required_tables_mismatch",
      status: 409,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/v1/tables/reef-sample", {
      resource: "tables in vault reef-sample",
    });
  });

  it.each([
    [
      "column type",
      (payload: ReturnType<typeof tableList>) => {
        notificationFirstColumn(payload).type = "int";
      },
    ],
    [
      "required flag",
      (payload: ReturnType<typeof tableList>) => {
        notificationFirstColumn(payload).required = false;
      },
    ],
    [
      "unique keys",
      (payload: ReturnType<typeof tableList>) => {
        notificationTable(payload).unique_keys.pop();
      },
    ],
    [
      "indexes",
      (payload: ReturnType<typeof tableList>) => {
        notificationTable(payload).indexes.length = 0;
      },
    ],
  ])("blocks a canonical %s mismatch", async (_field, mutate) => {
    const response = tableList();
    mutate(response);
    const { adapter } = makeAdapter(response);

    await expect(
      verifyRequiredTables({ adapter, vault: "reef-sample", canManage: true }),
    ).rejects.toMatchObject({
      name: "WorkspaceReadinessError",
      reason: "required_tables_mismatch",
      status: 409,
    });
  });

  it("reports a missing required table without attempting to create it", async () => {
    const response = tableList();
    response.items = response.items.filter(
      (table) => table.name !== "reef_comments",
    );
    const { adapter, request } = makeAdapter(response);

    await expect(
      verifyRequiredTables({ adapter, vault: "reef-sample", canManage: true }),
    ).rejects.toMatchObject({ reason: "required_tables_missing", status: 409 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong vault envelope", { ...tableList(), vault: "other-vault" }],
    [
      "missing column metadata",
      {
        kind: "table",
        vault: "reef-sample",
        items: [{ name: "reef_settings" }],
      },
    ],
  ])("rejects malformed catalog data: %s", async (_case, response) => {
    const { adapter } = makeAdapter(response);
    await expect(
      verifyRequiredTables({ adapter, vault: "reef-sample", canManage: true }),
    ).rejects.toMatchObject({
      reason: "required_tables_invalid_response",
      status: 502,
    });
  });

  it("collapses member schema details to a generic owner action", async () => {
    const response = tableList();
    response.items = [];
    const { adapter } = makeAdapter(response);

    await expect(
      verifyRequiredTables({ adapter, vault: "reef-sample", canManage: false }),
    ).rejects.toMatchObject({
      reason: "owner_action_required",
      status: 403,
      message: expect.not.stringContaining("reef_settings"),
    });
  });

  it("keeps resource-forbidden, transport, unavailable, and session failures distinct", async () => {
    const forbidden = makeAdapter();
    forbidden.request.mockRejectedValueOnce(
      new AuthError({ origin: "akb", status: 403 }),
    );
    await expect(
      verifyRequiredTables({
        adapter: forbidden.adapter,
        vault: "reef-sample",
        canManage: true,
      }),
    ).rejects.toMatchObject({
      reason: "required_tables_forbidden",
      status: 403,
    });

    const transport = makeAdapter();
    transport.request.mockRejectedValueOnce(
      new AkbApiError({ status: 0, message: "network" }),
    );
    await expect(
      verifyRequiredTables({
        adapter: transport.adapter,
        vault: "reef-sample",
        canManage: true,
      }),
    ).rejects.toMatchObject({
      reason: "required_tables_transport",
      status: 503,
    });

    const unavailable = makeAdapter();
    unavailable.request.mockRejectedValueOnce(
      new AkbApiError({ status: 503, message: "unavailable" }),
    );
    await expect(
      verifyRequiredTables({
        adapter: unavailable.adapter,
        vault: "reef-sample",
        canManage: true,
      }),
    ).rejects.toMatchObject({
      reason: "required_tables_unavailable",
      status: 503,
    });

    const unauthenticated = makeAdapter();
    const authError = new AuthError({ origin: "akb", status: 401 });
    unauthenticated.request.mockRejectedValueOnce(authError);
    await expect(
      verifyRequiredTables({
        adapter: unauthenticated.adapter,
        vault: "reef-sample",
        canManage: true,
      }),
    ).rejects.toBe(authError);
  });
});

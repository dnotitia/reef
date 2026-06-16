import { describe, expect, it } from "vitest";
import {
  AuthError,
  ConflictError,
  ISSUE_ROW_COLUMNS,
  SchemaValidationError,
  createVault,
  grantVaultMember,
  listVaultMembers,
  listVaults,
  makeAdapter,
  makeDocumentResponse,
  makeIssueRow,
  makeSqlQueryResponse,
  readIssue,
  revokeVaultMember,
  searchUsers,
  setupFetch,
} from "./akb.testSupport";

describe("vault meta", () => {
  it("listVaultMembers returns the parsed members array", async () => {
    setupFetch([
      {
        body: {
          members: [
            {
              username: "alice",
              display_name: "Alice",
              email: null,
              role: "owner",
            },
            {
              username: "bob",
              display_name: null,
              email: "bob@example.com",
              role: "writer",
              since: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    ]);
    const adapter = makeAdapter();
    const result = await listVaultMembers({
      adapter,
      vault: "reef-sample",
    });
    expect(result.members).toHaveLength(2);
    expect(result.members[0]?.username).toBe("alice");
    expect(result.members[1]?.role).toBe("writer");
  });

  it("grantVaultMember POSTs {user, role} and echoes the applied grant", async () => {
    const { calls } = setupFetch([
      {
        body: {
          vault: "reef-sample",
          user: "bob",
          role: "writer",
          granted: true,
        },
      },
    ]);
    const result = await grantVaultMember({
      adapter: makeAdapter(),
      vault: "reef-sample",
      user: "bob",
      role: "writer",
    });

    expect(result).toEqual({
      vault: "reef-sample",
      user: "bob",
      role: "writer",
    });
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ user: "bob", role: "writer" }),
    );
    expect(new URL(calls[0]?.url ?? "").pathname).toBe(
      "/api/v1/vaults/reef-sample/grant",
    );
  });

  it("grantVaultMember surfaces an akb 403 (admin floor) as AuthError", async () => {
    setupFetch([{ status: 403, body: { detail: "Requires 'admin' role" } }]);
    await expect(
      grantVaultMember({
        adapter: makeAdapter(),
        vault: "reef-sample",
        user: "bob",
        role: "admin",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("revokeVaultMember POSTs {user} to the revoke endpoint", async () => {
    const { calls } = setupFetch([
      { body: { vault: "reef-sample", user: "bob" } },
    ]);
    await revokeVaultMember({
      adapter: makeAdapter(),
      vault: "reef-sample",
      user: "bob",
    });

    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ user: "bob" }));
    expect(new URL(calls[0]?.url ?? "").pathname).toBe(
      "/api/v1/vaults/reef-sample/revoke",
    );
  });

  it("revokeVaultMember surfaces an akb 403 (owner/admin guard) as AuthError", async () => {
    setupFetch([
      { status: 403, body: { detail: "Cannot revoke owner's access" } },
    ]);
    await expect(
      revokeVaultMember({
        adapter: makeAdapter(),
        vault: "reef-sample",
        user: "owner",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("searchUsers queries the global directory and parses the users array", async () => {
    const { calls } = setupFetch([
      {
        body: {
          users: [
            { username: "carol", display_name: "Carol", email: "carol@x.io" },
            { username: "dan", display_name: null, email: null },
          ],
        },
      },
    ]);
    const result = await searchUsers({
      adapter: makeAdapter(),
      query: "ca",
      limit: 10,
    });

    expect(result.users.map((u) => u.username)).toEqual(["carol", "dan"]);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/users/search");
    expect(url.searchParams.get("q")).toBe("ca");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("searchUsers omits an empty/whitespace query", async () => {
    const { calls } = setupFetch([{ body: { users: [] } }]);
    await searchUsers({ adapter: makeAdapter(), query: "   " });
    const url = new URL(calls[0]?.url ?? "");
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("listVaults returns the parsed vault summaries", async () => {
    setupFetch([
      {
        body: {
          vaults: [
            { name: "reef-sample", role: "owner" },
            { name: "reef-other", role: "writer" },
          ],
        },
      },
    ]);
    const adapter = makeAdapter();
    const result = await listVaults({ adapter });
    expect(result.vaults.map((v) => v.name)).toEqual([
      "reef-sample",
      "reef-other",
    ]);
  });
});

describe("createVault", () => {
  it("posts the vault name, optional description, and private access setting", async () => {
    const { calls } = setupFetch([
      {
        body: {
          vault_id: "123e4567-e89b-12d3-a456-426614174000",
          name: "reef-new",
          template: null,
          public_access: "none",
        },
      },
    ]);
    const adapter = makeAdapter();

    const result = await createVault({
      adapter,
      name: "reef-new",
      description: "New reef workspace",
    });

    expect(result).toEqual({
      vault_id: "123e4567-e89b-12d3-a456-426614174000",
      name: "reef-new",
      template: null,
      public_access: "none",
    });
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer jwt.example.token",
      Accept: "application/json",
    });
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/vaults");
    expect(url.searchParams.get("name")).toBe("reef-new");
    expect(url.searchParams.get("description")).toBe("New reef workspace");
    expect(url.searchParams.get("public_access")).toBe("none");
  });

  it("omits an empty description", async () => {
    const { calls } = setupFetch([
      {
        body: {
          vault_id: "v1",
          name: "reef-new",
          public_access: "none",
        },
      },
    ]);

    await createVault({
      adapter: makeAdapter(),
      name: "reef-new",
      description: "",
    });

    const url = new URL(calls[0]?.url ?? "");
    expect(url.searchParams.has("description")).toBe(false);
  });

  it("translates auth, conflict, and validation errors from akb", async () => {
    setupFetch([
      { status: 401, body: { error: "expired" } },
      { status: 409, body: { error: "Vault already exists: reef-new" } },
      { status: 422, body: { detail: "invalid name" } },
    ]);
    const adapter = makeAdapter();

    await expect(
      createVault({ adapter, name: "reef-new" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      createVault({ adapter, name: "reef-new" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createVault({ adapter, name: "reef-new" }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });
});

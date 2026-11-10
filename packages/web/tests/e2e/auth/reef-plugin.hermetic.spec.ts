import { buildSync } from "esbuild";
import { E2E_MOCK_URL } from "../harness/fixture";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { test as workspaceTest } from "../harness/workspace-fixture";

const test = workspaceTest.extend({ scenario: "plugin_recent_issues" });

async function subjectToken(
  request: APIRequestContext,
  username: "alice" | "bob" = "alice",
  variant?: "wrong-audience" | "expired" | "missing-scope",
) {
  const response = await request.post(`${E2E_MOCK_URL}/__e2e/mcp-subject`, {
    data: { username, variant },
  });
  expect(response.ok()).toBe(true);
  const body: { access_token: string } = await response.json();
  return body.access_token;
}

function mcp(
  request: APIRequestContext,
  accessToken: string,
  method: string,
  params: object = {},
) {
  return request.post("/mcp", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
}

async function signInWeb(page: Page) {
  await page.goto("/login?redirect=%2Fonboarding");
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function mountIssuePicker(page: Page, html: string) {
  const script = buildSync({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
        const frame = document.querySelector("iframe");
        const bridge = new AppBridge(null, {name:"Reef test host",version:"1"}, {
          serverTools:{}, message:{text:{}}, updateModelContext:{text:{}},
        }, {hostContext:{locale:"en"}});
        bridge.oncalltool = (params) => window.reefCall(params);
        bridge.onmessage = (params) => window.reefMessage(params);
        bridge.onupdatemodelcontext = (params) => window.reefContext(params);
        const transport = new PostMessageTransport(frame.contentWindow, frame.contentWindow);
        const send = transport.send.bind(transport);
        transport.send = async (message, options) => {
          await send(message, options);
          const issues = message.result?.structuredContent?.issues;
          if (issues) document.body.dataset.issueResponseCount = String(issues.length);
        };
        await bridge.connect(transport);
        frame.src = "/app";
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  }).outputFiles[0].text;
  await page.route("http://reef-app.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill(
      path === "/sdk.js"
        ? { contentType: "text/javascript", body: script }
        : {
            contentType: "text/html",
            body:
              path === "/app"
                ? html
                : '<style>body{margin:0}iframe{width:100%;height:720px;border:0}</style><iframe title="Reef App" sandbox="allow-scripts"></iframe><script type="module" src="/sdk.js"></script>',
          },
    );
  });
  await page.goto("http://reef-app.test/");
  return page.frameLocator('iframe[title="Reef App"]');
}

test.describe("Keycloak-backed Reef plugin", { tag: "@sso" }, () => {
  test("advertises Keycloak and exchanges only valid read-scoped Reef tokens", async ({
    page,
    request,
    baseURL,
  }) => {
    const resourceUrl = new URL("/mcp", baseURL);
    const discoveryUrl = new URL(
      "/.well-known/oauth-protected-resource/mcp",
      resourceUrl,
    );
    const missing = await request.get("/mcp");
    expect(missing.status()).toBe(401);
    expect(missing.headers()["www-authenticate"]).toBe(
      `Bearer resource_metadata="${discoveryUrl.href}"`,
    );
    const metadata = await request.get(discoveryUrl.href);
    expect(await metadata.json()).toEqual({
      resource: resourceUrl.href,
      authorization_servers: [
        `https://oidc.localhost:${resourceUrl.port}/realms/reef`,
      ],
      scopes_supported: ["reef:issues:read"],
      bearer_methods_supported: ["header"],
    });
    expect(
      (await request.get("/.well-known/oauth-authorization-server")).status(),
    ).toBe(404);

    for (const token of [
      "invalid",
      await subjectToken(request, "alice", "wrong-audience"),
      await subjectToken(request, "alice", "expired"),
    ]) {
      const refused = await mcp(request, token, "tools/list");
      expect(refused.status()).toBe(401);
      expect(refused.headers()["www-authenticate"]).toContain(
        'error="invalid_token"',
      );
    }
    const noScope = await mcp(
      request,
      await subjectToken(request, "alice", "missing-scope"),
      "tools/list",
    );
    expect(noScope.status()).toBe(403);
    expect(noScope.headers()["www-authenticate"]).toContain(
      'error="insufficient_scope", scope="reef:issues:read"',
    );

    const token = await subjectToken(request);
    const wrongOrigin = await request.get("/mcp", {
      headers: {
        Origin: "https://other.test",
        Authorization: `Bearer ${token}`,
      },
    });
    expect(wrongOrigin.status()).toBe(403);

    await signInWeb(page);
    const me = await page.request.get("/api/auth/akb/me");
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ username: "alice" });
    expect((await page.request.get("/mcp")).status()).toBe(401);
    const observation = `${E2E_MOCK_URL}/__e2e/sso`;
    expect(await (await request.get(observation)).json()).toMatchObject({
      exchanges: 1,
      mcpExchanges: 0,
      sessionRecords: 1,
    });
    expect(
      (
        await request.get(`${E2E_MOCK_URL}/akb/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status(),
    ).toBe(401);

    const initialized = await mcp(request, token, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" },
    });
    expect(initialized.status()).toBe(200);
    expect(await (await request.get(observation)).json()).toMatchObject({
      mcpExchanges: 1,
      sessionRecords: 1,
    });
    const tools = await (await mcp(request, token, "tools/list")).json();
    expect(tools.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "reef_list_workspaces",
          _meta: { ui: { visibility: ["app"] } },
        }),
        expect.objectContaining({
          name: "reef_list_recent_issues",
          _meta: { ui: { visibility: ["app"] } },
        }),
      ]),
    );
    const open = await (
      await mcp(request, token, "tools/call", {
        name: "open_reef_issue_picker",
        arguments: {},
      })
    ).json();
    expect(open.result.structuredContent).toBeUndefined();
    const resource = await (
      await mcp(request, token, "resources/read", {
        uri: "ui://reef/recent-issues.html",
      })
    ).json();
    expect(resource.result.contents[0].mimeType).toBe(
      "text/html;profile=mcp-app",
    );
    expect(resource.result.contents[0].text).toContain("Recent Reef issues");
    const workspaces = await (
      await mcp(request, token, "tools/call", {
        name: "reef_list_workspaces",
        arguments: {},
      })
    ).json();
    expect(workspaces.result.structuredContent.workspaces).toContain(
      "reef-e2e",
    );
    const queryStarted = Date.now();
    const recent = await (
      await mcp(request, token, "tools/call", {
        name: "reef_list_recent_issues",
        arguments: { workspace: "reef-e2e" },
      })
    ).json();
    expect(recent.result.isError).toBeFalsy();
    const { queried_at, issues } = recent.result.structuredContent;
    expect(issues).toEqual([
      {
        id: "REEF-001",
        title: "Initial issue Alpha",
        status: "todo",
        updated_at: expect.any(String),
        document_uri: "akb://reef-e2e/coll/issues/doc/reef-001.md",
      },
      {
        id: "REEF-002",
        title: "Initial issue Beta",
        status: "closed",
        updated_at: expect.any(String),
        document_uri: "akb://reef-e2e/coll/issues/doc/reef-002.md",
      },
    ]);
    const queried = Date.parse(queried_at);
    expect(queried).toBeGreaterThanOrEqual(queryStarted);
    expect(queried).toBeLessThanOrEqual(Date.now());
    for (const [index, issue] of issues.entries()) {
      const age = queried - Date.parse(issue.updated_at);
      expect(age).toBeGreaterThanOrEqual((index + 1) * 86_400_000);
      expect(age).toBeLessThan((index + 1) * 86_400_000 + 60_000);
    }
    for (const arguments_ of [
      { workspace: "reef-e2e", days: 31 },
      { workspace: "reef-e2e", status: "unknown" },
      { workspace: "reef-e2e", cursor: "invalid" },
      { workspace: "reef-e2e", as_of: queried_at },
      {
        workspace: "reef-e2e",
        cursor: Buffer.from(
          JSON.stringify({ k: queried_at, id: "REEF-001" }),
        ).toString("base64url"),
        as_of: new Date(Date.now() + 86_400_000).toISOString(),
      },
      { workspace: "reef-e2e", sql: "SELECT 1" },
    ]) {
      const invalid = await (
        await mcp(request, token, "tools/call", {
          name: "reef_list_recent_issues",
          arguments: arguments_,
        })
      ).json();
      expect(invalid.result?.isError || invalid.error).toBeTruthy();
    }
    const bobToken = await subjectToken(request, "bob");
    const bobWorkspaces = await (
      await mcp(request, bobToken, "tools/call", {
        name: "reef_list_workspaces",
        arguments: {},
      })
    ).json();
    expect(bobWorkspaces.result.structuredContent.workspaces).toEqual([
      "reef-e2e",
    ]);
    const denied = await (
      await mcp(request, bobToken, "tools/call", {
        name: "reef_list_recent_issues",
        arguments: { workspace: "reef-second" },
      })
    ).json();
    expect(denied.result).toMatchObject({
      isError: true,
      structuredContent: { error: "workspace_denied" },
    });
    const stats = await (await request.get(observation)).json();
    expect(stats.sessionRecords).toBe(1);
    expect(stats.bearerForwarded).toBe(true);
  });

  test("browses and refreshes fixture-backed snapshots and sends the exact preview only on request", async ({
    page,
    request,
  }) => {
    await signInWeb(page);
    const token = await subjectToken(request);
    const resource = await (
      await mcp(request, token, "resources/read", {
        uri: "ui://reef/recent-issues.html",
      })
    ).json();

    const messages: unknown[] = [];
    const contextUpdates: unknown[] = [];
    const calls: {
      name: string;
      arguments: Record<string, unknown>;
      result: unknown;
    }[] = [];
    let holdNextThirtyDay = false;
    let releaseOldPage: (() => void) | undefined;

    await page.exposeFunction(
      "reefCall",
      async (params: { name: string; arguments: Record<string, unknown> }) => {
        const hold = holdNextThirtyDay && params.arguments.days === 30;
        if (hold) holdNextThirtyDay = false;
        const response = await mcp(request, token, "tools/call", params);
        expect(response.ok()).toBe(true);
        const { result } = await response.json();
        calls.push({ ...params, result });
        if (hold)
          await new Promise<void>((resolve) => {
            releaseOldPage = resolve;
          });
        return result;
      },
    );
    await page.exposeFunction("reefMessage", (params: unknown) => {
      messages.push(params);
      return { isError: messages.length === 1 };
    });
    await page.exposeFunction("reefContext", (params: unknown) => {
      contextUpdates.push(params);
      return {};
    });

    async function setWorkspaceLifecycle(lifecycle: "uninstalled" | "active") {
      for (const vault of ["reef-e2e", "reef-second"]) {
        const response = await request.post(
          `${E2E_MOCK_URL}/__e2e/installation-control`,
          { data: { vault, lifecycle } },
        );
        expect(response.ok(), await response.text()).toBe(true);
      }
    }

    await setWorkspaceLifecycle("uninstalled");
    await page.setViewportSize({ width: 340, height: 760 });
    const app = await mountIssuePicker(page, resource.result.contents[0].text);
    const preview = app.getByRole("button", { name: "Preview Issue Context" });
    const alpha = app.getByRole("checkbox", {
      name: "REEF-001 Initial issue Alpha",
    });
    await expect(app.getByText("No accessible Reef workspaces.")).toBeVisible();
    await setWorkspaceLifecycle("active");
    await app.getByRole("button", { name: "Try again" }).click();
    await expect(alpha).toBeVisible();
    expect(
      calls.filter(({ name }) => name === "reef_list_workspaces"),
    ).toHaveLength(2);
    await expect(preview).toBeDisabled();
    await expect(app.getByRole("combobox", { name: "Period" })).toHaveValue(
      "7",
    );

    await app.getByRole("combobox", { name: "Status" }).selectOption("done");
    await expect(
      app
        .getByRole("status")
        .filter({ hasText: "No issues match these filters" }),
    ).toBeVisible();
    expect(
      (
        await request.post(`${E2E_MOCK_URL}/__e2e/issue-list-failure`, {
          data: { enabled: true },
        })
      ).ok(),
    ).toBe(true);
    await app.getByRole("combobox", { name: "Status" }).selectOption("closed");
    await expect(app.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(
      (
        await request.post(`${E2E_MOCK_URL}/__e2e/issue-list-failure`, {
          data: { enabled: false },
        })
      ).ok(),
    ).toBe(true);
    await app.getByRole("button", { name: "Try again" }).click();
    await expect(app.getByRole("checkbox")).toHaveCount(1);
    await expect(app.getByRole("checkbox", { name: /REEF-002/ })).toBeVisible();

    await app.getByRole("combobox", { name: "Status" }).selectOption("");
    await expect(alpha).toBeVisible();
    holdNextThirtyDay = true;
    await app.getByRole("combobox", { name: "Period" }).selectOption("30");
    await expect.poll(() => Boolean(releaseOldPage)).toBe(true);
    await expect(app.getByText("Loading issue snapshots…")).toBeVisible();
    await app.getByRole("combobox", { name: "Period" }).selectOption("7");
    await expect(app.getByRole("checkbox")).toHaveCount(2);
    releaseOldPage?.();
    await expect(page.locator("body")).toHaveAttribute(
      "data-issue-response-count",
      "50",
    );
    await app.locator("body").evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(app.getByRole("checkbox")).toHaveCount(2);
    await app.getByRole("combobox", { name: "Period" }).selectOption("30");
    await expect(app.getByRole("checkbox")).toHaveCount(50);
    await alpha.focus();
    await page.keyboard.press("Space");
    await expect(alpha).toBeChecked();
    const listFailure = `${E2E_MOCK_URL}/__e2e/issue-list-failure`;
    expect(
      (await request.post(listFailure, { data: { enabled: true } })).ok(),
    ).toBe(true);
    await app.getByRole("button", { name: "Load more" }).click();
    await expect(app.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(app.getByRole("checkbox")).toHaveCount(50);
    await expect(alpha).toBeChecked();
    expect(
      (await request.post(listFailure, { data: { enabled: false } })).ok(),
    ).toBe(true);
    await app.getByRole("button", { name: "Try again" }).click();
    await expect(app.getByRole("checkbox")).toHaveCount(53);
    await expect(alpha).toBeChecked();
    const continuations = calls.filter(
      ({ arguments: args }) => typeof args.cursor === "string",
    );
    expect(continuations).toHaveLength(2);
    expect(continuations[0].arguments).toEqual(continuations[1].arguments);
    const next = continuations[1];
    expect(next.arguments).toMatchObject({
      workspace: "reef-e2e",
      days: 30,
      cursor: expect.any(String),
      as_of: expect.any(String),
    });
    const first = calls
      .filter(({ arguments: args }) => args.days === 30 && !args.cursor)
      .at(-1);
    expect(first?.result).toMatchObject({
      structuredContent: { as_of: next?.arguments.as_of },
    });

    await app
      .getByRole("combobox", { name: "Workspace" })
      .selectOption("reef-second");
    await expect(
      app.getByRole("checkbox", { name: "REEF-901 Second workspace issue" }),
    ).toBeVisible();
    await expect(preview).toBeDisabled();
    await app
      .getByRole("combobox", { name: "Workspace" })
      .selectOption("reef-e2e");
    await expect(alpha).toBeVisible();
    await alpha.check();
    const edited = await page.request.patch("/api/issues/REEF-001", {
      data: {
        vault: "reef-e2e",
        update: { issue_id: "REEF-001", patch: { title: "Updated from Reef" } },
      },
    });
    expect(edited.status(), await edited.text()).toBe(200);
    await app.getByRole("button", { name: "Refresh" }).click();
    const updated = app.getByRole("checkbox", {
      name: "REEF-001 Updated from Reef",
    });
    await expect(updated).toBeVisible();
    await expect(updated).not.toBeChecked();
    await expect(preview).toBeDisabled();
    await updated.check();
    const summary = app
      .locator("summary")
      .filter({ hasText: "Updated from Reef" });
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(
      app.getByText("akb://reef-e2e/coll/issues/doc/reef-001.md", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await app
        .locator("body")
        .evaluate((body) => body.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await preview.click();
    const text = await app.locator("#preview-text").textContent();
    expect(text).toMatch(/^Issue Context\n\n/u);
    expect(JSON.parse(text?.split("\n\n")[1] ?? "")).toEqual({
      issues: [
        {
          id: "REEF-001",
          title: "Updated from Reef",
          status: "todo",
          updated_at: expect.any(String),
          queried_at: expect.any(String),
          document_uri: "akb://reef-e2e/coll/issues/doc/reef-001.md",
        },
      ],
    });
    expect(messages).toEqual([]);
    expect(contextUpdates).toEqual([]);

    const send = app.getByRole("button", { name: "Send to this conversation" });
    await send.click();
    await expect(
      app.getByText("The host declined the request.", { exact: false }),
    ).toBeVisible();
    await expect(send).toBeEnabled();
    await expect(app.locator("#preview-text")).toHaveText(text ?? "");
    await send.click();
    await expect(
      app.getByText("The host accepted the request.", { exact: false }),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    const payload = { role: "user", content: [{ type: "text", text }] };
    expect(messages).toEqual([payload, payload]);
    expect(contextUpdates).toEqual([]);
  });
});

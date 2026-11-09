import { createHash } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { test } from "../harness/workspace-fixture";

const callback = "http://127.0.0.1:49073/callback/fixture";
const verifier = "fixture_verifier_".repeat(4);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = 'client state "<reef>&"';

async function discover(request: APIRequestContext) {
  const challengeResponse = await request.get("/mcp");
  expect(challengeResponse.status()).toBe(401);
  const resourceDiscovery = challengeResponse
    .headers()
    ["www-authenticate"]?.match(/resource_metadata="([^"]+)"/u)?.[1];
  expect(resourceDiscovery).toBeDefined();
  const resourceMetadata = await (
    await request.get(resourceDiscovery ?? "")
  ).json();
  const [issuer] = resourceMetadata.authorization_servers;
  const metadata = await (
    await request.get(`${issuer}/.well-known/oauth-authorization-server`)
  ).json();
  expect(metadata.issuer).toBe(issuer);
  const registered = await request.post(metadata.registration_endpoint, {
    data: {
      client_name: "Codex",
      redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      response_types: ["code"],
      application_type: "native",
    },
  });
  expect(registered.status()).toBe(201);
  const { client_id, grant_types } = await registered.json();
  expect(grant_types).toEqual(["authorization_code"]);
  return {
    ...metadata,
    clientId: client_id,
    resource: resourceMetadata.resource,
  };
}

type Discovery = Awaited<ReturnType<typeof discover>>;

function authorization(flow: Discovery) {
  const url = new URL(flow.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: flow.clientId,
    redirect_uri: callback,
    resource: flow.resource,
    response_type: "code",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

async function receiveCallback(page: Page, button: string) {
  await page.route(`${callback}**`, async (route) => {
    expect(route.request().headers().referer).toBeUndefined();
    await route.fulfill({ body: "Native callback reached" });
  });
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByText("Native callback reached")).toBeVisible();
  const params = new URL(page.url()).searchParams;
  expect(params.get("state")).toBe(state);
  return params;
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

test.describe("Reef plugin OAuth", { tag: "@sso" }, () => {
  test("continues existing SSO, binds and consumes approval and code, serves the App, then honors logout", async ({
    page,
    request,
  }) => {
    const flow = await discover(request);
    const browserUrl = authorization(flow);
    const wrongCallback = new URL(browserUrl);
    wrongCallback.searchParams.set("redirect_uri", `${callback}-different`);
    expect(
      (await request.get(wrongCallback.href, { maxRedirects: 0 })).status(),
    ).toBe(400);
    const wrongResource = new URL(browserUrl);
    wrongResource.searchParams.set("resource", `${flow.resource}-different`);
    expect(
      (await request.get(wrongResource.href, { maxRedirects: 0 })).status(),
    ).toBe(400);

    await page.goto(browserUrl.href);
    await page.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Connect Reef to your app" }),
    ).toBeVisible();
    const consent = new URL(page.url());
    expect(consent.pathname).toBe("/oauth/consent");
    expect((await request.get(consent.href)).status()).toBe(400);
    const approval = {
      transaction: consent.searchParams.get("transaction") ?? "",
      action: await page.locator('input[name="action"]').inputValue(),
      decision: "approve",
    };
    const badOrigin = await page.request.post("/oauth/consent", {
      headers: { Origin: "https://other.test" },
      form: approval,
    });
    expect(badOrigin.status()).toBe(403);

    const callbackParams = await receiveCallback(page, "Allow read access");
    const code = callbackParams.get("code") ?? "";
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const tokenForm = {
      client_id: flow.clientId,
      redirect_uri: callback,
      resource: flow.resource,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
    };
    for (const invalid of [
      { client_id: "A".repeat(43) },
      { redirect_uri: `${callback}-wrong` },
      { resource: `${flow.resource}-wrong` },
      { code_verifier: "B".repeat(43) },
    ]) {
      expect(
        (
          await request.post(flow.token_endpoint, {
            form: { ...tokenForm, ...invalid },
          })
        ).status(),
      ).toBe(400);
    }
    const exchanges = await Promise.all(
      [1, 2].map(() => request.post(flow.token_endpoint, { form: tokenForm })),
    );
    expect(exchanges.map((response) => response.status()).sort()).toEqual([
      200, 400,
    ]);
    const granted = exchanges.find((response) => response.ok());
    const { access_token: token, expires_in } = await granted?.json();
    expect(expires_in).toBeGreaterThan(0);

    const initialized = await mcp(request, token, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" },
    });
    expect(initialized.status()).toBe(200);
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
    const denied = await (
      await mcp(request, token, "tools/call", {
        name: "reef_list_recent_issues",
        arguments: { workspace: "hidden-workspace" },
      })
    ).json();
    expect(denied.result).toMatchObject({
      isError: true,
      structuredContent: { error: "workspace_denied" },
    });

    const logout = await page.request.post("/api/auth/akb/logout", {
      headers: { Origin: flow.issuer },
    });
    expect(logout.status()).toBe(200);
    const revoked = await mcp(request, token, "resources/read", {
      uri: "ui://reef/recent-issues.html",
    });
    expect(revoked.status()).toBe(401);
    expect(revoked.headers()["www-authenticate"]).toContain(
      'error="invalid_token"',
    );
  });

  test("reuses the signed-in browser and reports denial to the exact native callback", async ({
    page,
    request,
  }) => {
    await page.goto("/login?redirect=%2Fonboarding");
    await page.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    const flow = await discover(request);
    await page.goto(authorization(flow).href);
    await expect(page).toHaveURL(/\/oauth\/consent\?/);
    const params = await receiveCallback(page, "Cancel");
    expect(params.get("error")).toBe("access_denied");
    expect(params.has("code")).toBe(false);
  });
});

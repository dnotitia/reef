import { generateKeyPairSync } from "node:crypto";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GitHubApiError, translateError } from "../../errors";
import { createGitHubAdapter } from "../github";
import { createGitHubAppInstallationTokenProvider } from "./appAuth";

// Capturing OpenTelemetry mock: unlike the shared no-op helper, this records
// every span attribute and exception so the secret-safety tests (AC2) can prove
// no credential material reaches the span.
const otel = vi.hoisted(() => ({
  attributes: [] as Array<{ key: string; value: unknown }>,
  exceptions: [] as Error[],
}));

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
  trace: {
    getTracer: () => ({
      startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
        fn({
          setAttribute: (key: string, value: unknown) => {
            otel.attributes.push({ key, value });
          },
          addEvent: () => {},
          recordException: (error: Error) => {
            otel.exceptions.push(error);
          },
          setStatus: () => {},
          end: () => {},
        }),
    }),
  },
}));

const GITHUB_API = "https://api.github.com";
const APP_ID = "123456";
const INSTALLATION_ID = "789";
const MINTED_TOKEN = "ghs_minted_installation_token_value";
const FUTURE_EXPIRY = "2999-01-01T00:00:00Z";
const TOKEN_ENDPOINT = `${GITHUB_API}/app/installations/${INSTALLATION_ID}/access_tokens`;

// A throwaway RSA key in PKCS#1 PEM ("BEGIN RSA PRIVATE KEY") — the format
// GitHub hands out when you generate an App private key. The JWT is signed
// locally, so this never leaves the process.
const TEST_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
}).privateKey;

const TEST_CONFIG = {
  app_id: APP_ID,
  installation_id: INSTALLATION_ID,
  private_key: TEST_PRIVATE_KEY,
};

const server = setupServer(
  http.post(TOKEN_ENDPOINT, () =>
    HttpResponse.json(
      {
        token: MINTED_TOKEN,
        expires_at: FUTURE_EXPIRY,
        permissions: { contents: "read", metadata: "read" },
        repository_selection: "all",
      },
      { status: 201 },
    ),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  otel.attributes.length = 0;
  otel.exceptions.length = 0;
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("createGitHubAppInstallationTokenProvider", () => {
  it("mints an installation token and reads a repo through createGitHubAdapter (AC1)", async () => {
    let sentAuthHeader: string | null = null;
    server.use(
      http.get(`${GITHUB_API}/repos/octo/repo/labels`, ({ request }) => {
        sentAuthHeader = request.headers.get("authorization");
        return HttpResponse.json([
          {
            name: "bug",
            description: "Something isn't working",
            color: "d73a4a",
          },
        ]);
      }),
    );

    const provider = createGitHubAppInstallationTokenProvider({
      config: TEST_CONFIG,
    });
    const token = await provider();
    const adapter = createGitHubAdapter({ token });
    const labels = await adapter.listRepoLabels({
      owner: "octo",
      repo: "repo",
    });

    expect(token).toBe(MINTED_TOKEN);
    expect(labels).toEqual([
      { name: "bug", description: "Something isn't working", color: "d73a4a" },
    ]);
    // The existing adapter authenticated the read with the minted token.
    expect(sentAuthHeader).toContain(MINTED_TOKEN);
  });

  it("down-scopes the installation token to read-only permissions even if the App has broader grants", async () => {
    let requestedPermissions: unknown;
    server.use(
      http.post(TOKEN_ENDPOINT, async ({ request }) => {
        requestedPermissions = (
          (await request.json()) as { permissions?: unknown }
        ).permissions;
        return HttpResponse.json(
          { token: MINTED_TOKEN, expires_at: FUTURE_EXPIRY },
          { status: 201 },
        );
      }),
    );

    const provider = createGitHubAppInstallationTokenProvider({
      config: TEST_CONFIG,
    });
    await provider();

    // GitHub down-scopes a token to the requested subset, so requesting read
    // levels yields a read-only token regardless of the App's own grants.
    expect(requestedPermissions).toEqual({
      contents: "read",
      metadata: "read",
      pull_requests: "read",
    });
  });

  it("records only non-secret identifiers on the span — never key or token (AC2)", async () => {
    const provider = createGitHubAppInstallationTokenProvider({
      config: TEST_CONFIG,
    });
    await provider();

    const byKey = new Map(otel.attributes.map((a) => [a.key, a.value]));
    expect(byKey.get("github.app_id")).toBe(APP_ID);
    expect(byKey.get("github.installation_id")).toBe(INSTALLATION_ID);
    expect(byKey.get("github.token_expires_at")).toBe(FUTURE_EXPIRY);

    const serialized = JSON.stringify(otel.attributes);
    expect(serialized).not.toContain(MINTED_TOKEN);
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain(TEST_PRIVATE_KEY);
  });

  it("keeps the private key and token out of the error and span on failure (AC2)", async () => {
    server.use(
      http.post(TOKEN_ENDPOINT, () =>
        HttpResponse.json(
          { message: `boom ${TEST_PRIVATE_KEY}` },
          { status: 500 },
        ),
      ),
    );

    const provider = createGitHubAppInstallationTokenProvider({
      config: TEST_CONFIG,
    });
    const error = await provider().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(GitHubApiError);
    const message = (error as Error).message;
    const recorded = JSON.stringify(
      otel.exceptions.map((e) => ({ name: e.name, message: e.message })),
    );
    for (const haystack of [
      message,
      (error as GitHubApiError).context.message,
      recorded,
    ]) {
      expect(haystack).not.toContain("PRIVATE KEY");
      expect(haystack).not.toContain(TEST_PRIVATE_KEY);
      expect(haystack).not.toContain(MINTED_TOKEN);
    }
  });

  it.each([401, 403, 404])(
    "maps a %s token-issuance failure to a same-status GitHubApiError (AC3)",
    async (upstreamStatus) => {
      server.use(
        http.post(TOKEN_ENDPOINT, () =>
          HttpResponse.json({ message: "denied" }, { status: upstreamStatus }),
        ),
      );

      const provider = createGitHubAppInstallationTokenProvider({
        config: TEST_CONFIG,
      });
      const error = await provider().catch((err: unknown) => err);

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).status).toBe(upstreamStatus);
      expect((error as GitHubApiError).context.message).toBe(
        "GitHub App installation token request failed",
      );
    },
  );

  it("collapses an unexpected upstream status to a 502 PM-facing response via translateError (AC3)", async () => {
    server.use(
      http.post(TOKEN_ENDPOINT, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    const provider = createGitHubAppInstallationTokenProvider({
      config: TEST_CONFIG,
    });
    const error = await provider().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(GitHubApiError);
    // The upstream status is preserved on the error; translateError is where a
    // non-pass-through status collapses to a PM-facing 502.
    expect(translateError(error).status).toBe(502);
  });

  it("maps a local signing failure (malformed private key) to a credential-free GitHubApiError (AC3)", async () => {
    const provider = createGitHubAppInstallationTokenProvider({
      config: {
        ...TEST_CONFIG,
        private_key:
          "-----BEGIN RSA PRIVATE KEY-----\nnot-a-real-key\n-----END RSA PRIVATE KEY-----\n",
      },
    });
    const error = await provider().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(GitHubApiError);
    // No upstream HTTP status (signing failed before any request) → 502.
    expect((error as GitHubApiError).status).toBe(502);
    expect((error as GitHubApiError).context.message).toBe(
      "GitHub App installation token request failed",
    );
  });
});

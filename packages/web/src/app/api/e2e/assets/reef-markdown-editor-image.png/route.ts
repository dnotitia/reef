const WEB_ASSET_PATH = "/api/e2e/assets/reef-markdown-editor-image.png";
const FIXTURE_ASSET_PATH = "/__e2e/assets/reef-markdown-editor-image.png";
const FIXTURE_ASSET_CONTENT_TYPE = "image/png";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function readFixtureOrigin(): string | undefined {
  const configuredOrigin = process.env.REEF_E2E_MOCK_URL;
  if (!configuredOrigin) return undefined;

  try {
    const url = new URL(configuredOrigin);
    if (
      url.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * Serve the one binary used by the hermetic Markdown fixture through the web
 * origin. The browser cannot reach the fixture server's container loopback
 * address when the web app is exposed through a host tunnel.
 */
export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (
    request.method !== "GET" ||
    requestUrl.pathname !== WEB_ASSET_PATH ||
    requestUrl.search
  ) {
    return notFound();
  }

  const fixtureOrigin = readFixtureOrigin();
  if (!fixtureOrigin) return notFound();

  try {
    const upstream = await fetch(new URL(FIXTURE_ASSET_PATH, fixtureOrigin), {
      cache: "no-store",
    });
    const contentType = upstream.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!upstream.ok || contentType !== FIXTURE_ASSET_CONTENT_TYPE) {
      return notFound();
    }

    return new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": FIXTURE_ASSET_CONTENT_TYPE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}

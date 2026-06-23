// NOTE: importing the Node-based pino `logger` here is intentional and safe.
// Despite the older "middleware == Edge" mental model, Proxy defaults to the
// Node.js runtime in Next.js 16 (see node_modules/next/.../file-conventions/
// proxy.md → "Proxy defaults to using the Node.js runtime"; the `runtime`
// option is not settable in Proxy files). This was verified at runtime: the
// `request` line below is emitted by pino from the proxy with trace correlation.
// Edge gating still applies to instrumentation-node.ts (sdk-node), which
// `instrumentation.ts` loads behind `NEXT_RUNTIME === "nodejs"`.
import { SESSION_COOKIE, decodeSessionActor } from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import { httpRequestDurationSeconds, httpRequestsTotal } from "@/lib/metrics";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js 16 proxy — replaces the older `middleware.ts` convention.
 * (See `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.)
 *
 * Two responsibilities:
 *  1. Sanitized request logging for `/api/*` routes:
 *     credential-bearing headers (`Authorization`, `X-Reef-LLM`) are not read
 *     here and therefore can not land in log sinks. The contract is enforced
 *     by `proxy.test.ts`, which fails if a known-fake token substring ever
 *     appears in captured console output.
 *     This is the single per-request log point; Route Handlers do not re-log the
 *     request. When a handler logs (e.g. an error), it uses `logger` from
 *     `@/lib/logging/logger`, whose pino config redacts the same
 *     credential headers, rather than ad-hoc `console.log`.
 *  2. Strict CSP with per-request nonce: generates a
 *     cryptographically random nonce per request, sets the full
 *     Content-Security-Policy response header (script-src uses nonce — no
 *     unsafe-inline), and exposes the nonce via the `x-nonce` response header
 *     so downstream Server Components can inject it into `<script nonce="...">`.

 *
 * SECURITY INVARIANT: `authorization` and `x-reef-llm` values are not read
 * or logged. The api_key embedded in X-Reef-LLM should not appear in any log
 * output — CI should enforce this.
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Increment the HTTP request counter with a low-cardinality `route_class`
  // label. We deliberately avoid recording the raw path (which can contain
  // issue ids and query strings) to keep Prometheus label cardinality bounded.
  // Note: the matcher (see config below) already excludes /api/metrics so the
  // scrape endpoint does not pollute its own counter.
  const routeClass = classifyRoute(path);
  const labels = { method: request.method, route_class: routeClass };
  httpRequestsTotal.inc(labels);
  // Start a latency timer. The proxy runs before the Route Handler so we can
  // measure the time from proxy entry to response header commit — not full
  // handler duration. Observe in the finally-equivalent via Date.now() diff so
  // the histogram captures at least ingress→proxy overhead per request.
  // Full end-to-end latency is available via OpenTelemetry spans (instrumentation.ts).
  const requestStartMs = Date.now();

  // Sanitized request logging — scoped to /api/* just to avoid noisy logs on
  // every page navigation. Credential headers are not read here.
  //
  // This is the single per-request log point. It goes through the shared pino
  // `logger`, so the line is pretty-printed (colorized) in development via the
  // pino-pretty transport and emitted as one JSON object per line in production
  // for log aggregation — the same sink and trace correlation as handler logs.
  //
  // request-phase facts are available here: the proxy runs BEFORE the Route
  // Handler, so the response status and full request duration are not knowable at
  // this point (Next.js prints those itself in its own dev request line). The
  // query string is sanitized to an allowlist (see sanitizeQueryForLog): just
  // non-sensitive params keep their value, everything else is logged key.
  // The OAuth/SSO callback carries a one-time `code` and a CSRF `state` (the
  // latter also nested inside the `redirect` URL) in the query by protocol, so
  // value logging is opt-in. The redaction contract is enforced by proxy.test.ts,
  // which fails if a fake-token substring ever reaches stdout.
  if (path.startsWith("/api/")) {
    // Stamp the request line with the akb actor (username) so an error can be
    // tied to a user — "which user hit this 500?" (REEF-271).
    //
    // TRUST BOUNDARY: this is the *claimed* session identity, not a verified one.
    // reef-web is not the JWT signing authority — akb is, and it re-validates the
    // forwarded token on every request (see `decodeJwtExp` / `extractAkbSession`).
    // The proxy runs before that validation and does not check the signature, so a
    // forged cookie like `{"sub":"alice"}` would be logged as `actor: alice` even
    // though akb then rejects it (401/403) — the request fails, but the line is
    // already written. The field is therefore reliable for akb-accepted requests
    // (the ones a real 500 comes from) and a best-effort, spoofable hint on
    // rejected ones. It is logged as a debug aid, not used for authorization,
    // and is deliberately NOT emitted as the OTel `enduser.id` span attribute,
    // whose semantic convention denotes a *verified* end user — setting it from an
    // unverified edge claim would overstate it in traces/cost dashboards.
    //
    // The public identity claim is read; the token/PAT is not touched, so
    // the credential-redaction invariant above is preserved.
    const sessionJwt = request.cookies.get(SESSION_COOKIE)?.value;
    const actor = sessionJwt ? decodeSessionActor(sessionJwt) : null;
    logger.info(
      {
        method: request.method,
        path,
        query: sanitizeQueryForLog(request.nextUrl.search),
        route_class: routeClass,
        ...(actor ? { actor } : {}),
      },
      "request",
    );
  }

  // Per-request cryptographic nonce — base64-encoded UUID (128 bits of entropy).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Dev-mode relaxations. React uses `eval` in development to reconstruct
  // server-side error stacks in the browser (per Next.js CSP guide). This is
  // unavoidable for the dev error overlay and HMR and is not enabled in
  // production — `NODE_ENV` is baked at build time so there is no runtime
  // toggle attacker could flip.
  const isDev = process.env.NODE_ENV === "development";

  // Strict Content-Security-Policy.
  //
  // Directive rationale:
  //   default-src 'self'            — safe default; blocks all unlisted resource types
  //   script-src 'self' nonce 'strict-dynamic' [dev: 'unsafe-eval']
  //                                 — no unsafe-inline; nonce-stamped scripts can load
  //                                   additional chunks via `strict-dynamic`; Next.js
  //                                   auto-attaches the nonce (discovered from the
  //                                   REQUEST-side CSP header) to its framework scripts
  //   style-src 'self' 'unsafe-inline' — Tailwind CSS v4 injects styles at runtime;
  //                                   unsafe-inline for STYLES does NOT allow script
  //                                   execution and is the Next.js-recommended trade-off
  //                                   when style nonces aren't feasible
  //   img-src 'self' data: blob: https://avatars.githubusercontent.com
  //                                 — inline SVG data URIs, same-origin images, blob:
  //                                   URLs created by next/image runtime, and GitHub user
  //                                   avatars (rendered via plain <img> in
  //                                   AssigneeCombobox, not next/image)
  //   connect-src 'self'            — fetch() / XHR to own BFF just; blocks credential
  //                                   exfiltration to attacker-controlled endpoints
  //   font-src 'self'               — Geist font loaded from same origin
  //   object-src 'none'             — block Flash / plugin execution entirely
  //   base-uri 'self'               — prevent <base> tag hijacking
  //   form-action 'self'            — prevent <form action="evil.com"> credential
  //                                   exfiltration via form submission
  //   frame-ancestors 'none'        — disallow embedding in iframes (clickjacking)
  //   upgrade-insecure-requests     — transparently upgrade http subresources to https
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  // Propagate the nonce and CSP onto the REQUEST headers so that Next.js's
  // SSR pipeline discovers them and automatically stamps the nonce onto every
  // framework-generated <script> tag (React runtime, Next.js chunk loader,
  // inline hydration scripts, etc.). Without this propagation, Next.js does not
  // see the nonce and its own scripts get blocked by strict CSP — breaking
  // the entire app. See node_modules/next/dist/docs/01-app/02-guides/
  // content-security-policy.md (app-router "Adding a nonce with Proxy" example).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-nonce", nonce);
  response.headers.set("Content-Security-Policy", csp);

  // Observe proxy-layer duration (ingress to response header commit).
  // This is a lower-bound on actual request latency; full latency is
  // available in OpenTelemetry spans via instrumentation.ts.
  const durationSeconds = (Date.now() - requestStartMs) / 1000;
  httpRequestDurationSeconds.observe(labels, durationSeconds);

  return response;
}

/**
 * Query parameters whose VALUES are safe to log verbatim — an allowlist, so any
 * parameter not listed has just its key logged (value dropped). Value logging is
 * opt-in, not opt-out, because credentials and CSRF nonces do reach the URL on
 * the OAuth/SSO routes: the callback carries a one-time authorization `code`,
 * and `redirect`/`next`/`state`/`nonce` carry CSRF state — including a nested
 * `state` embedded inside the `redirect` URL value. A denylist of sensitive
 * names does not catch that nesting; an allowlist fails safe (unknown and future
 * params, and any nested redirect URL, does not have their value logged).
 *
 * Lowercase; matching is case-insensitive. These are non-sensitive, non-nesting
 * board/list/pagination params useful for debugging.
 */
const LOGGABLE_QUERY_PARAMS = new Set<string>([
  "vault",
  "repo",
  "status",
  "priority",
  "type",
  "view",
  "assignee",
  "sprint",
  "release",
  "milestone",
  "limit",
  "cursor",
]);

/**
 * Sanitize a URL query string for logging: keep the value for allowlisted
 * non-sensitive parameters (see {@link LOGGABLE_QUERY_PARAMS}); every other
 * parameter is logged as its bare key, so no value — top-level or nested inside
 * a redirect URL — can leak. Returns `undefined` for an empty query so the log
 * omits the field entirely.
 */
function sanitizeQueryForLog(search: string): string | undefined {
  if (!search || search === "?") {
    return undefined;
  }
  const params = new URLSearchParams(search);
  const parts: string[] = [];
  for (const [key, value] of params) {
    parts.push(
      LOGGABLE_QUERY_PARAMS.has(key.toLowerCase()) ? `${key}=${value}` : key,
    );
  }
  return parts.length > 0 ? `?${parts.join("&")}` : undefined;
}

/**
 * Reduces a request path to a low-cardinality bucket suitable for a Prometheus
 * label. Issue ids and query parameters are stripped — the first one or
 * two path segments survive.
 *
 * Examples:
 *   /                   → "page"
 *   /issues             → "page"
 *   /api/chat           → "/api/chat"
 *   /api/issues         → "/api/issues"
 *   /api/issues/REEF-42 → "/api/issues"
 *   /api/auth/akb       → "/api/auth/akb"
 *   /api/auth/akb/login → "/api/auth/akb"
 */
function classifyRoute(path: string): string {
  if (!path.startsWith("/api/")) {
    return "page";
  }
  const segments = path.split("/").filter(Boolean); // remove empty leading segment
  // segments[0] === "api"
  if (segments.length <= 2) {
    return `/${segments.join("/")}`;
  }
  // For /api/auth/akb/* keep three segments to distinguish from /api/auth alone.
  if (segments[1] === "auth" && segments.length >= 3) {
    return `/${segments.slice(0, 3).join("/")}`;
  }
  return `/${segments.slice(0, 2).join("/")}`;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - /_next/static  (static assets)
     *  - /_next/image   (image optimization)
     *  - /favicon.ico   (favicon)
     *  - /api/metrics   (Prometheus scrape endpoint — machine-to-machine,
     *                    no HTML rendered, CSP headers are irrelevant and
     *                    would add overhead on every Prometheus poll)
     *
     * API routes are included because they still need request-logging.
     * The proxy function itself decides per-path whether to log.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/metrics).*)",
  ],
};

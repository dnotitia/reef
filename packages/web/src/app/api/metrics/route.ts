import { registry } from "@/lib/metrics";

/**
 * GET /api/metrics — Prometheus scrape endpoint.
 *
 * Returns all registered metrics in Prometheus text format (version 0.0.4).
 * This endpoint is intentionally unauthenticated — Prometheus scrapes it
 * server-side from within the Docker/K8s network. In production, this route
 * should NOT be reachable via the public ingress; protect it at the network
 * layer (K8s NetworkPolicy, ingress path rules, or Caddy matcher exclusion).
 *
 * CSP note: this route is excluded from the CSP middleware matcher in
 * `apps/web/src/proxy.ts` because it is a machine-to-machine endpoint
 * and does not serve HTML. See the `matcher` config in proxy.ts.
 *
 * Security invariant: no user credentials appear in metric values or labels.
 * Metric names and label values are hardcoded constants or safe identifiers
 * (tool names, etc.).
 */
export async function GET(): Promise<Response> {
  const metrics = await registry.metrics();
  return new Response(metrics, {
    headers: { "Content-Type": registry.contentType },
  });
}

/**
 * Resolve the akb backend base URL.
 *
 * Server. should not be exposed to the client (no `NEXT_PUBLIC_*`).
 * In cluster, this points at the in-namespace service:
 *   http://backend.akb.svc.cluster.local:8000
 * In local dev, point at a port-forwarded backend or the akb dev compose:
 *   http://localhost:8000
 */
export function getAkbBackendUrl(): string {
  const url = process.env.AKB_BACKEND_URL;
  if (!url) {
    throw new Error("AKB_BACKEND_URL environment variable is not set");
  }
  return url.replace(/\/+$/, "");
}

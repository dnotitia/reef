/**
 * The akb web app base URL this deployment links out to (REEF-083 / REEF-368).
 *
 * Server + runtime. reef-web has no in-app document viewer, so a linked akb
 * document's "open" action points at akb's own frontend. This base is
 * deployment-managed server state (like {@link getAkbBackendUrl} /
 * {@link getReefPublicOrigin}), NOT per-user — read it here on the server at
 * request time and hand it to the client through {@link AkbWebUrlProvider}.
 *
 * Why not `NEXT_PUBLIC_AKB_WEB_URL` read in the client: a `NEXT_PUBLIC_*` value
 * is inlined into the browser bundle at `next build` time, so a value present
 * only in the runtime ConfigMap never reaches the built client — the backlink
 * silently vanished in a deployed image whose build lacked the var (REEF-368).
 * Reading it on the server makes the same image work across clusters from the
 * ConfigMap alone, no rebuild.
 *
 * Back-compat: the older `NEXT_PUBLIC_AKB_WEB_URL` key is still honored so an
 * existing deployment keeps working before its ConfigMap is renamed to the
 * server-only `AKB_WEB_URL`.
 *
 * Returns null when unset (or blank) — the linked-document card then hides its
 * open action and offers copy only, exactly as before.
 */
export function getAkbWebUrl(): string | null {
  const raw = process.env.AKB_WEB_URL ?? process.env.NEXT_PUBLIC_AKB_WEB_URL;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Display + linking helpers for akb document URIs (REEF-083). akb emits two URI
 * forms: the location-aware `akb://<vault>/coll/<collection>/doc/<slug>` and the
 * bare `akb://<vault>/doc/<path>`. Both are parsed here so the document-reference
 * card can show a breadcrumb and (when an akb web base is configured) open the
 * document in a new tab.
 */
export interface AkbUriParts {
  vault: string;
  collection?: string;
  slug: string;
}

const AKB_URI_RE = /^akb:\/\/([^/]+)\/(?:coll\/(.+)\/)?doc\/(.+)$/;

export function parseAkbDocumentUri(uri: string): AkbUriParts | null {
  const match = AKB_URI_RE.exec(uri);
  if (!match) return null;
  return { vault: match[1], collection: match[2] || undefined, slug: match[3] };
}

/** "vault · collection" (or the vault when the URI carries no collection). */
export function akbDocumentBreadcrumb(uri: string): string {
  const parts = parseAkbDocumentUri(uri);
  if (!parts) return uri;
  return parts.collection
    ? `${parts.vault} · ${parts.collection}`
    : parts.vault;
}

/** Fallback display title from the slug, used when akb resolved no name. */
export function akbDocumentSlugTitle(uri: string): string {
  const parts = parseAkbDocumentUri(uri);
  if (!parts) return uri;
  return parts.slug.replace(/\.md$/, "");
}

/**
 * The akb web URL to open a document in a new tab, or null when no akb web base
 * is configured (`NEXT_PUBLIC_AKB_WEB_URL`) — the card then hides its open
 * action and just offers copy. reef-web has no in-app document viewer, so this
 * is the one outward link; the base is deployment-managed, does not per-user.
 *
 * akb's frontend routes a document as `/vault/:name/doc/:id`, where `:id` is the
 * URL-encoded vault-relative path (e.g. `overview%2Fspec.md`). The shape should
 * match exactly or the link 404s.
 */
export function buildAkbDocumentUrl(
  baseUrl: string | null | undefined,
  uri: string,
): string | null {
  if (!baseUrl) return null;
  const parts = parseAkbDocumentUri(uri);
  if (!parts) return null;
  const base = baseUrl.replace(/\/+$/, "");
  const path = parts.collection
    ? `${parts.collection}/${parts.slug}`
    : parts.slug;
  return `${base}/vault/${parts.vault}/doc/${encodeURIComponent(path)}`;
}

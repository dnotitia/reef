import { ACTIVITY_INBOX_COLLECTION, ISSUES_COLLECTION } from "./constants";

/**
 * Mirror of akb's `_slugify` (`backend/app/services/document_service.py`).
 * Reef writes documents with a title whose slug is fully derivable from a
 * stable reef-side identifier (issue.id, template.name) so the resulting akb
 * path can be reconstructed at read time. This should stay in sync with akb's
 * implementation: lowercase + strip → drop `[^\w\s-]` → collapse `[-\s]+` to
 * `-` → 80-char cap. We use Unicode property escapes (`\p{L}` etc., `u` flag)
 * to match Python's Unicode-aware `\w`.
 */
function slugifyAkbTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/[-\s]+/g, "-")
    .slice(0, 80);
}

/** Deterministic akb path for a reef issue, derived from issue.id alone. */
export function issuePathFor(id: string): string {
  return `${ISSUES_COLLECTION}/${slugifyAkbTitle(id)}.md`;
}

/** Deterministic akb path for a reef activity suggestion. */
export function activitySuggestionPathFor(id: string): string {
  return `${ACTIVITY_INBOX_COLLECTION}/${slugifyAkbTitle(id)}.md`;
}

/**
 * akb's canonical document URI for a vault-relative path. Mirrors akb's
 * `doc_uri()` (backend `uri_service`): a path WITH a directory becomes the
 * location-aware coll form `akb://V/coll/<dir>/doc/<name>`, while a root-level
 * path stays `akb://V/doc/<name>`.
 *
 * This should match akb exactly, because the knowledge-graph relation API stores
 * an edge under the canonicalized source/target URI (link canonicalizes before
 * persisting) and matches relation reads against it VERBATIM. A bare
 * `akb://V/doc/<dir>/<name>` join would be persisted as the coll form but
 * queried as `/doc/...`, so the read would silently return nothing (REEF-083).
 */
function docUri(vault: string, path: string): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return `akb://${vault}/doc/${path}`;
  }
  const collection = path.slice(0, lastSlash);
  const name = path.slice(lastSlash + 1);
  return `akb://${vault}/coll/${collection}/doc/${name}`;
}

/**
 * akb's canonical document URI for a reef issue — the endpoint a `references`
 * edge from this issue links under (REEF-083). Built from `docUri` +
 * `issuePathFor` so it consistently matches the canonical form akb stores and reads.
 * Reused by the reference adapter AND by the picker to exclude the issue's own
 * document from link candidates (akb rejects a self-link).
 */
export function issueDocumentUri(vault: string, id: string): string {
  return docUri(vault, issuePathFor(id));
}

/** Resource label for an issue, used to translate 404s into NotFoundError. */
export function makeIssueResourceLabel(id: string): string {
  return `issue ${id}`;
}

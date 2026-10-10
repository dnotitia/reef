const AKB_URI_PREFIX = "akb://";
const COLLECTION_PREFIX = "coll/";
const DOCUMENT_MARKER = "/doc/";

export interface ParsedAkbDocumentUri {
  readonly vault: string;
  readonly path: string;
}

/** Parse a bare or collection-backed AKB document URI without regex backtracking. */
export function parseAkbDocumentUri(uri: string): ParsedAkbDocumentUri | null {
  if (!uri.startsWith(AKB_URI_PREFIX)) return null;

  const authorityStart = AKB_URI_PREFIX.length;
  const pathSeparator = uri.indexOf("/", authorityStart);
  if (pathSeparator <= authorityStart) return null;

  const vault = uri.slice(authorityStart, pathSeparator);
  const uriPath = uri.slice(pathSeparator + 1);

  if (uriPath.startsWith(COLLECTION_PREFIX)) {
    const path = collectionDocumentPath(uriPath);
    if (path !== null) return { vault, path };
  }

  if (uriPath.startsWith("doc/")) {
    const path = uriPath.slice("doc/".length);
    if (path.length > 0 && !containsLineTerminator(path)) {
      return { vault, path };
    }
  }

  return null;
}

function collectionDocumentPath(uriPath: string): string | null {
  const collectionStart = COLLECTION_PREFIX.length;
  if (containsLineTerminator(uriPath.slice(collectionStart))) return null;

  // The old greedy grammar uses the final /doc/ marker that leaves a nonempty
  // document path. If the final marker is empty, one earlier marker may still
  // be valid because that marker and its suffix become part of the slug.
  let markerStart = uriPath.lastIndexOf(DOCUMENT_MARKER);
  if (markerStart + DOCUMENT_MARKER.length === uriPath.length) {
    markerStart = uriPath.lastIndexOf(DOCUMENT_MARKER, markerStart - 1);
  }
  if (markerStart < collectionStart) return null;

  const collection = uriPath.slice(collectionStart, markerStart);
  const slug = uriPath.slice(markerStart + DOCUMENT_MARKER.length);
  if (collection.length === 0 || slug.length === 0) return null;

  return `${collection}/${slug}`;
}

function containsLineTerminator(value: string): boolean {
  return (
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes("\u2028") ||
    value.includes("\u2029")
  );
}

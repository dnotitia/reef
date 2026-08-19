import { parseAkbDocumentUri } from "@/lib/akb/documentUri";
import { isAkbFileUri } from "./attachmentUrls";

/**
 * Issue Markdown links that stay inside Reef or target a validated AKB object
 * may follow their authored destination directly. Every other href is treated
 * as external and must pass through the shared visible confirmation dialog.
 */
export function isDirectIssueMarkdownHref(href: string): boolean {
  return (
    href.startsWith("#") ||
    (href.startsWith("/") && !href.startsWith("//")) ||
    isAkbFileUri(href) ||
    parseAkbDocumentUri(href) !== null
  );
}

/** Returns the issue id carried by Reef's vault-scoped issue route. */
export function issueIdFromIssueMarkdownHref(href: string): string | null {
  const match = /^\/workspace\/[^/?#]+\/issues\/([^/?#]+)\/?(?:[?#].*)?$/u.exec(
    href,
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

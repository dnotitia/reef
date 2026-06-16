import { HighlightText } from "@/components/HighlightText";
import {
  DocumentTypeGlyph,
  documentTypeLabel,
} from "@/components/fields/DocumentTypeGlyph";
import {
  akbDocumentBreadcrumb,
  akbDocumentSlugTitle,
} from "@/lib/akb/documentUri";
import { cn } from "@/lib/utils";
import type { DocumentSearchHit } from "@reef/core";

/**
 * Shared option row for the document-reference picker (REEF-083) — the document
 * analogue of `IssueOptionRow`. Reads as a compressed card: type glyph · title ·
 * type label, then the collection breadcrumb and the search match snippet, so a
 * candidate is recognizable as a living vault document, not a bare URL.
 *
 * Composed from leaves imported directly by file (no `components/fields`
 * barrel). The caller owns the interactive element + hover/active state.
 */
interface DocumentOptionRowProps {
  hit: DocumentSearchHit;
  /** Search needle to highlight inside the title (omit for none). */
  query?: string;
  className?: string;
}

export function DocumentOptionRow({
  hit,
  query = "",
  className,
}: DocumentOptionRowProps) {
  const title = hit.title ?? akbDocumentSlugTitle(hit.uri);
  const breadcrumb = hit.collection ?? akbDocumentBreadcrumb(hit.uri);

  return (
    <div className={cn("flex min-w-0 flex-1 items-start gap-2", className)}>
      <DocumentTypeGlyph docType={hit.doc_type} className="mt-0.5 size-3.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <HighlightText
            text={title}
            query={query}
            className="min-w-0 flex-1 truncate text-sm"
          />
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {documentTypeLabel(hit.doc_type)}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{breadcrumb}</p>
        {hit.matched_section ? (
          <p className="truncate text-xs text-muted-foreground/80">
            {hit.matched_section}
          </p>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { DocumentTypeGlyph } from "@/components/fields/DocumentTypeGlyph";
import type { ChatDocumentCitation } from "@/features/ai/chat/chatTypes";
import {
  akbDocumentBreadcrumb,
  akbDocumentSlugTitle,
  buildAkbDocumentUrl,
} from "@/lib/akb/documentUri";
import { useAkbWebUrl } from "@/providers/AkbWebUrlProvider";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * The documents an assistant answer cited via `search_documents`, rendered as a
 * "Sources" list of akb document cards (REEF-361 AC4). Mirrors DocumentRefCard's
 * structure — glyph · title, breadcrumb, hover open/copy — but is a read surface
 * (no remove edge) and carries the richer doc-type glyph the search result
 * provides.
 */
export function ChatCitations({
  citations,
}: {
  citations: ChatDocumentCitation[];
}) {
  const t = useTranslations("ai");
  if (citations.length === 0) return null;

  return (
    <section
      data-testid="chat-citations"
      aria-label={t("chatSources.heading")}
      className="flex flex-col gap-1.5"
    >
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("chatSources.heading")}
        <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
      </p>
      {citations.map((citation) => (
        <ChatCitationCard key={citation.uri} citation={citation} />
      ))}
    </section>
  );
}

function ChatCitationCard({ citation }: { citation: ChatDocumentCitation }) {
  const t = useTranslations("issues.refs");
  // Deployment-managed akb web base, provided at runtime (REEF-368); absent → the
  // card hides "open" and offers copy.
  const akbWebBase = useAkbWebUrl();
  const title = citation.title ?? akbDocumentSlugTitle(citation.uri);
  const breadcrumb = akbDocumentBreadcrumb(citation.uri);
  const openUrl = buildAkbDocumentUrl(akbWebBase, citation.uri);

  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function handleCopy() {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(citation.uri).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="group flex min-w-0 items-start gap-2.5 rounded-md border border-border bg-surface-subtle px-2.5 py-2 transition-colors duration-[var(--duration-base)] ease-[var(--ease-signature)] hover:border-foreground/20">
      <DocumentTypeGlyph docType={citation.docType} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground"
          title={title}
        >
          {title}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={citation.uri}
        >
          {breadcrumb}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t("openInAkb")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        <button
          type="button"
          aria-label={copied ? t("akbUriCopied") : t("copyAkbUri")}
          onClick={handleCopy}
          className="text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

"use client";

import { DocumentTypeGlyph } from "@/components/fields/DocumentTypeGlyph";
import {
  akbDocumentBreadcrumb,
  akbDocumentSlugTitle,
  buildAkbDocumentUrl,
} from "@/lib/akb/documentUri";
import { cn } from "@/lib/utils";
import type { AkbDocumentReference } from "@reef/core";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

// Deployment-managed akb web base; absent → the card hides "open" and offers
// copy just (reef-web has no in-app document viewer). NEXT_PUBLIC_ is inlined at
// build time, so reading it at module scope is safe and stable.
const AKB_WEB_BASE = process.env.NEXT_PUBLIC_AKB_WEB_URL ?? null;

/**
 * A linked akb document, rendered as a card (REEF-083): document glyph · title,
 * collection breadcrumb beneath, and hover-revealed actions (open in a new tab,
 * copy the akb:// URI, remove the edge). Structurally distinct from a plain
 * external-URL row so a knowledge-graph reference reads as a living vault
 * document, not an address. `references` edges carry no doc_type on read, so the
 * glyph is the neutral document mark.
 */
interface DocumentRefCardProps {
  reference: AkbDocumentReference;
  onRemove?: () => void;
  disabled?: boolean;
}

export function DocumentRefCard({
  reference,
  onRemove,
  disabled = false,
}: DocumentRefCardProps) {
  const t = useTranslations("issues.refs");
  const title = reference.title ?? akbDocumentSlugTitle(reference.uri);
  const breadcrumb = akbDocumentBreadcrumb(reference.uri);
  const openUrl = buildAkbDocumentUrl(AKB_WEB_BASE, reference.uri);

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
    void clipboard.writeText(reference.uri).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="group flex min-w-0 items-start gap-2.5 rounded-md border border-border bg-surface-subtle px-2.5 py-2 transition-colors duration-[var(--duration-base)] ease-[var(--ease-signature)] hover:border-foreground/20">
      <DocumentTypeGlyph className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground"
          title={title}
        >
          {title}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={reference.uri}
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
        {onRemove ? (
          <button
            type="button"
            aria-label={t("removeLinkedDocument")}
            disabled={disabled}
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

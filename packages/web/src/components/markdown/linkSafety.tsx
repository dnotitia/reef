"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown";

/**
 * Streamdown gates every markdown link (chat responses and issue comments)
 * behind an "open external link" confirmation. Its built-in modal renders a
 * `fixed inset-0` overlay `<div>` inline inside the markdown `<p>`, which is
 * invalid DOM nesting (`<div>`/`<p>` inside `<p>`) and trips a React hydration
 * error the moment a link is clicked.
 *
 * We keep the confirmation UX — showing the destination URL before navigation
 * matters because chat/comment markdown can carry links sourced from akb and
 * GitHub content — but render it through reef's Radix `Dialog`, which portals to
 * `document.body`. The modal then escapes the paragraph entirely, so no `<p>`
 * ever contains block-level descendants.
 */
function LinkSafetyDialog({
  url,
  isOpen,
  onClose,
  onConfirm,
}: LinkSafetyModalProps) {
  const t = useTranslations("linkSafety");
  const [copied, setCopied] = useState(false);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  // Streamdown's `onConfirm` opens the link (window.open); mirror its built-in
  // modal by dismissing right after so a reopened link starts from a clean state.
  const handleConfirm = useCallback(() => {
    onConfirm();
    onClose();
  }, [onConfirm, onClose]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (permissions/insecure context); the URL is
      // shown in full for manual copy, so this is non-fatal.
    }
  }, [url]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("warning")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
          <span
            className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-foreground"
            translate="no"
          >
            {url}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => void handleCopy()}
            aria-label={copied ? t("copied") : t("copyLink")}
          >
            {copied ? (
              <CheckIcon aria-hidden="true" className="size-4" />
            ) : (
              <CopyIcon aria-hidden="true" className="size-4" />
            )}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="brand" onClick={handleConfirm}>
            {t("open")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shared Streamdown `linkSafety` config. Both markdown surfaces (AI chat and
 * issue comments) pass this so link confirmation looks and behaves identically
 * and never nests a modal inside a paragraph.
 */
export const linkSafetyConfig: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => <LinkSafetyDialog {...props} />,
};

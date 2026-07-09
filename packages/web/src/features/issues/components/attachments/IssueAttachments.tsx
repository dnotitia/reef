"use client";

import { Button } from "@/components/ui/button";
import { useIssueAttachments } from "@/features/issues/hooks/queries/useIssueAttachments";
import { issueAttachmentDownloadHref } from "@/features/issues/lib/attachmentUrls";
import { formatAbsoluteTime } from "@/lib/relativeTime";
import { FileText, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ISSUE_SECTION_HEADER_CLASS } from "../shared/IssueFormSection";

function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value)} ${unit}`;
}

export function IssueAttachments({
  issueId,
  vault,
}: {
  issueId: string;
  vault: string;
}) {
  const t = useTranslations("issues.attachments");
  const locale = useLocale();
  const { data = [], isLoading } = useIssueAttachments(issueId, vault);
  const files = data.filter(
    (attachment) =>
      !(attachment.inline && attachment.mime_type.startsWith("image/")),
  );

  if (isLoading) {
    return (
      <section className="flex min-w-0 flex-col gap-2">
        <h3 className={ISSUE_SECTION_HEADER_CLASS}>{t("heading")}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {t("loading")}
        </div>
      </section>
    );
  }

  if (files.length === 0) {
    return null;
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className={ISSUE_SECTION_HEADER_CLASS}>{t("heading")}</h3>
      <div className="grid gap-2">
        {files.map((attachment) => {
          const href = issueAttachmentDownloadHref({
            issueId,
            vault,
            attachmentId: attachment.id,
          });
          return (
            <article
              key={attachment.id}
              className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-elevated px-3 py-2"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                <FileText className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {attachment.filename}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatBytes(attachment.size_bytes, locale)} ·{" "}
                  {formatAbsoluteTime(attachment.created_at, locale)}
                </p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <a href={href}>{t("download")}</a>
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

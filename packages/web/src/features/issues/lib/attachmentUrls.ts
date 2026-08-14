export function isAkbFileUri(url: string): boolean {
  return /^akb:\/\/.+\/file\/[^/]+$/u.test(url);
}

/**
 * Derive the small, display-only type marker used by an issue body file link.
 * The label is user-authored Markdown text; it is never used for MIME or
 * download policy decisions.
 */
export function attachmentFileTypeLabel(filename: string): string {
  const extension = filename.trim().match(/\.([A-Za-z0-9]{1,10})$/u)?.[1];
  return extension ? extension.toUpperCase() : "FILE";
}

export function issueAttachmentDownloadHref({
  issueId,
  vault,
  attachmentId,
}: {
  issueId: string;
  vault: string;
  attachmentId: string;
}): string {
  return `/api/issues/${encodeURIComponent(
    issueId,
  )}/attachments/${encodeURIComponent(attachmentId)}?vault=${encodeURIComponent(
    vault,
  )}`;
}

export function issueAttachmentFileHref({
  issueId,
  vault,
  fileUri,
  download = false,
}: {
  issueId: string;
  vault: string;
  fileUri: string;
  download?: boolean;
}): string {
  const href = `/api/issues/${encodeURIComponent(
    issueId,
  )}/attachments/file?vault=${encodeURIComponent(vault)}&uri=${encodeURIComponent(
    fileUri,
  )}`;
  return download ? `${href}&download=1` : href;
}

export function resolveIssueAttachmentUrl({
  issueId,
  vault,
  url,
  key,
}: {
  issueId: string;
  vault: string;
  url: string;
  key?: string;
}): string {
  if (!isAkbFileUri(url)) return url;
  return issueAttachmentFileHref({
    issueId,
    vault,
    fileUri: url,
    download: key === "href",
  });
}

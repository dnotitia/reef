export function isAkbFileUri(url: string): boolean {
  return /^akb:\/\/.+\/file\/[^/]+$/u.test(url);
}

const DOCUMENT_ASSET_TARGET_RE =
  /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/iu;

export function isDocumentAssetTarget(url: string): boolean {
  return DOCUMENT_ASSET_TARGET_RE.test(url);
}

export function issueDocumentAssetHref({
  vault,
  assetTarget,
}: {
  vault: string;
  assetTarget: string;
}): string {
  const match = DOCUMENT_ASSET_TARGET_RE.exec(assetTarget);
  if (!match?.[1]) return assetTarget;
  return `/api/assets/${match[1]}?vault=${encodeURIComponent(vault)}`;
}

/**
 * Derive the small, display type marker used by an issue body file link.
 * The label is user-authored Markdown text; it is not used for MIME or
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
  if (isDocumentAssetTarget(url)) {
    return issueDocumentAssetHref({ vault, assetTarget: url });
  }
  if (!isAkbFileUri(url)) return url;
  return issueAttachmentFileHref({
    issueId,
    vault,
    fileUri: url,
    download: key === "href",
  });
}

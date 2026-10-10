import {
  AuthError,
  NotFoundError,
  isAkbAccountErrorCode,
} from "../../../errors";
import { AKB_FILE_URI_RE } from "../../../schemas/files";
import type { MarkdownTargetAccessResult } from "../../../schemas/markdownTargets";
import { getAkbDocumentByPath } from "./documents";
import { parseAkbDocumentUri } from "./documentUri";
import { getAkbFileMetadata } from "./files";
import type { AkbAdapter } from "./http";

function uriVault(uri: string): string | undefined {
  return /^akb:\/\/([^/]+)\//u.exec(uri)?.[1];
}

function unavailable(
  target: string,
  kind: "document" | "file" | undefined,
  reason: Extract<
    MarkdownTargetAccessResult,
    { status: "unavailable" }
  >["reason"],
): MarkdownTargetAccessResult {
  return { target, kind, status: "unavailable", reason };
}

function unavailableForError(
  target: string,
  kind: "document" | "file",
  error: unknown,
): MarkdownTargetAccessResult {
  if (error instanceof NotFoundError) {
    return unavailable(target, kind, "deleted");
  }
  if (error instanceof AuthError) {
    if (
      error.context.status === 401 ||
      isAkbAccountErrorCode(error.context.code)
    ) {
      throw error;
    }
    if (error.context.status === 403) {
      return unavailable(target, kind, "inaccessible");
    }
  }
  return unavailable(target, kind, "unknown");
}

/** Resolve access to a canonical Markdown document or file target. */
export async function resolveAkbMarkdownTarget({
  adapter,
  vault,
  target,
}: {
  adapter: AkbAdapter;
  vault: string;
  target: string;
}): Promise<MarkdownTargetAccessResult> {
  const document = parseAkbDocumentUri(target);
  if (document) {
    if (document.vault !== vault) {
      return unavailable(target, "document", "cross-vault");
    }
    try {
      await getAkbDocumentByPath({
        adapter,
        vault,
        path: document.path,
      });
      return { target, kind: "document", status: "available" };
    } catch (error) {
      return unavailableForError(target, "document", error);
    }
  }

  if (AKB_FILE_URI_RE.test(target)) {
    if (uriVault(target) !== vault) {
      return unavailable(target, "file", "cross-vault");
    }
    try {
      await getAkbFileMetadata({ adapter, vault, fileUri: target });
      return { target, kind: "file", status: "available" };
    } catch (error) {
      return unavailableForError(target, "file", error);
    }
  }

  return unavailable(target, undefined, "unsupported");
}

import type { NormalizedJiraAttachment } from "../payloads.js";
import type {
  AttachmentBinding,
  JiraRelatedImportInput,
  JiraRelatedImportReport,
} from "./contracts.js";
import { rewriteMedia } from "./media.js";
import { recordRelatedOperation } from "./operations.js";
import { failure } from "./reporting.js";

export async function updateDescriptionMedia(options: {
  migration: JiraRelatedImportInput;
  issueId: string;
  descriptionAdf: unknown;
  attachments: readonly NormalizedJiraAttachment[];
  attachmentBindings: readonly AttachmentBinding[];
  report: JiraRelatedImportReport;
}): Promise<void> {
  const {
    migration,
    issueId,
    descriptionAdf,
    attachments,
    attachmentBindings,
    report,
  } = options;
  const renderedDescription =
    typeof migration.issue.renderedFields?.description === "string"
      ? migration.issue.renderedFields.description
      : "";
  const rewrittenBefore = report.media.rewritten;
  const description = rewriteMedia(
    descriptionAdf,
    attachmentBindings,
    renderedDescription,
    report,
    issueId,
    attachments,
    migration.descriptionConversionOptions,
  );
  const rewroteDescriptionMedia = report.media.rewritten > rewrittenBefore;
  if (rewroteDescriptionMedia && description.resolved && description.changed) {
    try {
      const existingDescription = await migration.target.readDescription(
        migration.reefId,
      );
      if (description.matchesPreRewriteMarkdown(existingDescription)) {
        report.media.description_updated = true;
        if (migration.mode === "dry-run") {
          recordRelatedOperation(
            report,
            "update_description",
            migration.reefId,
            description.markdown,
          );
        } else {
          await migration.target.updateDescription(
            migration.reefId,
            description.markdown,
          );
        }
      } else if (existingDescription !== description.markdown) {
        throw new Error("description_precondition_failed");
      }
      if (migration.mode === "dry-run") return;
      const readback = await migration.target.readDescription(migration.reefId);
      if (readback !== description.markdown)
        throw new Error("description_readback_mismatch");
    } catch (error) {
      failure(
        report.failures,
        "media",
        issueId,
        "write",
        "description_media_write_failed",
        error,
      );
    }
  }
}

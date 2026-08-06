import { fingerprintJiraState } from "../execution/diff.js";
import {
  type JiraMigrationBindingIndex,
  type JiraMigrationLedgerV1,
  getJiraMigrationBinding,
  jiraAttachmentSourceIdentity,
} from "../ledger.js";
import type { NormalizedJiraIssue } from "../payloads.js";
import type { JiraAttachmentActivityBinding } from "./changelog.js";

/**
 * Build the attachment identities required by changelog activity planning.
 *
 * The attachment import stage records the authoritative file URI in the
 * migration ledger. Changelog planning must consume that same binding rather
 * than treating the current Jira attachment payload as a second import. A
 * source-fingerprint check prevents a stale ledger entry from being used for
 * a changed attachment.
 */
export const buildJiraChangelogAttachmentBindings = (input: {
  jiraCloudId: string;
  issues: readonly NormalizedJiraIssue[];
  ledger: JiraMigrationLedgerV1;
  bindingIndex?: Readonly<JiraMigrationBindingIndex>;
}): Readonly<Record<string, JiraAttachmentActivityBinding>> =>
  Object.fromEntries(
    input.issues.flatMap((issue) =>
      issue.attachments.flatMap((attachment) => {
        if (
          attachment.mimeType === null ||
          attachment.size === null ||
          !Number.isSafeInteger(attachment.size) ||
          attachment.size < 0
        ) {
          return [];
        }
        const sourceIdentity = jiraAttachmentSourceIdentity(
          input.jiraCloudId,
          issue.id,
          attachment.id,
        );
        const binding = getJiraMigrationBinding(
          input.ledger,
          sourceIdentity.key,
          input.bindingIndex,
        );
        if (
          binding?.target.target_kind !== "attachment" ||
          binding.source_fingerprint !== fingerprintJiraState(attachment)
        ) {
          return [];
        }
        return [
          [
            attachment.id,
            {
              attachment_id: attachment.id,
              file_uri: binding.target.file_uri,
              filename: attachment.filename,
              mime_type: attachment.mimeType,
              size_bytes: attachment.size,
            },
          ] as const,
        ];
      }),
    ),
  );

import { createHash } from "node:crypto";
import { fingerprintJiraState } from "../execution/diff.js";
import type {
  AttachmentBinding,
  JiraImportedCommentInput,
  JiraRelatedImportReport,
  JiraRelatedOperation,
  JiraRelatedOperationKind,
} from "./contracts.js";

export const commentOperationInput = (
  input: JiraImportedCommentInput,
  parentSourceId: string | null,
): JiraImportedCommentInput => {
  const parentToken = parentSourceId
    ? `migration://comment/${fingerprintJiraState(parentSourceId)}`
    : null;
  const { parentCommentId: _parentCommentId, ...stableInput } = input;
  return parentToken
    ? {
        ...stableInput,
        parentCommentId: parentToken,
        expectedThreadRootId: parentToken,
      }
    : { ...stableInput, expectedThreadRootId: null };
};

export const descriptionOperationInput = (
  markdown: string,
  attachmentBindings: readonly AttachmentBinding[],
): string => {
  let normalized = markdown;
  for (const binding of [...attachmentBindings].sort(
    (left, right) => right.fileUri.length - left.fileUri.length,
  )) {
    normalized = normalized.replaceAll(
      binding.fileUri,
      `migration://attachment/${fingerprintJiraState(binding.source.id)}`,
    );
  }
  return normalized;
};

const normalizedInput = (
  kind: JiraRelatedOperationKind,
  input: unknown,
): unknown => {
  if (
    kind !== "create_attachment" ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !("bytes" in input) ||
    !(input.bytes instanceof Uint8Array)
  ) {
    return input;
  }
  const { bytes, ...rest } = input;
  return {
    ...rest,
    bytes_sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

export const relatedOperation = (
  kind: JiraRelatedOperationKind,
  key: string,
  input: unknown,
): JiraRelatedOperation => ({
  kind,
  key_sha256: fingerprintJiraState(key),
  input_sha256: fingerprintJiraState(normalizedInput(kind, input)),
});

export const recordRelatedOperation = (
  report: JiraRelatedImportReport,
  kind: JiraRelatedOperationKind,
  key: string,
  input: unknown,
): JiraRelatedOperation => {
  const operation = relatedOperation(kind, key, input);
  if (
    !report.operations.some(
      (candidate) =>
        candidate.kind === operation.kind &&
        candidate.key_sha256 === operation.key_sha256 &&
        candidate.input_sha256 === operation.input_sha256,
    )
  ) {
    report.operations.push(operation);
  }
  return operation;
};

export const sameRelatedOperation = (
  left: JiraRelatedOperation,
  right: JiraRelatedOperation,
): boolean =>
  left.kind === right.kind &&
  left.key_sha256 === right.key_sha256 &&
  left.input_sha256 === right.input_sha256;

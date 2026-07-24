import { createHash } from "node:crypto";
import { fingerprintJiraState } from "../execution/diff.js";
import type {
  JiraRelatedImportReport,
  JiraRelatedOperation,
  JiraRelatedOperationKind,
} from "./contracts.js";

const normalizeMigrationUris = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value
      .replaceAll(
        /dry-run:\/\/attachment\/[^)\]\s]+/gu,
        "migration://attachment",
      )
      .replaceAll(
        /akb:\/\/[^)\]\s]+\/file\/[^)\]\s]+/gu,
        "migration://attachment",
      );
  }
  if (Array.isArray(value)) return value.map(normalizeMigrationUris);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "parentCommentId" || key === "expectedThreadRootId"
        ? item == null
          ? null
          : "resolved-comment"
        : normalizeMigrationUris(item),
    ]),
  );
};

const normalizedInput = (
  kind: JiraRelatedOperationKind,
  input: unknown,
): unknown => {
  if (
    (kind === "create_comment" || kind === "update_comment") &&
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    const comment = input as Record<string, unknown>;
    const hasParent = comment.parentCommentId != null;
    return normalizeMigrationUris({
      ...comment,
      parentCommentId: hasParent ? "resolved-comment" : null,
      expectedThreadRootId: hasParent ? "resolved-comment" : null,
    });
  }
  if (
    kind !== "create_attachment" ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !("bytes" in input) ||
    !(input.bytes instanceof Uint8Array)
  ) {
    return normalizeMigrationUris(input);
  }
  const { bytes, ...rest } = input;
  return normalizeMigrationUris({
    ...rest,
    bytes_sha256: createHash("sha256").update(bytes).digest("hex"),
  });
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

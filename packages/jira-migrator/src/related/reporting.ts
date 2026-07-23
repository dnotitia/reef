import type {
  JiraRelatedImportFailure,
  JiraRelatedImportReport,
} from "./contracts.js";

const retryableError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "retryable" in error &&
  error.retryable === true;

export const failure = (
  failures: JiraRelatedImportFailure[],
  source_kind: JiraRelatedImportFailure["source_kind"],
  source_id: string,
  phase: JiraRelatedImportFailure["phase"],
  reason: string,
  error?: unknown,
): void => {
  failures.push({
    source_kind,
    source_id,
    phase,
    reason,
    retryable: retryableError(error),
  });
};

export const reportTemplate = (
  mode: "dry-run" | "apply",
): JiraRelatedImportReport => ({
  mode,
  deletions: 0,
  comments: {
    total: 0,
    roots: 0,
    replies: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    flat_fallback: 0,
  },
  attachments: { total: 0, created: 0, skipped: 0, bytes: 0 },
  media: {
    total: 0,
    rewritten: 0,
    unresolved: 0,
    description_updated: false,
    by_strategy: {},
  },
  links: { entries: 0, unique: 0, applied: 0, skipped: 0, unresolved: 0 },
  remote_links: { total: 0, applied: 0, skipped: 0 },
  failures: [],
});

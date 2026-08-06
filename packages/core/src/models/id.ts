import { SchemaValidationError } from "../errors/index.js";

export interface IssueIdParts {
  /** Jira-compatible uppercase project prefix, e.g. `"SAASV31"`. */
  prefix: string;
  /** Positive integer issue number (does not zero, does not negative). */
  number: number;
}

/**
 * Jira-compatible project prefix shared by `nextIssueId` and `parseIssueId`.
 * Guarantees a round-trip invariant: any ID produced by `nextIssueId` can be
 * parsed back by `parseIssueId` without error.
 */
const PREFIX_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Canonical Reef issue id pattern shared by route, tool, and UI exact-id guards.
 * Keeping it shared prevents Jira-compatible numeric/underscore prefixes from
 * drifting from {@link parseIssueId}.
 */
export const ISSUE_ID_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;

/**
 * Computes the next sequential issue ID.
 *
 * Format: {PREFIX}-{NNN} where NNN is zero-padded to minimum 3 digits.
 * Examples: REEF-001, REEF-042, REEF-100, REEF-1000
 *
 * Input contract (enforced — throws {@link SchemaValidationError} on violation):
 *   - `prefix` should start with an uppercase ASCII letter and then contain
 *     uppercase ASCII letters, digits, or underscores (matches
 *     {@link PREFIX_PATTERN}). This mirrors the invariant enforced by
 *     {@link parseIssueId} and preserves round-trip safety.
 *   - `currentMax` should be a finite non-negative integer. Non-integer, negative,
 *     `NaN`, and non-finite values are rejected, so malformed IDs such as
 *     `REEF-NaN` or `REEF-2.5` are not emitted.
 *
 * Concurrency note: This function computes the next ID given a currentMax.
 * The caller (useCreateIssue hook) is responsible for reading currentMax from
 * GitHub and for handling CAS conflicts at the write layer (Epic 12).
 */
export function nextIssueId({
  prefix,
  currentMax,
}: {
  prefix: string;
  currentMax: number;
}): string {
  if (!prefix) {
    throw new SchemaValidationError({
      field: "prefix",
      received: prefix,
      issues: ["prefix must be a non-empty string"],
    });
  }
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new SchemaValidationError({
      field: "prefix",
      received: prefix,
      issues: [
        "prefix must start with uppercase A-Z and use only A-Z, 0-9, or underscore",
      ],
    });
  }
  if (!Number.isInteger(currentMax) || currentMax < 0) {
    throw new SchemaValidationError({
      field: "currentMax",
      received: currentMax,
      issues: ["currentMax must be a non-negative integer"],
    });
  }
  const next = currentMax + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

/**
 * Parses an issue ID string into its prefix and number components.
 *
 * Valid format: {JIRA_COMPATIBLE_PREFIX}-{POSITIVE_INTEGER}
 * Examples: "SAASV31-001" → { prefix: "SAASV31", number: 1 }
 *
 * Throws SchemaValidationError on malformed input.
 */
export function parseIssueId(id: string): IssueIdParts {
  const dashIdx = id.indexOf("-");

  if (dashIdx <= 0) {
    throw new SchemaValidationError({
      field: "id",
      received: id,
      issues: ["issue ID must contain a '-' separator after the prefix"],
    });
  }

  const prefix = id.slice(0, dashIdx);
  const numStr = id.slice(dashIdx + 1);

  if (!PREFIX_PATTERN.test(prefix)) {
    throw new SchemaValidationError({
      field: "id",
      received: id,
      issues: [
        "issue ID prefix must start with uppercase A-Z and use only A-Z, 0-9, or underscore",
      ],
    });
  }

  if (!numStr || !/^\d+$/.test(numStr)) {
    throw new SchemaValidationError({
      field: "id",
      received: id,
      issues: ["issue ID number segment must be a non-empty digit string"],
    });
  }

  const number = Number.parseInt(numStr, 10);

  if (number === 0) {
    throw new SchemaValidationError({
      field: "id",
      received: id,
      issues: ["issue ID number must be a positive integer (> 0)"],
    });
  }

  return { prefix, number };
}

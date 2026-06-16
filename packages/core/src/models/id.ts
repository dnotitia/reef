import { SchemaValidationError } from "../errors";

export interface IssueIdParts {
  /** Uppercase-alphabetic prefix, e.g. `"REEF"`. */
  prefix: string;
  /** Positive integer issue number (does not zero, does not negative). */
  number: number;
}

/**
 * Uppercase-alphabetic prefix pattern shared by `nextIssueId` and `parseIssueId`.
 * Guarantees a round-trip invariant: any ID produced by `nextIssueId` can be
 * parsed back by `parseIssueId` without error.
 */
const PREFIX_PATTERN = /^[A-Z]+$/;

/**
 * Computes the next sequential issue ID.
 *
 * Format: {PREFIX}-{NNN} where NNN is zero-padded to minimum 3 digits.
 * Examples: REEF-001, REEF-042, REEF-100, REEF-1000
 *
 * Input contract (enforced — throws {@link SchemaValidationError} on violation):
 *   - `prefix` should be a non-empty string of uppercase ASCII letters (matches
 *     {@link PREFIX_PATTERN}). Mirrors the invariant enforced by
 *     {@link parseIssueId}, guaranteeing round-trip safety.
 *   - `currentMax` should be a finite non-negative integer. Non-integer, negative,
 *     `NaN`, and non-finite values are rejected so we does not emit malformed IDs
 *     like `REEF-NaN` or `REEF-2.5`.
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
      issues: ["prefix must be uppercase alphabetic characters only (A-Z)"],
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
 * Valid format: {UPPERCASE_ALPHA}-{POSITIVE_INTEGER}
 * Examples: "REEF-001" → { prefix: "REEF", number: 1 }
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
      issues: ["issue ID prefix must be uppercase alphabetic characters only"],
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

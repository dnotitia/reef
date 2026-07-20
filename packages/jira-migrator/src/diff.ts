import type { JiraMigrationAction } from "./ledger.js";
import { sha256CanonicalJson } from "./rawArchive.js";

export const fingerprintJiraState = (value: unknown): string =>
  sha256CanonicalJson(value);

export interface JiraMigrationDiffBinding {
  source_fingerprint: string;
  mapped_state_fingerprint: string;
  targetMatchesExpectedIdentity: boolean;
}

export interface JiraMigrationDiffResult {
  action: Exclude<JiraMigrationAction, "failed">;
  reason:
    | "binding_missing"
    | "mapped_state_matches"
    | "mapped_state_changed"
    | "retryable_previous_failure"
    | "target_identity_mismatch"
    | "non_retryable_previous_failure"
    | "retry_precondition_changed";
}

export const classifyJiraMigrationDiff = ({
  binding,
  desiredMappedStateFingerprint,
  previousResult,
}: {
  binding: JiraMigrationDiffBinding | null;
  desiredMappedStateFingerprint: string;
  previousResult?: {
    action: "failed";
    retryable: boolean;
    preconditionsMatch: boolean;
  };
}): JiraMigrationDiffResult => {
  if (previousResult) {
    if (!previousResult.retryable) {
      return { action: "conflict", reason: "non_retryable_previous_failure" };
    }
    if (!previousResult.preconditionsMatch) {
      return { action: "conflict", reason: "retry_precondition_changed" };
    }
    return { action: "retry", reason: "retryable_previous_failure" };
  }
  if (!binding) return { action: "create", reason: "binding_missing" };
  if (!binding.targetMatchesExpectedIdentity) {
    return { action: "conflict", reason: "target_identity_mismatch" };
  }
  if (binding.mapped_state_fingerprint === desiredMappedStateFingerprint) {
    return { action: "skip", reason: "mapped_state_matches" };
  }
  return { action: "update", reason: "mapped_state_changed" };
};

export type JiraRunnerErrorCode =
  | "artifact_paths_required"
  | "mapping_policy_required"
  | "dry_run_approval_required"
  | "dry_run_scope_mismatch"
  | "account_mapping_actor_not_vault_member"
  | "plan_fingerprint_mismatch"
  | "target_unavailable"
  | "interrupted"
  | "failpoint";

export class JiraRunnerError extends Error {
  constructor(readonly code: JiraRunnerErrorCode) {
    super(code);
    this.name = "JiraRunnerError";
  }
}

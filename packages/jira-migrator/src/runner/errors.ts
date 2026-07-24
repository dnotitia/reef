export type JiraRunnerErrorCode =
  | "artifact_paths_required"
  | "mapping_policy_required"
  | "dry_run_approval_required"
  | "dry_run_scope_mismatch"
  | "plan_fingerprint_mismatch"
  | "interrupted"
  | "failpoint";

export class JiraRunnerError extends Error {
  constructor(readonly code: JiraRunnerErrorCode) {
    super(code);
    this.name = "JiraRunnerError";
  }
}

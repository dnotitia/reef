export type ControllerErrorCode =
  | "invalid_state_root"
  | "invalid_redaction_value"
  | "invalid_run_id"
  | "invalid_run_plan"
  | "clock_invalid"
  | "process_identity_invalid"
  | "run_not_found"
  | "run_id_conflict"
  | "duplicate_work"
  | "state_schema_invalid"
  | "claim_schema_invalid"
  | "unsupported_schema_version"
  | "malformed_state"
  | "malformed_claim"
  | "claim_record_mismatch"
  | "secret_material_detected"
  | "filesystem_symlink"
  | "filesystem_permission"
  | "filesystem_path_escape"
  | "filesystem_not_owned"
  | "filesystem_io"
  | "ownership_lost"
  | "claim_released"
  | "revision_conflict"
  | "phase_regression"
  | "terminal_mutation_rejected"
  | "interrupted_mutation_rejected"
  | "invalid_update"
  | "terminal_result_mismatch"
  | "cleanup_not_allowed"
  | "cleanup_failed"
  | "claim_release_failed";

export interface ExistingRunInfo {
  readonly runId: string;
  readonly workUri: string;
  readonly phase: string;
  readonly revision: number;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface ControllerErrorJson {
  readonly name: "ControllerError" | "DuplicateWorkError";
  readonly code: ControllerErrorCode;
  readonly existingRun?: ExistingRunInfo;
}

export class ControllerError extends Error {
  readonly code: ControllerErrorCode;

  constructor(code: ControllerErrorCode) {
    super(code);
    this.name = "ControllerError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): ControllerErrorJson {
    return { name: "ControllerError", code: this.code };
  }
}

export class DuplicateWorkError extends ControllerError {
  readonly existingRun: ExistingRunInfo;

  constructor(existingRun: ExistingRunInfo) {
    super("duplicate_work");
    this.name = "DuplicateWorkError";
    this.existingRun = existingRun;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  override toJSON(): ControllerErrorJson {
    return {
      name: "DuplicateWorkError",
      code: this.code,
      existingRun: this.existingRun,
    };
  }
}

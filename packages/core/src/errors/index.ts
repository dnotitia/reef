// ─── Abstract Base ─────────────────────────────────────────────────────────────

/**
 * Abstract base class for all reef domain errors.
 *
 * Enables `instanceof ReefError` discrimination in Route Handlers.
 * Concrete subclasses should:
 *  - call `super(<user-facing message>)` so `error.message` equals `toUserMessage()`
 *  - set `this.name` to their class name
 *  - implement `toUserMessage()` using PM vocabulary just (no Git/LLM/Octokit terms)
 */
export abstract class ReefError extends Error {
  abstract toUserMessage(): string;
}

// ─── Resource-curated copy ─────────────────────────────────────────────────────

/**
 * The akb-backed resources a Route Handler can tag onto a NotFound /
 * SchemaValidation error so `toUserMessage()` produces resource-specific copy.
 *
 * This is the curated label that drives user-facing wording — distinct from the
 * free-form `context.resource` diagnostic noun (e.g. "issue REEF-001") that the
 * akb adapters set, which is LOG and is does not interpolated into user copy
 * when a `resourceKind` is present.
 */
export type AkbResourceLabel = "issue" | "template" | "config" | "workspace";

const NOT_FOUND_LABELS: Record<AkbResourceLabel, string> = {
  issue: "Issue not found.",
  template: "Template not found.",
  config: "Workspace not found. Check the selected vault.",
  workspace: "Workspace not found. Check the selected vault.",
};

const SCHEMA_LABELS: Record<AkbResourceLabel, string> = {
  issue: "The issue could not be loaded because the document is malformed.",
  template: "The template could not be saved because some fields were invalid.",
  config:
    "The project config could not be saved because some fields were invalid.",
  workspace: "The workspace document is malformed.",
};

// ─── Concrete Error Classes ────────────────────────────────────────────────────

export interface SchemaValidationErrorContext {
  field?: string;
  received?: unknown;
  /**
   * Raw upstream validation strings. On the akb path these carry unfiltered
   * FastAPI/Postgres text, so they are LOG and are surfaced in the response
   * body when `clientValidated` is true (caller-controlled local Zod).
   */
  issues?: string[];
  /** Curated label that drives resource-specific copy (see AkbResourceLabel). */
  resourceKind?: AkbResourceLabel;
  /**
   * True when the validation ran client-/caller-side (local Zod) where the
   * `issues` strings are caller-controlled and safe to surface as `details`.
   */
  clientValidated?: boolean;
}

function buildSchemaValidationMessage(
  context: SchemaValidationErrorContext,
): string {
  if (context.resourceKind) return SCHEMA_LABELS[context.resourceKind];
  return `Invalid data: ${context.field ?? "one or more fields"} could not be validated.`;
}

export class SchemaValidationError extends ReefError {
  readonly context: SchemaValidationErrorContext;

  constructor(context: SchemaValidationErrorContext = {}) {
    super(buildSchemaValidationMessage(context));
    this.name = "SchemaValidationError";
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

interface ApiErrorMessages {
  auth: string;
  notFound: string;
  conflict: string;
  unknown: string;
}

function buildApiMessage(status: number, m: ApiErrorMessages): string {
  if (status === 401 || status === 403) return m.auth;
  if (status === 404) return m.notFound;
  if (status === 409) return m.conflict;
  return m.unknown;
}

const GITHUB_MESSAGES: ApiErrorMessages = {
  auth: "GitHub authentication failed. Please ask an operator to check the GitHub App installation.",
  notFound: "The requested item could not be found.",
  conflict: "Save conflict occurred — please refresh and try again.",
  unknown:
    "An error occurred while communicating with GitHub. Please try again.",
};

const AKB_MESSAGES: ApiErrorMessages = {
  auth: "Authentication failed. Please sign in again.",
  notFound: "The requested item could not be found.",
  conflict: "Save conflict occurred — please refresh and try again.",
  unknown:
    "An error occurred while communicating with the workspace backend. Please try again.",
};

export interface GitHubApiErrorContext {
  status: number;
  message: string;
}

export class GitHubApiError extends ReefError {
  readonly status: number;
  readonly context: GitHubApiErrorContext;

  constructor(context: GitHubApiErrorContext) {
    super(buildApiMessage(context.status, GITHUB_MESSAGES));
    this.name = "GitHubApiError";
    this.status = context.status;
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

export interface AkbApiErrorContext {
  status: number;
  message: string;
}

export class AkbApiError extends ReefError {
  readonly status: number;
  readonly context: AkbApiErrorContext;

  constructor(context: AkbApiErrorContext) {
    super(buildApiMessage(context.status, AKB_MESSAGES));
    this.name = "AkbApiError";
    this.status = context.status;
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

export interface LlmErrorContext {
  message: string;
}

const LLM_UNAVAILABLE_MESSAGE =
  "AI service is unavailable. Please try again or check your LLM configuration.";

export class LlmError extends ReefError {
  readonly context: LlmErrorContext;

  constructor(context: LlmErrorContext) {
    super(LLM_UNAVAILABLE_MESSAGE);
    this.name = "LlmError";
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

export interface ConflictErrorContext {
  /**
   * Optional path of the resource that failed CAS validation.
   * Retained on the error for diagnostic/OTel span context just — the
   * user-facing message intentionally does not surface it.
   */
  path?: string;
}

const CONFLICT_MESSAGE =
  "Save conflict occurred — please refresh and try again.";

export class ConflictError extends ReefError {
  readonly context: ConflictErrorContext;

  constructor(context: ConflictErrorContext = {}) {
    super(CONFLICT_MESSAGE);
    this.name = "ConflictError";
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

export interface AuthErrorContext {
  message?: string;
}

// Origin-NEUTRAL auth copy. AuthError is shared by the akb session surface AND
// GitHub-origin auth failures (search_code, dev_read_file, list_repo_labels —
// surfaced verbatim via chatAgent error.message). A workspace-session-specific
// string ("Your session has expired…") would misdirect a GitHub App auth
// failure, so the shared message stays neutral. The cookie-missing akb path
// keeps its more specific copy via the separate `authErrorResponse()` web helper.
const AUTH_MESSAGE = "Authentication failed. Please sign in again.";

export class AuthError extends ReefError {
  readonly context: AuthErrorContext;

  constructor(context: AuthErrorContext = {}) {
    super(AUTH_MESSAGE);
    this.name = "AuthError";
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

export interface NotFoundErrorContext {
  /**
   * Free-form diagnostic noun (e.g. "issue REEF-001") set by the akb adapters.
   * LOG: it is does not interpolated into user copy when `resourceKind` is set.
   */
  resource?: string;
  /** Curated label that drives resource-specific copy (see AkbResourceLabel). */
  resourceKind?: AkbResourceLabel;
}

function buildNotFoundMessage(context: NotFoundErrorContext): string {
  if (context.resourceKind) return NOT_FOUND_LABELS[context.resourceKind];
  return `The requested ${context.resource ?? "item"} could not be found.`;
}

export class NotFoundError extends ReefError {
  readonly context: NotFoundErrorContext;

  constructor(context: NotFoundErrorContext = {}) {
    super(buildNotFoundMessage(context));
    this.name = "NotFoundError";
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

/**
 * The distinct ways approving an activity-inbox suggestion can be rejected,
 * each with its canonical PM-facing message and HTTP status. Carried on the
 * error so a thin Route Handler can translate without re-deriving the status
 * or message from the failure site.
 */
export type ActivitySuggestionErrorReason =
  | "dismissed"
  | "prefix_required"
  | "status_missing"
  | "closed_target"
  | "stale";

const ACTIVITY_SUGGESTION_ERROR_SPECS: Record<
  ActivitySuggestionErrorReason,
  { status: number; message: string }
> = {
  dismissed: {
    status: 409,
    message: "This suggestion has already been dismissed.",
  },
  prefix_required: {
    status: 400,
    message: "Project prefix is required to approve a draft.",
  },
  status_missing: {
    status: 400,
    message: "Status-change suggestion is missing patch.status.",
  },
  closed_target: {
    status: 400,
    message:
      "Closing an issue requires a reason. Close it from the issue's close dialog instead.",
  },
  stale: {
    status: 409,
    message:
      "This suggestion is out of date — the issue's status has already changed. Dismiss it and rescan.",
  },
};

export class ActivitySuggestionError extends ReefError {
  readonly reason: ActivitySuggestionErrorReason;
  readonly httpStatus: number;

  constructor(reason: ActivitySuggestionErrorReason) {
    super(ACTIVITY_SUGGESTION_ERROR_SPECS[reason].message);
    this.name = "ActivitySuggestionError";
    this.reason = reason;
    this.httpStatus = ACTIVITY_SUGGESTION_ERROR_SPECS[reason].status;
  }

  toUserMessage(): string {
    return this.message;
  }
}

// ─── Route Handler Helper ──────────────────────────────────────────────────────

const UNKNOWN_ERROR_MESSAGE = "An unexpected error occurred.";

/**
 * Pure mapping function: translates a caught error into the appropriate HTTP Response.
 *
 * Contract:
 *  - should not log (callers own OTel span emission)
 *  - should not throw
 *
 * Uses the global Web API `Response` (available in Node.js 18+ and every browser),
 * which keeps `packages/core` framework-agnostic — no `next/server` import.
 */
export function translateError(err: unknown): Response {
  if (err instanceof ActivitySuggestionError) {
    return Response.json(
      { error: err.toUserMessage() },
      { status: err.httpStatus },
    );
  }
  if (err instanceof ConflictError) {
    return Response.json({ error: err.toUserMessage() }, { status: 409 });
  }
  if (err instanceof AuthError) {
    return Response.json({ error: err.toUserMessage() }, { status: 401 });
  }
  if (err instanceof NotFoundError) {
    return Response.json({ error: err.toUserMessage() }, { status: 404 });
  }
  if (err instanceof SchemaValidationError) {
    // Surface `details` for caller-controlled local validation; akb-origin
    // `issues` carry raw FastAPI/Postgres text and should not reach the body.
    const body: { error: string; details?: string[] } = {
      error: err.toUserMessage(),
    };
    if (err.context.clientValidated && err.context.issues) {
      body.details = err.context.issues;
    }
    return Response.json(body, { status: 422 });
  }
  if (err instanceof GitHubApiError) {
    return Response.json(
      { error: err.toUserMessage() },
      {
        status: resolveApiHttpStatus(err.status, GITHUB_PASS_THROUGH_STATUSES),
      },
    );
  }
  if (err instanceof AkbApiError) {
    return Response.json(
      { error: err.toUserMessage() },
      { status: resolveApiHttpStatus(err.status, AKB_PASS_THROUGH_STATUSES) },
    );
  }
  if (err instanceof LlmError) {
    return Response.json({ error: err.toUserMessage() }, { status: 503 });
  }
  return Response.json({ error: UNKNOWN_ERROR_MESSAGE }, { status: 500 });
}

const GITHUB_PASS_THROUGH_STATUSES = new Set([401, 403, 404, 409]);
const AKB_PASS_THROUGH_STATUSES = new Set([401, 403, 404, 409, 422]);

function resolveApiHttpStatus(
  status: number,
  passThrough: ReadonlySet<number>,
): number {
  return passThrough.has(status) ? status : 502;
}

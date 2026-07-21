// ─── Abstract Base ─────────────────────────────────────────────────────────────

/**
 * Abstract base class for all reef domain errors.
 *
 * Enables `instanceof ReefError` discrimination in Route Handlers.
 * Concrete subclasses should:
 *  - call `super(<user-facing message>)` so `error.message` equals `toUserMessage()`
 *  - set `this.name` to their class name
 *  - implement `toUserMessage()` using PM vocabulary just (no Git/LLM/Octokit terms)
 *
 * i18n contract (ADR-0001 / REEF-297): `core` is the framework-agnostic boundary
 * and does not know the request locale, so it leaves localization to `web`.
 * Each error carries a STABLE CODE (`describeError`) into a key in the en base
 * catalog (`ERROR_MESSAGES_EN`); `web` resolves the active locale at its boundary
 * and translates that code, falling back to en for any key a locale omits. The
 * English `message` / `toUserMessage()` stays derived from the same en base, so it
 * remains the single English source for logs, spans, and non-localized callers.
 */
export abstract class ReefError extends Error {
  abstract toUserMessage(): string;
}

// ─── Error code → catalog key ──────────────────────────────────────────────────

/**
 * A stable error code is a dot path into `ERROR_MESSAGES_EN` (and the matching
 * `errors.*` next-intl namespace web composes from it). It is locale-free: `web`
 * resolves it against the active locale. Kept as a `string` rather than a union
 * so the dynamic `github.${apiCode(status)}` style codes stay ergonomic; the
 * catalog shape below defines which codes exist.
 */
export type ErrorCode = string;

/**
 * The en base catalog for reef error messages, keyed by the stable error code
 * (ADR-0001 / REEF-297). `core` exports this as pure data; `web` composes it
 * into the next-intl `errors`
 * namespace, resolves the active locale (en/ko), and falls back to these strings
 * for any key a locale omits (AC3). `{resource}` / `{field}` are ICU placeholders
 * substituted at render time — by next-intl in `web`, by `resolveEnMessage` here.
 *
 * Distinct codes may share an English string (e.g. the akb and GitHub conflict
 * copy) on purpose: they are different origins that a locale may word
 * differently, so they stay separate keys.
 */
export const ERROR_MESSAGES_EN = {
  auth: "Authentication failed. Please sign in again.",
  conflict: "Save conflict occurred — please refresh and try again.",
  unknown: "An unexpected error occurred.",
  llm: {
    unavailable:
      "AI service is unavailable. Please try again or check your LLM configuration.",
  },
  notFound: {
    item: "The requested {resource} could not be found.",
    issue: "Issue not found.",
    template: "Template not found.",
    config: "Workspace not found. Check the selected vault.",
    workspace: "Workspace not found. Check the selected vault.",
    commentParent:
      "The comment you are replying to could not be found in this issue.",
  },
  schema: {
    invalid: "Invalid data: {field} could not be validated.",
    issue: "The issue could not be loaded because the document is malformed.",
    template:
      "The template could not be saved because some fields were invalid.",
    config:
      "The project config could not be saved because some fields were invalid.",
    workspace: "The workspace document is malformed.",
  },
  github: {
    auth: "GitHub authentication failed. Please ask an operator to check the GitHub App installation.",
    notFound: "The requested item could not be found.",
    conflict: "Save conflict occurred — please refresh and try again.",
    unknown:
      "An error occurred while communicating with GitHub. Please try again.",
  },
  akb: {
    auth: "Authentication failed. Please sign in again.",
    membershipRequired:
      "This account does not have access to this workspace. Ask a workspace administrator for membership.",
    accountSuspended:
      "This account is suspended. Contact a workspace administrator.",
    identityConflict:
      "This sign-in identity conflicts with the account linked to this workspace. Contact a workspace administrator.",
    notFound: "The requested item could not be found.",
    conflict: "Save conflict occurred — please refresh and try again.",
    unknown:
      "An error occurred while communicating with the workspace backend. Please try again.",
  },
  activitySuggestion: {
    dismissed: "This suggestion has already been dismissed.",
    prefixRequired: "Project prefix is required to approve a draft.",
    statusMissing: "Status-change suggestion is missing patch.status.",
    closedTarget:
      "Closing an issue requires a reason. Close it from the issue's close dialog instead.",
    stale:
      "This suggestion is out of date — the issue's status has already changed. Dismiss it and rescan.",
  },
};

/**
 * Resolve an error code to its English string with `{param}` substitution.
 *
 * Pure and locale-free: this is how a `core` error keeps `error.message` /
 * `toUserMessage()` English (the single English source) without depending on
 * next-intl. `web` resolves the SAME code against the active locale instead.
 */
function resolveEnMessage(
  code: ErrorCode,
  params?: Record<string, string>,
): string {
  let node: unknown = ERROR_MESSAGES_EN;
  for (const segment of code.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[segment];
  }
  let message = typeof node === "string" ? node : ERROR_MESSAGES_EN.unknown;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      message = message.split(`{${key}}`).join(value);
    }
  }
  return message;
}

// ─── Resource-curated copy ─────────────────────────────────────────────────────

/**
 * The akb-backed resources a Route Handler can tag onto a NotFound /
 * SchemaValidation error so the resolved message is resource-specific.
 *
 * This is the curated label that drives user-facing wording — distinct from the
 * free-form `context.resource` diagnostic noun (e.g. "issue REEF-001") that the
 * akb adapters set, which is LOG and is not interpolated into user copy when a
 * `resourceKind` is present.
 */
export type AkbResourceLabel =
  | "issue"
  | "template"
  | "config"
  | "workspace"
  | "commentParent";

// ─── Error descriptor ──────────────────────────────────────────────────────────

/**
 * The locale-free description of an error: a stable catalog `code`, the HTTP
 * `status`, optional ICU `params`, and optional caller-controlled `details`.
 * This is the AC4 seam — `core` hands `web` a code + status, `web` localizes.
 */
export interface ErrorDescriptor {
  code: ErrorCode;
  status: number;
  /** ICU interpolation values for `{resource}` / `{field}` placeholder codes. */
  params?: Record<string, string>;
  /** Caller-controlled validation strings safe to surface (clientValidated). */
  details?: string[];
}

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

/** Code + params for a schema-validation error, shared by the ctor and describeError. */
function schemaValidationCode(context: SchemaValidationErrorContext): {
  code: ErrorCode;
  params?: Record<string, string>;
} {
  if (context.resourceKind) return { code: `schema.${context.resourceKind}` };
  return {
    code: "schema.invalid",
    params: { field: context.field ?? "one or more fields" },
  };
}

export class SchemaValidationError extends ReefError {
  readonly context: SchemaValidationErrorContext;

  constructor(context: SchemaValidationErrorContext = {}) {
    const { code, params } = schemaValidationCode(context);
    super(resolveEnMessage(code, params));
    this.name = "SchemaValidationError";
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

/**
 * Map an upstream API status to the `{auth,notFound,conflict,unknown}` message
 * sub-key shared by the GitHub and akb error namespaces.
 */
function apiCode(status: number): "auth" | "notFound" | "conflict" | "unknown" {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  return "unknown";
}

export interface GitHubApiErrorContext {
  status: number;
  message: string;
}

export class GitHubApiError extends ReefError {
  readonly status: number;
  readonly context: GitHubApiErrorContext;

  constructor(context: GitHubApiErrorContext) {
    super(resolveEnMessage(`github.${apiCode(context.status)}`));
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
  /** Stable upstream code safe for control flow; never raw response text. */
  code?: string;
}

export class AkbApiError extends ReefError {
  readonly status: number;
  readonly context: AkbApiErrorContext;

  constructor(context: AkbApiErrorContext) {
    super(resolveEnMessage(`akb.${apiCode(context.status)}`));
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

export class LlmError extends ReefError {
  readonly context: LlmErrorContext;

  constructor(context: LlmErrorContext) {
    super(resolveEnMessage("llm.unavailable"));
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

export class ConflictError extends ReefError {
  readonly context: ConflictErrorContext;

  constructor(context: ConflictErrorContext = {}) {
    super(resolveEnMessage("conflict"));
    this.name = "ConflictError";
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

export interface AuthErrorContext {
  message?: string;
  origin?: "akb" | "github";
  code?: string;
  status?: number;
}

export const AKB_ACCOUNT_ERROR_SPECS = {
  membership_required: { code: "akb.membershipRequired", status: 403 },
  account_suspended: { code: "akb.accountSuspended", status: 403 },
  identity_conflict: { code: "akb.identityConflict", status: 409 },
} as const;

export type AkbAccountErrorCode = keyof typeof AKB_ACCOUNT_ERROR_SPECS;

export function isAkbAccountErrorCode(
  value: unknown,
): value is AkbAccountErrorCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(AKB_ACCOUNT_ERROR_SPECS, value)
  );
}

function authErrorCode(context: AuthErrorContext): {
  code: ErrorCode;
  status: number;
} {
  if (context.origin === "akb" && isAkbAccountErrorCode(context.code)) {
    return AKB_ACCOUNT_ERROR_SPECS[context.code];
  }
  return { code: "auth", status: 401 };
}

// Origin-NEUTRAL auth copy. AuthError is shared by the akb session surface AND
// GitHub-origin auth failures (search_code, dev_read_file, list_repo_labels —
// surfaced verbatim via chatAgent error.message). A workspace-session-specific
// string ("Your session has expired…") would misdirect a GitHub App auth
// failure, so the shared message stays neutral. The cookie-missing akb path
// keeps its more specific copy via the separate `authErrorResponse()` web helper.
export class AuthError extends ReefError {
  readonly context: AuthErrorContext;

  constructor(context: AuthErrorContext = {}) {
    super(resolveEnMessage(authErrorCode(context).code));
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
   * LOG: it is not interpolated into user copy when `resourceKind` is set.
   */
  resource?: string;
  /** Curated label that drives resource-specific copy (see AkbResourceLabel). */
  resourceKind?: AkbResourceLabel;
}

/** Code + params for a not-found error, shared by the ctor and describeError. */
function notFoundCode(context: NotFoundErrorContext): {
  code: ErrorCode;
  params?: Record<string, string>;
} {
  if (context.resourceKind) return { code: `notFound.${context.resourceKind}` };
  return {
    code: "notFound.item",
    params: { resource: context.resource ?? "item" },
  };
}

export class NotFoundError extends ReefError {
  readonly context: NotFoundErrorContext;

  constructor(context: NotFoundErrorContext = {}) {
    const { code, params } = notFoundCode(context);
    super(resolveEnMessage(code, params));
    this.name = "NotFoundError";
    this.context = context;
  }

  toUserMessage(): string {
    return this.message;
  }
}

/**
 * The distinct ways approving an activity-inbox suggestion can be rejected,
 * each with its canonical PM-facing message code and HTTP status. Carried on the
 * error so a thin Route Handler can translate without re-deriving the status
 * or code from the failure site.
 */
export type ActivitySuggestionErrorReason =
  | "dismissed"
  | "prefix_required"
  | "status_missing"
  | "closed_target"
  | "stale";

const ACTIVITY_SUGGESTION_ERROR_SPECS: Record<
  ActivitySuggestionErrorReason,
  { status: number; code: ErrorCode }
> = {
  dismissed: { status: 409, code: "activitySuggestion.dismissed" },
  prefix_required: { status: 400, code: "activitySuggestion.prefixRequired" },
  status_missing: { status: 400, code: "activitySuggestion.statusMissing" },
  closed_target: { status: 400, code: "activitySuggestion.closedTarget" },
  stale: { status: 409, code: "activitySuggestion.stale" },
};

export class ActivitySuggestionError extends ReefError {
  readonly reason: ActivitySuggestionErrorReason;
  readonly httpStatus: number;

  constructor(reason: ActivitySuggestionErrorReason) {
    super(resolveEnMessage(ACTIVITY_SUGGESTION_ERROR_SPECS[reason].code));
    this.name = "ActivitySuggestionError";
    this.reason = reason;
    this.httpStatus = ACTIVITY_SUGGESTION_ERROR_SPECS[reason].status;
  }

  toUserMessage(): string {
    return this.message;
  }
}

// ─── Error description (the AC4 web-localization seam) ──────────────────────────

const GITHUB_PASS_THROUGH_STATUSES = new Set([401, 403, 404, 409]);
const AKB_PASS_THROUGH_STATUSES = new Set([401, 403, 404, 409, 422]);

function resolveApiHttpStatus(
  status: number,
  passThrough: ReadonlySet<number>,
): number {
  return passThrough.has(status) ? status : 502;
}

/**
 * Pure mapping: describe any caught error as a locale-free `{ code, status }`
 * (plus optional ICU `params` / `details`). This is the framework-agnostic half
 * of error translation — `web` resolves the active locale and turns the code
 * into a localized Response at its boundary (ADR-0001 / REEF-297 AC2+AC4).
 *
 * Contract:
 *  - pure (no logging — callers own OTel span emission)
 *  - total: unrecognized errors map to `unknown` / 500
 *  - carries no message text, just a stable code the locale resolves
 */
export function describeError(err: unknown): ErrorDescriptor {
  if (err instanceof ActivitySuggestionError) {
    return {
      code: ACTIVITY_SUGGESTION_ERROR_SPECS[err.reason].code,
      status: err.httpStatus,
    };
  }
  if (err instanceof ConflictError) return { code: "conflict", status: 409 };
  if (err instanceof AuthError) return authErrorCode(err.context);
  if (err instanceof NotFoundError) {
    return { ...notFoundCode(err.context), status: 404 };
  }
  if (err instanceof SchemaValidationError) {
    const descriptor: ErrorDescriptor = {
      ...schemaValidationCode(err.context),
      status: 422,
    };
    // Surface `details` for caller-controlled local validation; akb-origin
    // `issues` carry raw FastAPI/Postgres text and stay in diagnostics.
    if (err.context.clientValidated && err.context.issues) {
      descriptor.details = err.context.issues;
    }
    return descriptor;
  }
  if (err instanceof GitHubApiError) {
    return {
      code: `github.${apiCode(err.status)}`,
      status: resolveApiHttpStatus(err.status, GITHUB_PASS_THROUGH_STATUSES),
    };
  }
  if (err instanceof AkbApiError) {
    return {
      code: `akb.${apiCode(err.status)}`,
      status: resolveApiHttpStatus(err.status, AKB_PASS_THROUGH_STATUSES),
    };
  }
  if (err instanceof LlmError) {
    return { code: "llm.unavailable", status: 503 };
  }
  return { code: "unknown", status: 500 };
}

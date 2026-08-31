import type { IssueMetadata } from "../../../schemas/issues/metadata";
import type {
  IssueChangeReviewResponse,
  IssueChangeReviewRange,
} from "../../../schemas/issues/changeReview";
import type {
  IssueListQuery,
  IssueReorderGroup,
} from "../../../schemas/issues/requests";
import type { Template } from "../../../schemas/issues/template";
import type {
  Milestone,
  Release,
  Sprint,
} from "../../../schemas/planning/catalog";
import type { Config } from "../../../schemas/workspace/config";
import type { AkbAdapter } from "./http";

export interface VaultMember {
  username: string;
  display_name?: string | null;
  email?: string | null;
  role: string;
  since?: string | null;
}

export interface UserSearchResult {
  username: string;
  display_name?: string | null;
  email?: string | null;
}

export interface VaultSummary {
  id?: string;
  name: string;
  description?: string | null;
  status?: string | null;
  role?: string | null;
  created_at?: string | null;
  has_reef_config?: boolean;
}

export interface EnrichedVaultSummary extends VaultSummary {
  has_reef_config: boolean;
}

export interface ReadIssueParams {
  adapter: AkbAdapter;
  vault: string;
  /** reef issue ID (e.g. "REEF-001"). */
  id: string;
}

export interface ReadIssueResult {
  issue: IssueMetadata;
  /** akb-relative path (e.g. "issues/reef-001-some-slug.md"). */
  path: string;
  /** Git commit hash of the last write. Null if akb did not return one. */
  commit_hash: string | null;
  /** Plain markdown issue content stored in the akb document body. */
  content: string;
}

export interface WriteIssueParams {
  adapter: AkbAdapter;
  vault: string;
  issue: IssueMetadata;
  /** Plain markdown issue content stored in the akb document body. */
  content?: string;
  /**
   * Claim the unique reef_issues key before creating the document. Migration
   * callers use this to make a planned issue id an atomic target-side claim.
   */
  claimFirst?: boolean;
}

export interface ClaimIssueIdParams {
  adapter: AkbAdapter;
  vault: string;
  issue: IssueMetadata;
}

export interface WriteIssueResult {
  path: string;
  commit_hash: string;
  /** Metadata after server-owned projections have been derived. */
  issue: IssueMetadata;
}

export interface UpdateIssueParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
  /** Partial metadata fields to merge into the existing reef issue. */
  partial: Partial<IssueMetadata>;
  /**
   * Replacement markdown body. When omitted the existing body is preserved.
   * Pass an empty string to explicitly clear the body.
   */
  content?: string;
  /** Optional commit message; akb defaults to "Update {path}" otherwise. */
  message?: string;
  /**
   * OCC base — the akb document commit the caller read before editing. When the
   * edit is document-dirty (body/title/labels/relations) it is sent as akb's
   * `expected_commit` precondition so a concurrent external edit is rejected
   * with a `ConflictError` instead of silently overwritten (REEF-227). Ignored
   * for row-edits, which stay last-write-wins.
   */
  expectedCommit?: string;
  /**
   * Row-level OCC base for trusted read-modify-write callers. The update
   * proceeds when the persisted row still carries this `updated_at` value.
   */
  expectedUpdatedAt?: string;
}

export interface UpdateIssueResult {
  commit_hash: string;
  /** Merged metadata the issue now has — saves callers a re-read. */
  issue: IssueMetadata;
  /** Markdown body after the merge (matches the new persisted state). */
  content: string;
}

export interface DeleteIssueParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
}

export interface ReorderIssueParams {
  adapter: AkbAdapter;
  vault: string;
  /** The collection rendered by the source surface. */
  scope: "active" | "backlog";
  /** The issue being moved. */
  issueId: string;
  /** The issue immediately before the target slot, or null at the top. */
  beforeId: string | null;
  /** The issue immediately after the target slot, or null at the bottom. */
  afterId: string | null;
  /** Snapshots used to reject stale visible neighbours and moved rows. */
  expected: {
    issueRank: number | null;
    issueUpdatedAt: string;
    beforeRank: number | null;
    beforeUpdatedAt: string | null;
    afterRank: number | null;
    afterUpdatedAt: string | null;
  };
  /** Optional single-value Board/Backlog group mutation. */
  group?: IssueReorderGroup;
  /** The semantic actor projected into meta.last_editor/activity. */
  actor: string;
  /** The server-side timestamp for a status transition, when needed. */
  at: string;
}

export interface ReorderIssueResult {
  assignments: ReadonlyArray<{
    id: string;
    rank: number;
    updatedAt?: string;
  }>;
}

export interface ListIssuesParams {
  adapter: AkbAdapter;
  vault: string;
  /**
   * Optional server-side filter / sort. When omitted, `listIssues` returns the
   * full vault unfiltered (the historical behavior). When present, it is
   * translated to a `WHERE` / `ORDER BY` against `reef_issues`.
   */
  query?: IssueListQuery;
  /**
   * Current actor (akb username) for the `default_view` "My Issues" predicate.
   * Server-derived from the session cookie — not from the wire query. When
   * absent, the default view degrades to the active-sprint / status-window
   * floor.
   */
  actor?: string;
}

export interface ListIssuesResult {
  issues: IssueMetadata[];
  /**
   * Opaque keyset cursor for the next page, or null when there is no next page
   * (or pagination was not requested via `query.limit`).
   */
  next_cursor?: string | null;
}

export interface ListIssueChangeReviewParams {
  adapter: AkbAdapter;
  vault: string;
  range: IssueChangeReviewRange;
}

export type ListIssueChangeReviewResult = IssueChangeReviewResponse;

export interface AllocateNextIssueIdParams {
  adapter: AkbAdapter;
  vault: string;
  prefix: string;
}

export interface WriteMultipleIssuesInput {
  adapter: AkbAdapter;
  vault: string;
  issues: ReadonlyArray<{ issue: IssueMetadata; content?: string }>;
}

export interface WriteMultipleIssuesItemResult {
  id: string;
  success: boolean;
  path?: string;
  commit_hash?: string;
  error?: string;
}

export interface WriteMultipleIssuesOutput {
  results: WriteMultipleIssuesItemResult[];
}

// ── Template / Config / Vault meta ──

export interface TemplateEntry {
  template: Template;
}

export interface ListTemplatesParams {
  adapter: AkbAdapter;
  vault: string;
}

export interface ReadTemplateParams {
  adapter: AkbAdapter;
  vault: string;
  name: string;
}

export interface ReadTemplateResult {
  template: Template;
}

export interface WriteTemplateParams {
  adapter: AkbAdapter;
  vault: string;
  template: Template;
}

export interface DeleteTemplateParams {
  adapter: AkbAdapter;
  vault: string;
  name: string;
}

export interface ListPlanningCatalogParams {
  adapter: AkbAdapter;
  vault: string;
}

export interface CreateSprintParams {
  adapter: AkbAdapter;
  vault: string;
  item: Omit<Sprint, "id">;
  idempotencyKey?: string;
}

export interface UpdateSprintParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
  item: Sprint;
}

export interface DeleteSprintParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
}

export interface CreateMilestoneParams {
  adapter: AkbAdapter;
  vault: string;
  item: Omit<Milestone, "id">;
}

export interface UpdateMilestoneParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
  item: Milestone;
}

export interface DeleteMilestoneParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
}

export interface CreateReleaseParams {
  adapter: AkbAdapter;
  vault: string;
  item: Omit<Release, "id">;
  idempotencyKey?: string;
}

export interface ReadPlanningCreateClaimParams {
  adapter: AkbAdapter;
  vault: string;
  kind: "release" | "sprint";
  idempotencyKey: string;
}

export interface UpdateReleaseParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
  item: Release;
}

export interface DeleteReleaseParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
}

export interface ReadConfigParams {
  adapter: AkbAdapter;
  vault: string;
}

export interface ReadConfigResult {
  config: Config;
  /**
   * `true` when the vault has been onboarded to reef — concretely, the
   * `reef_settings` table has a `project_prefix` row. A raw akb vault does not
   * touched by reef reads as `exists: false` with `config: DEFAULT_CONFIG`.
   */
  exists: boolean;
}

export interface WriteConfigParams {
  adapter: AkbAdapter;
  vault: string;
  config: Config;
  /**
   * Reserved for future use — was the git commit message back when config
   * lived as a document. Tables don't have commits; kept on the interface so
   * callers don't have to change their call sites yet.
   */
  message?: string;
}

export interface ListVaultMembersParams {
  adapter: AkbAdapter;
  vault: string;
}

export interface ListVaultMembersResult {
  members: VaultMember[];
}

export interface GrantVaultMemberParams {
  adapter: AkbAdapter;
  vault: string;
  /** akb username of the member being granted or re-roled. */
  user: string;
  /** Target role: reader / writer / admin (akb rejects "owner"). */
  role: string;
}

export interface GrantVaultMemberResult {
  vault: string;
  user: string;
  role: string;
}

export interface RevokeVaultMemberParams {
  adapter: AkbAdapter;
  vault: string;
  user: string;
}

export interface SearchUsersParams {
  adapter: AkbAdapter;
  /** Substring matched against username / display_name / email. */
  query?: string;
  /** Result cap (akb defaults to 20, max 100). */
  limit?: number;
}

export interface SearchUsersResult {
  users: UserSearchResult[];
}

export interface ListVaultsParams {
  adapter: AkbAdapter;
}

export interface ListVaultsResult {
  vaults: VaultSummary[];
}

export interface CreateVaultParams {
  adapter: AkbAdapter;
  name: string;
  description?: string;
}

export interface CreateVaultResult {
  vault_id: string;
  name: string;
  template: string | null;
  public_access: string | null;
}

export interface DeleteVaultParams {
  adapter: AkbAdapter;
  vault: string;
  /** Acting user — recorded on the audit span before the irreversible delete. */
  actor: string;
}

export interface DetachReefParams {
  adapter: AkbAdapter;
  vault: string;
  /** Acting user — recorded on the audit span for the detach. */
  actor: string;
}

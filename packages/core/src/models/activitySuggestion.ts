import type {
  PendingDraft,
  PendingStatusChange,
} from "../schemas/activity/pendingDraft";
import type {
  ActivityDraftSuggestion,
  ActivityStatusChangeSuggestion,
} from "../schemas/activity/suggestion";

const HASH_PREFIX_LENGTH = 16;

async function digestHex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function activityDraftFingerprint(draft: PendingDraft): string {
  return `${draft.provenance.repo}:${draft.provenance.type}:${draft.provenance.ref}`;
}

export function activityStatusChangeFingerprint(
  statusChange: PendingStatusChange,
): string {
  const refs = statusChange.evidence
    .map((e) => `${e.repo}:${e.type}:${e.ref}`)
    .slice()
    .sort()
    .join(",");
  return `${statusChange.proposal.update.issue_id}|${statusChange.proposal.update.patch.status}|${refs}`;
}

export async function activitySuggestionId(
  kind:
    | ActivityDraftSuggestion["kind"]
    | ActivityStatusChangeSuggestion["kind"],
  fingerprint: string,
): Promise<string> {
  const prefix = kind === "draft" ? "reef-draft" : "reef-status";
  const hash = (await digestHex(fingerprint)).slice(0, HASH_PREFIX_LENGTH);
  return `${prefix}-${hash}`;
}

export async function draftToActivitySuggestion(
  draft: PendingDraft,
): Promise<ActivityDraftSuggestion> {
  const fingerprint = activityDraftFingerprint(draft);
  return {
    id: await activitySuggestionId("draft", fingerprint),
    kind: "draft",
    status: draft.status,
    fingerprint,
    repo: draft.provenance.repo,
    created_at: draft.createdAt,
    detected_at: draft.provenance.detectedAt,
    proposal: draft.proposal,
    provenance: draft.provenance,
    confidence: draft.confidence,
    reasoning: draft.reasoning,
  };
}

export async function statusChangeToActivitySuggestion(
  statusChange: PendingStatusChange,
): Promise<ActivityStatusChangeSuggestion> {
  const fingerprint = activityStatusChangeFingerprint(statusChange);
  return {
    id: await activitySuggestionId("status_change", fingerprint),
    kind: "status_change",
    status: statusChange.status,
    fingerprint,
    repo: statusChange.evidence[0]?.repo ?? "",
    created_at: statusChange.createdAt,
    detected_at: statusChange.detectedAt,
    issue_title: statusChange.issueTitle,
    from_status: statusChange.fromStatus,
    proposal: statusChange.proposal,
    rationale: statusChange.rationale,
    evidence: statusChange.evidence,
    confidence: statusChange.confidence,
  };
}

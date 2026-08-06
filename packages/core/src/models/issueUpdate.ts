import type {
  IssueMetadata,
  IssueUpdateInput,
} from "../schemas/issues/metadata";

export function buildIssueUpdateMetadataPatch(input: {
  update: IssueUpdateInput;
  actor: string;
  now?: string;
  source?: string;
}): Partial<IssueMetadata> {
  const now = input.now ?? new Date().toISOString();
  const { patch } = input.update;
  const next: Partial<IssueMetadata> = {
    ...patch,
    updated_at: now,
    updated_by: input.actor,
  };

  if (input.source !== undefined) {
    next.source = input.source;
  }

  if (patch.status !== undefined) {
    next.last_status_change = now;
    if (patch.status === "closed") {
      next.closed_at = now;
    } else {
      next.closed_at = null;
      next.closed_reason = null;
    }
  }

  return next;
}

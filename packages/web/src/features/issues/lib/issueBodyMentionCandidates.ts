import { rankIssueOptions } from "@/features/issues/lib/rankIssueOptions";
import type { IssueListItem, VaultMember } from "@reef/core";

export type IssueBodyReferenceCandidate =
  | { kind: "person"; member: VaultMember }
  | { kind: "issue"; issue: IssueListItem };

/** People stay ahead of ranked, unarchived issues in body reference search. */
export function filterIssueBodyMentionCandidates(
  members: readonly VaultMember[],
  issues: readonly IssueListItem[],
  query: string,
  limit = 8,
): IssueBodyReferenceCandidate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const people = members
    .filter((member) => {
      const username = member.username.toLocaleLowerCase();
      const displayName = member.display_name?.toLocaleLowerCase() ?? "";
      return (
        normalizedQuery.length === 0 ||
        username.includes(normalizedQuery) ||
        displayName.includes(normalizedQuery)
      );
    })
    .slice(0, limit)
    .map((member) => ({ kind: "person" as const, member }));
  const rankedIssues = rankIssueOptions(issues, query, limit).map(
    ({ issue }) => ({
      kind: "issue" as const,
      issue,
    }),
  );
  return [...people, ...rankedIssues];
}

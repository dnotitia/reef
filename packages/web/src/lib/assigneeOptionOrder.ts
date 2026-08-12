import type { Collaborator } from "@reef/core";

function displayNameFor(candidate: Collaborator): string {
  return candidate.name?.trim() || candidate.login;
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCandidates(left: Collaborator, right: Collaborator): number {
  return (
    compareText(displayNameFor(left), displayNameFor(right)) ||
    compareText(left.login, right.login)
  );
}

/**
 * Orders assignable people without mutating the server result. A login in the
 * recent list is promoted only when it is still present in the current
 * assignable roster; every other candidate follows the deterministic
 * display-name/login order.
 */
export function orderAssigneeCollaborators(
  candidates: readonly Collaborator[],
  recentLogins: readonly string[],
): Collaborator[] {
  const byLogin = new Map(
    candidates.map((candidate) => [candidate.login, candidate]),
  );
  const recent: Collaborator[] = [];
  const promoted = new Set<string>();

  for (const login of recentLogins) {
    const candidate = byLogin.get(login);
    if (!candidate || promoted.has(login)) continue;
    promoted.add(login);
    recent.push(candidate);
  }

  const remaining = candidates
    .filter((candidate) => !promoted.has(candidate.login))
    .slice()
    .sort(compareCandidates);

  return [...recent, ...remaining];
}

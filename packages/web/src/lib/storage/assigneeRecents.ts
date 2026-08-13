import { getConfigValue, setConfigValue } from "./config";

const ASSIGNEE_RECENTS_VERSION = 1;

interface AssigneeRecentsEnvelope {
  version: typeof ASSIGNEE_RECENTS_VERSION;
  logins: string[];
}

export function assigneeRecentsStorageKey(
  actor: string,
  vault: string,
): string {
  return `assignee_recents:${actor}:${vault}`;
}

export function assigneeRecentsQueryKey(
  actor: string | null,
  vault: string,
): readonly [string, string | null, string] {
  return ["assignee-recents", actor, vault];
}

function parseAssigneeRecents(raw: string | undefined): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== ASSIGNEE_RECENTS_VERSION ||
    !Array.isArray((parsed as { logins?: unknown }).logins)
  ) {
    return [];
  }

  const logins: string[] = [];
  const seen = new Set<string>();
  for (const login of (parsed as { logins: unknown[] }).logins) {
    if (typeof login !== "string" || !login || seen.has(login)) continue;
    seen.add(login);
    logins.push(login);
  }
  return logins;
}

export async function getRecentAssigneeLogins(
  actor: string | null,
  vault: string,
): Promise<string[]> {
  if (!actor || !vault) return [];
  return parseAssigneeRecents(
    await getConfigValue(assigneeRecentsStorageKey(actor, vault)),
  );
}

/**
 * Persists a successful non-null assignment and returns the value that was
 * actually readable afterwards. The read-back makes a closed/unavailable
 * IndexedDB degrade to an empty recent list instead of claiming an in-memory
 * selection was persisted.
 */
export async function rememberRecentAssigneeLogin(
  actor: string | null,
  vault: string,
  login: string,
): Promise<string[]> {
  if (!actor || !vault || !login.trim()) return [];
  const current = await getRecentAssigneeLogins(actor, vault);
  const next = [login, ...current.filter((existing) => existing !== login)];
  const envelope: AssigneeRecentsEnvelope = {
    version: ASSIGNEE_RECENTS_VERSION,
    logins: next,
  };
  await setConfigValue(
    assigneeRecentsStorageKey(actor, vault),
    JSON.stringify(envelope),
  );
  return getRecentAssigneeLogins(actor, vault);
}

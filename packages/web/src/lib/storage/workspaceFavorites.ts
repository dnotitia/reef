import { VAULT_NAME_RE } from "@/lib/akb/vaultName";
import { clearConfigByPrefix, getConfigValue, setConfigValue } from "./config";

/** The versioned config key for browser-local workspace favorites. */
export const WORKSPACE_FAVORITES_STORAGE_KEY = "workspace_favorites";
export const WORKSPACE_FAVORITES_ENVELOPE_VERSION = 1 as const;

export interface WorkspaceFavoritesEnvelope {
  version: typeof WORKSPACE_FAVORITES_ENVELOPE_VERSION;
  favorites: string[];
}

/**
 * Compare workspace names without depending on the browser's locale. Vault
 * names are ASCII today, and the explicit original-name tie-break keeps the
 * result stable when case-insensitive names compare equally.
 */
export function compareWorkspaceNames(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isValidWorkspaceFavoriteName(value: unknown): value is string {
  return typeof value === "string" && VAULT_NAME_RE.test(value);
}

/** Normalize persisted names into a valid, unique, deterministic list. */
export function normalizeWorkspaceFavoriteNames(
  values: readonly unknown[],
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!isValidWorkspaceFavoriteName(value)) continue;
    const folded = value.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    names.push(value);
  }
  return names.toSorted(compareWorkspaceNames);
}

/** Keep only favorites that still belong to the accessible configured set. */
export function filterWorkspaceFavorites(
  favorites: readonly unknown[],
  availableNames: readonly string[],
): string[] {
  const available = new Map<string, string>();
  for (const name of normalizeWorkspaceFavoriteNames(availableNames)) {
    available.set(name.toLowerCase(), name);
  }

  return normalizeWorkspaceFavoriteNames(favorites)
    .map((favorite) => available.get(favorite.toLowerCase()))
    .filter((favorite): favorite is string => favorite !== undefined);
}

function isWorkspaceFavoritesEnvelope(
  value: unknown,
): value is WorkspaceFavoritesEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const envelope = value as Record<string, unknown>;
  return (
    envelope.version === WORKSPACE_FAVORITES_ENVELOPE_VERSION &&
    Array.isArray(envelope.favorites)
  );
}

function sameStringList(left: readonly unknown[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

let writeGeneration = 0;
let writeQueue: Promise<void> = Promise.resolve();
let cleanupPromise: Promise<void> = Promise.resolve();

function enqueueWorkspaceFavoritesWrite(
  envelope: WorkspaceFavoritesEnvelope,
): Promise<void> {
  const generation = writeGeneration;
  const operation = async () => {
    await cleanupPromise;
    if (generation !== writeGeneration) return;
    await setConfigValue(
      WORKSPACE_FAVORITES_STORAGE_KEY,
      JSON.stringify(envelope),
    );
  };
  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => undefined);
  return result;
}

/**
 * Read the versioned favorites envelope. Corrupt and unknown versions are
 * intentionally treated as an empty preference so workspace switching keeps
 * working even when browser storage is unavailable or stale.
 */
export async function getWorkspaceFavorites(): Promise<string[]> {
  const raw = await getConfigValue(WORKSPACE_FAVORITES_STORAGE_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isWorkspaceFavoritesEnvelope(parsed)) return [];

  const favorites = normalizeWorkspaceFavoriteNames(parsed.favorites);
  if (!sameStringList(parsed.favorites, favorites)) {
    // Repair invalid/duplicate entries when possible. A failed repair should
    // not turn a valid read into a broken workspace switcher.
    await setWorkspaceFavorites(favorites).catch(() => undefined);
  }
  return favorites;
}

/** Persist only the valid, unique, deterministic workspace-name payload. */
export async function setWorkspaceFavorites(
  favorites: readonly unknown[],
): Promise<void> {
  const envelope: WorkspaceFavoritesEnvelope = {
    version: WORKSPACE_FAVORITES_ENVELOPE_VERSION,
    favorites: normalizeWorkspaceFavoriteNames(favorites),
  };
  await enqueueWorkspaceFavoritesWrite(envelope);
}

/** Remove the account-scoped workspace favorites without touching device state. */
export async function clearWorkspaceFavorites(): Promise<void> {
  writeGeneration += 1;
  const pendingWrites = writeQueue;
  const cleanup = pendingWrites.then(() =>
    clearConfigByPrefix(WORKSPACE_FAVORITES_STORAGE_KEY),
  );
  cleanupPromise = cleanup.catch(() => undefined);
  await cleanup;
}

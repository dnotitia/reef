import { clearConfigByPrefix, getConfigValue, setConfigValue } from "./config";

/**
 * Last-scan storage for auto-issue detection.
 *
 * Each repo gets an independent timestamp keyed by `last_scan_at:{owner}/{repo}`
 * in the `config` KV bag. The detection trigger uses this both as the `since`
 * watermark and as the cooldown signal for the auto-on-mount run — if the most
 * recent scan is within {@link DETECTION_COOLDOWN_MS}, the mount handler skips.
 *
 * First-scan behavior: when no entry exists for a repo, `since` is omitted so
 * the GitHub query returns the most recent N commits + all open PRs. No
 * arbitrary lookback window — the detection is purely incremental.
 */

const KEY_PREFIX = "last_scan_at:";

/**
 * Cooldown for the auto-on-mount detection trigger.
 *
 * Set to 30 minutes — long enough that page revisits don't burn LLM tokens on
 * a feed the user just looked at, short enough that returning after a meeting
 * surfaces fresh activity. A manual refresh consistently bypasses the cooldown.
 */
export const DETECTION_COOLDOWN_MS = 30 * 60 * 1000;

function buildKey(repo: string): string {
  return `${KEY_PREFIX}${repo}`;
}

/**
 * Returns the ISO 8601 timestamp of the most recent successful scan for `repo`,
 * or `undefined` when no scan has ever run.
 *
 * Callers pass this straight through as `since` to the detection action.
 * Undefined → GraphQL omits the `since` filter and returns the most recent
 * history page (first scan / blank-slate behavior).
 */
export async function getLastScanAt(repo: string): Promise<string | undefined> {
  return getConfigValue(buildKey(repo));
}

/**
 * Persists the timestamp of a successful scan. Use the response time, not the
 * action start time, so we don't widen the next `since` window past activity
 * that actually arrived during the scan.
 */
export async function setLastScanAt(
  repo: string,
  isoTimestamp: string,
): Promise<void> {
  await setConfigValue(buildKey(repo), isoTimestamp);
}

/**
 * Deletes every per-repo scan watermark (`last_scan_at:*`). Account-scoped:
 * left behind after sign-out, the next user's first scan would reuse the
 * previous user's `since` watermark and skip older activity. Cleared by the
 * sign-out / account-switch wipe.
 */
export async function clearAllLastScans(): Promise<void> {
  return clearConfigByPrefix(KEY_PREFIX);
}

/**
 * Returns `true` when the auto-on-mount trigger should run for `repo`.
 *
 * Conditions: no scan recorded, OR last scan is older than
 * {@link DETECTION_COOLDOWN_MS}. Manual refresh callers should NOT consult this
 * — they consistently run.
 */
export async function shouldAutoScan(
  repo: string,
  now: Date = new Date(),
): Promise<boolean> {
  const raw = await getLastScanAt(repo);
  if (!raw) return true;
  const lastMs = Date.parse(raw);
  if (Number.isNaN(lastMs)) return true;
  return now.getTime() - lastMs >= DETECTION_COOLDOWN_MS;
}

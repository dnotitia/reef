import { VAULT_NAME_RE } from "./akb/vaultName";

/**
 * The fixed path prefix that promotes the active workspace (akb vault) to a
 * first-class URL segment: `/workspace/{vault}/...` (REEF-315).
 *
 * An explicit prefix — rather than a root-level `/{vault}/` — keeps the vault
 * segment from ever colliding with a top-level static route. akb vault names
 * pass `VAULT_NAME_RE` (`login`, `api`, `onboarding`, …) and reef does not
 * control the akb-issued name, so a bare `/{vault}/` could shadow `/login`.
 * The constant prefix makes that collision structurally impossible.
 */
export const WORKSPACE_PREFIX = "/workspace";

/**
 * Rewrites a dashboard-relative path (`/issues`, `/issues/REEF-1?view=list`,
 * `/settings/workspace`) into its vault-scoped form
 * (`/workspace/{vault}/issues...`). This is the single chokepoint every nav
 * href / `router.push` target flows through so the active vault stays in the
 * URL (REEF-315).
 *
 * `path` is the leading-slash dashboard path (a query string may ride along).
 * When `vault` is empty — a not-yet-resolved pointer, or a caller outside the
 * `[vault]` segment — the bare path is returned unchanged so it falls through
 * to the `(legacy)` redirect shim rather than producing `/workspace//issues`.
 */
export function withVault(vault: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!vault || !VAULT_NAME_RE.test(vault)) return normalized;
  return `${WORKSPACE_PREFIX}/${vault}${normalized}`;
}

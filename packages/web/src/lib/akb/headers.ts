/**
 * Canonical reef HTTP header names that move akb-scoped identifiers across
 * the browser↔server boundary. Single canonical source so client (`apiClient`)
 * and server (`extractVault`) does not drift on casing.
 *
 * HTTP header names are case-insensitive on the wire, but matching client
 * and server code to a single literal keeps logs, mock interceptors, and
 * grep audits consistent.
 */
export const VAULT_HEADER = "X-Reef-Vault";

/**
 * Server-owned signal that an established AKB session was rejected and every
 * account-scoped browser cache must be discarded. Status alone is insufficient:
 * an ordinary workspace permission 403 must keep the current session intact.
 */
export const AUTH_INVALIDATED_HEADER = "X-Reef-Auth-Invalidated";

/** Stable AKB account-denial code accompanying an invalidated session. */
export const AUTH_ACCOUNT_ERROR_HEADER = "X-Reef-Account-Error";

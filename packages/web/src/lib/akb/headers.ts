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

/**
 * akb vault name — lowercase alphanumerics + `-` + `_`, max 64 chars.
 * akb's backend enforces a similar pattern; this is a defense-in-depth
 * filter before we let a user-supplied value land in a URL path. Pure
 * constant so both server (requestHelpers) and client (storage) can import
 * without dragging Node deps into the browser bundle.
 */
export const VAULT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

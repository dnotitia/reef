import { AuthError } from "@reef/core";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";
import { VAULT_HEADER } from "./headers";
import { VAULT_NAME_RE } from "./vaultName";

/**
 * Extract the active vault name from the `X-Reef-Vault` request header.
 *
 * Why a header instead of `?vault=` querystring (as other routes use): the
 * chat route's URL and body are owned by the AI SDK's `useChat` transport
 * and `streamText`/`ToolLoopAgent`. A header is the just non-invasive slot.
 *
 * The vault name is a low-sensitivity identifier (similar to a tenant id) so
 * it is intentionally NOT subject to the redacting logger — it appears in
 * span attributes for traceability. Validation against {@link VAULT_NAME_RE}
 * is defense-in-depth before the value reaches the akb adapter URL builder.
 *
 * Mirrors `extractGithubToken` / `extractAkbSession` by throwing
 * `AuthError` so chat-route error translation collapses to a single 401
 * branch — vault selection is an authentication-adjacent concern: until a
 * vault is selected, the chat agent has nothing to bind its akb tools to.
 */
export function extractVault(source: Request | ReadonlyHeaders): string {
  const headers = source instanceof Request ? source.headers : source;
  const raw = headers.get(VAULT_HEADER);
  if (!raw) {
    throw new AuthError({ message: "missing_vault_header" });
  }
  if (!VAULT_NAME_RE.test(raw)) {
    throw new AuthError({ message: "malformed_vault_header" });
  }
  return raw;
}

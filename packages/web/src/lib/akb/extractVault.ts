import { AuthError } from "@reef/core";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";
import { VAULT_HEADER } from "./headers";
import { VAULT_NAME_RE } from "./vaultName";

/**
 * Extract the active vault name from the `X-Reef-Vault` request header.
 *
 * Why a header instead of `?vault=` querystring (as older routes used):
 * agent-run request bodies are task-owned, so a header is the least invasive
 * workspace slot.
 *
 * The vault name is a low-sensitivity identifier (similar to a tenant id) so
 * it is intentionally NOT subject to the redacting logger — it appears in
 * span attributes for traceability. Validation against {@link VAULT_NAME_RE}
 * is defense-in-depth before the value reaches the akb adapter URL builder.
 *
 * Mirrors `extractAkbSession` by throwing `AuthError` so agent-route error
 * translation collapses to a single 401 branch. Vault selection is an
 * authentication-adjacent concern: until a vault is selected, the chat agent
 * has nothing to bind its akb tools to.
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

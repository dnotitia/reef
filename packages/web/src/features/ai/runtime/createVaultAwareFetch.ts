import { VAULT_HEADER } from "@/lib/akb/headers";
import { apiFetch } from "@/lib/apiClient";
import type { AgentRunFetch } from "./types";

/** Pin an agent-run request to the workspace visible in the current tab. */
export function createVaultAwareFetch(
  vault: string | null | undefined,
): AgentRunFetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (vault) headers.set(VAULT_HEADER, vault);
    return apiFetch(input, { ...init, headers });
  };
}

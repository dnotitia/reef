import type { UseQueryResult } from "@tanstack/react-query";

/**
 * Hide a persisted query snapshot until React has matched the server render.
 * The server lacks browser-cache access, making a pending idle query without
 * data or error the deterministic initial state.
 */
export function holdQueryUntilHydrated<TData, TError>(
  result: UseQueryResult<TData, TError>,
  hydrated: boolean,
): UseQueryResult<TData, TError> {
  if (hydrated) return result;

  return {
    ...result,
    data: undefined,
    error: null,
    isPending: true,
    isLoading: false,
    isLoadingError: false,
    isRefetchError: false,
    isSuccess: false,
    isError: false,
    status: "pending",
    fetchStatus: "idle",
  } as UseQueryResult<TData, TError>;
}

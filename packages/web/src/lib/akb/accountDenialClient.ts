import { type AkbAccountErrorCode, isAkbAccountErrorCode } from "@reef/core";

const PENDING_ACCOUNT_ERROR_KEY = "reef:pending-akb-account-error";
const ACCOUNT_DENIED_EVENT = "reef:akb-account-denied";

/** Preserve a safe account-denial code until the next successful same-tab session. */
export function recordAkbAccountDenial(value: unknown): void {
  if (!isAkbAccountErrorCode(value) || typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(PENDING_ACCOUNT_ERROR_KEY, value);
  } catch {
    // The in-tab event still carries the denial when storage is unavailable.
  }

  try {
    window.dispatchEvent(
      new CustomEvent<AkbAccountErrorCode>(ACCOUNT_DENIED_EVENT, {
        detail: value,
      }),
    );
  } catch {
    // A later auth probe can still consume the sessionStorage marker.
  }
}

/** Read and remove the pending denial so it cannot leak into a later session. */
export function consumePendingAkbAccountError():
  | AkbAccountErrorCode
  | undefined {
  if (typeof window === "undefined") return undefined;

  let value: string | null = null;
  try {
    value = window.sessionStorage.getItem(PENDING_ACCOUNT_ERROR_KEY);
    window.sessionStorage.removeItem(PENDING_ACCOUNT_ERROR_KEY);
  } catch {
    return undefined;
  }
  return isAkbAccountErrorCode(value) ? value : undefined;
}

/** Read the same-tab denial without consuming it while concurrent guards settle. */
export function peekPendingAkbAccountError(): AkbAccountErrorCode | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const value = window.sessionStorage.getItem(PENDING_ACCOUNT_ERROR_KEY);
    return isAkbAccountErrorCode(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Notify the mounted auth gate when any protected request rejects the account. */
export function subscribeAkbAccountDenied(
  handler: (code: AkbAccountErrorCode) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    if (isAkbAccountErrorCode(event.detail)) handler(event.detail);
  };
  window.addEventListener(ACCOUNT_DENIED_EVENT, listener);
  return () => window.removeEventListener(ACCOUNT_DENIED_EVENT, listener);
}

import { type AkbAccountErrorCode, isAkbAccountErrorCode } from "@reef/core";

const PENDING_ACCOUNT_ERROR_KEY = "reef:pending-akb-account-error";
const INVALIDATED_ACCOUNT_ERROR_TOKENS_KEY =
  "reef:invalidated-akb-account-error-tokens";
const MAX_INVALIDATED_ACCOUNT_ERROR_TOKENS = 32;
const ACCOUNT_DENIED_EVENT = "reef:akb-account-denied";
const ACCOUNT_DENIAL_CLEARED_EVENT = "reef:akb-account-denial-cleared";
const invalidatedAccountErrorTokens = new Set<string>();
let volatilePendingAccountError: PendingAkbAccountErrorSnapshot | undefined;

export interface PendingAkbAccountErrorSnapshot {
  code: AkbAccountErrorCode;
  token: string;
}

function readPendingAkbAccountError():
  | PendingAkbAccountErrorSnapshot
  | undefined {
  if (typeof window === "undefined") return undefined;
  if (volatilePendingAccountError) return volatilePendingAccountError;

  try {
    const raw = window.sessionStorage.getItem(PENDING_ACCOUNT_ERROR_KEY);
    if (isAkbAccountErrorCode(raw))
      return { code: raw, token: `legacy:${raw}` };
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "code" in parsed &&
      "token" in parsed &&
      isAkbAccountErrorCode(parsed.code) &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0
    ) {
      return { code: parsed.code, token: parsed.token };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function hydrateInvalidatedAccountErrorTokens(): void {
  try {
    const raw = window.sessionStorage.getItem(
      INVALIDATED_ACCOUNT_ERROR_TOKENS_KEY,
    );
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const value of parsed) {
      if (typeof value === "string") invalidatedAccountErrorTokens.add(value);
    }
  } catch {
    // Keep any tokens already known in memory when storage is unavailable.
  }
}

function invalidateAccountErrorToken(token: string): void {
  hydrateInvalidatedAccountErrorTokens();
  invalidatedAccountErrorTokens.delete(token);
  invalidatedAccountErrorTokens.add(token);
  while (
    invalidatedAccountErrorTokens.size > MAX_INVALIDATED_ACCOUNT_ERROR_TOKENS
  ) {
    const oldest = invalidatedAccountErrorTokens.values().next().value;
    if (typeof oldest !== "string") break;
    invalidatedAccountErrorTokens.delete(oldest);
  }
  try {
    window.sessionStorage.setItem(
      INVALIDATED_ACCOUNT_ERROR_TOKENS_KEY,
      JSON.stringify([...invalidatedAccountErrorTokens]),
    );
  } catch {
    // The in-memory set still protects this tab while storage is unavailable.
  }
}

/** Preserve a safe account-denial code until the next successful same-tab session. */
export function recordAkbAccountDenial(value: unknown): void {
  if (!isAkbAccountErrorCode(value) || typeof window === "undefined") return;
  const previous = readPendingAkbAccountError();
  const snapshot = {
    code: value,
    token: window.crypto.randomUUID(),
  } satisfies PendingAkbAccountErrorSnapshot;

  try {
    window.sessionStorage.setItem(
      PENDING_ACCOUNT_ERROR_KEY,
      JSON.stringify(snapshot),
    );
    volatilePendingAccountError = undefined;
    if (previous) invalidateAccountErrorToken(previous.token);
  } catch {
    volatilePendingAccountError = snapshot;
    if (previous) {
      invalidateAccountErrorToken(previous.token);
      try {
        window.sessionStorage.removeItem(PENDING_ACCOUNT_ERROR_KEY);
      } catch {
        // The event snapshot remains authoritative for the current tab.
      }
    }
  }

  try {
    window.dispatchEvent(
      new CustomEvent<PendingAkbAccountErrorSnapshot>(ACCOUNT_DENIED_EVENT, {
        detail: snapshot,
      }),
    );
  } catch {
    // A later auth probe can still consume the sessionStorage marker.
  }
}

/** Read and remove the pending denial, preventing it from leaking into a later session. */
export function consumePendingAkbAccountError():
  | AkbAccountErrorCode
  | undefined {
  if (typeof window === "undefined") return undefined;

  const pending = readPendingAkbAccountError();
  try {
    window.sessionStorage.removeItem(PENDING_ACCOUNT_ERROR_KEY);
  } catch {
    if (volatilePendingAccountError?.token !== pending?.token) return undefined;
  }
  if (volatilePendingAccountError?.token === pending?.token) {
    volatilePendingAccountError = undefined;
  }
  if (pending) invalidateAccountErrorToken(pending.token);
  return pending?.code;
}

/** Read the same-tab denial without consuming it while concurrent guards settle. */
export function peekPendingAkbAccountError(): AkbAccountErrorCode | undefined {
  return readPendingAkbAccountError()?.code;
}

/** Capture the denial token visible when an async session probe begins. */
export function snapshotPendingAkbAccountError():
  | PendingAkbAccountErrorSnapshot
  | undefined {
  return readPendingAkbAccountError();
}

/** Whether a successful probe has explicitly invalidated this URL token. */
export function isAkbAccountDenialTokenCleared(token: string): boolean {
  if (typeof window === "undefined") return false;
  if (invalidatedAccountErrorTokens.has(token)) return true;
  hydrateInvalidatedAccountErrorTokens();
  return invalidatedAccountErrorTokens.has(token);
}

/** Clear the record observed by the successful session probe. */
export function consumePendingAkbAccountErrorIfUnchanged(
  snapshot: PendingAkbAccountErrorSnapshot | undefined,
): AkbAccountErrorCode | undefined {
  if (!snapshot || typeof window === "undefined") return undefined;
  const current = readPendingAkbAccountError();
  if (current?.code !== snapshot.code || current.token !== snapshot.token) {
    return undefined;
  }
  try {
    window.sessionStorage.removeItem(PENDING_ACCOUNT_ERROR_KEY);
  } catch {
    if (volatilePendingAccountError?.token !== current.token) return undefined;
  }
  if (volatilePendingAccountError?.token === current.token) {
    volatilePendingAccountError = undefined;
  }
  invalidateAccountErrorToken(current.token);
  try {
    window.dispatchEvent(
      new CustomEvent<PendingAkbAccountErrorSnapshot>(
        ACCOUNT_DENIAL_CLEARED_EVENT,
        { detail: current },
      ),
    );
  } catch {
    // A persisted tombstone still invalidates the token after navigation.
  }
  return current.code;
}

/**
 * Replace the probe-start record with an authoritative denial. If another
 * request recorded a denial while the probe was in flight, preserve that
 * newer record instead.
 */
export function recordAkbAccountDenialIfUnchanged(
  value: unknown,
  snapshot: PendingAkbAccountErrorSnapshot | undefined,
): PendingAkbAccountErrorSnapshot | undefined {
  if (!isAkbAccountErrorCode(value) || typeof window === "undefined") {
    return undefined;
  }

  const current = readPendingAkbAccountError();
  const unchanged =
    current === undefined ||
    (snapshot !== undefined &&
      current.code === snapshot.code &&
      current.token === snapshot.token);
  if (!unchanged) return current;

  if (snapshot) {
    try {
      window.sessionStorage.removeItem(PENDING_ACCOUNT_ERROR_KEY);
    } catch {
      if (volatilePendingAccountError?.token !== snapshot.token) {
        return undefined;
      }
    }
    if (volatilePendingAccountError?.token === snapshot.token) {
      volatilePendingAccountError = undefined;
    }
    invalidateAccountErrorToken(snapshot.token);
  }
  recordAkbAccountDenial(value);
  return readPendingAkbAccountError();
}

/** Notify the mounted auth gate when any protected request rejects the account. */
export function subscribeAkbAccountDenied(
  handler: (
    code: AkbAccountErrorCode,
    snapshot?: PendingAkbAccountErrorSnapshot,
  ) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (isAkbAccountErrorCode(detail)) {
      const pending = readPendingAkbAccountError();
      handler(detail, pending?.code === detail ? pending : undefined);
      return;
    }
    if (
      detail !== null &&
      typeof detail === "object" &&
      "code" in detail &&
      "token" in detail &&
      isAkbAccountErrorCode(detail.code) &&
      typeof detail.token === "string"
    ) {
      handler(detail.code, {
        code: detail.code,
        token: detail.token,
      });
    }
  };
  window.addEventListener(ACCOUNT_DENIED_EVENT, listener);
  return () => window.removeEventListener(ACCOUNT_DENIED_EVENT, listener);
}

/** Notify the login surface when a successful probe clears its denial token. */
export function subscribeAkbAccountDenialCleared(
  handler: (snapshot: PendingAkbAccountErrorSnapshot) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (
      detail !== null &&
      typeof detail === "object" &&
      "code" in detail &&
      "token" in detail &&
      isAkbAccountErrorCode(detail.code) &&
      typeof detail.token === "string"
    ) {
      handler({ code: detail.code, token: detail.token });
    }
  };
  window.addEventListener(ACCOUNT_DENIAL_CLEARED_EVENT, listener);
  return () =>
    window.removeEventListener(ACCOUNT_DENIAL_CLEARED_EVENT, listener);
}

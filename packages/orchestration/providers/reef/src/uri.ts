import { ISSUE_ID_PATTERN, VAULT_NAME_PATTERN } from "@reef/core";

export interface ReefWorkUri {
  readonly uri: string;
  readonly vault: string;
  readonly issueId: string;
}

export class ReefWorkUriError extends Error {
  constructor() {
    super("invalid_reef_work_uri");
    this.name = "ReefWorkUriError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const URI_PATTERN = /^reef:\/\/([^/?#]+)\/([^/?#]+)$/u;

/** Parse a strict, already-canonical Reef work URI. */
export function parseReefWorkUri(
  value: string,
  configuredVault?: string,
): ReefWorkUri {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new ReefWorkUriError();
  }

  // Vault names and Reef ids use only URI-safe ASCII characters. Rejecting all
  // percent escapes keeps encoded spellings from creating a second identity.
  if (value.includes("%")) {
    throw new ReefWorkUriError();
  }

  const match = URI_PATTERN.exec(value);
  if (!match) {
    throw new ReefWorkUriError();
  }

  const [, vault, issueId] = match;
  if (!vault || !issueId || vault.includes("@") || vault.includes(":")) {
    throw new ReefWorkUriError();
  }
  if (!VAULT_NAME_PATTERN.test(vault) || !ISSUE_ID_PATTERN.test(issueId)) {
    throw new ReefWorkUriError();
  }
  if (
    configuredVault !== undefined &&
    (!VAULT_NAME_PATTERN.test(configuredVault) || configuredVault !== vault)
  ) {
    throw new ReefWorkUriError();
  }

  return { uri: value, vault, issueId };
}

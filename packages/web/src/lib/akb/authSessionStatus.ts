import type { AkbAccountErrorCode } from "@reef/core";

/** Result of the browser's cookie-backed AKB session probe. */
export type AkbSessionStatus =
  | { active: true }
  | {
      active: false;
      accountError?: AkbAccountErrorCode;
      accountErrorToken?: string;
    };

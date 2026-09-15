import type { AkbAccountErrorCode } from "@reef/core";

/** Result of the browser's cookie-backed AKB session probe. */
export type AkbSessionStatus =
  | { state: "active" }
  | {
      state: "inactive";
      accountError?: AkbAccountErrorCode;
      accountErrorToken?: string;
    }
  | { state: "unavailable" };

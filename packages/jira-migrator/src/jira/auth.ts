import { Buffer } from "node:buffer";

export type JiraAuthSecret =
  | {
      mode: "basic";
      email: string;
      apiToken: string;
    }
  | {
      mode: "bearer";
      token: string;
    };

export function jiraAuthHeader(auth: JiraAuthSecret): string {
  if (auth.mode === "bearer") return `Bearer ${auth.token}`;
  return `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`).toString(
    "base64",
  )}`;
}

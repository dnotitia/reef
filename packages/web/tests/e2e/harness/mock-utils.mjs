import { createHash } from "node:crypto";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function makeJwt(payload) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  return [
    base64url(JSON.stringify({ alg: "none", typ: "JWT" })),
    base64url(JSON.stringify({ exp, ...payload })),
    "e2e",
  ].join(".");
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function uuidFor(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

export function issuePathFor(id) {
  return `issues/${slugify(id)}.md`;
}

export function issueDocumentUri(vault, id) {
  return docUri(vault, issuePathFor(id));
}

export function docUri(vault, path) {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) return `akb://${vault}/doc/${path}`;
  return `akb://${vault}/coll/${path.slice(0, lastSlash)}/doc/${path.slice(
    lastSlash + 1,
  )}`;
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/[-\s]+/g, "-")
    .slice(0, 80);
}

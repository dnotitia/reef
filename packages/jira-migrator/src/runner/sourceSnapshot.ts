import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalizeJson } from "../archive/canonicalJson.js";
import { fingerprintJiraState } from "../execution/diff.js";
import {
  JIRA_MAX_ATTACHMENT_BUFFER_BYTES,
  type JiraReadClient,
} from "../jira/client.js";
import { ensurePrivateDirectory } from "./artifacts.js";
import { JiraRunnerError } from "./errors.js";
import { retryOperation } from "./retry.js";

export interface RelatedSourceSnapshot {
  comments: Record<string, unknown>;
  remote_links: Record<string, unknown>;
  attachments: Record<
    string,
    {
      sha256: string;
      content_type: string | null;
      content_length: number | null;
    }
  >;
}

export interface RelatedBinarySpool {
  path: string;
  contentType: string | null;
  contentLength: number | null;
  rateLimit: Awaited<
    ReturnType<JiraReadClient["downloadAttachmentContent"]>
  >["rateLimit"];
}

const binarySpools = new WeakMap<
  RelatedSourceSnapshot,
  Map<string, RelatedBinarySpool>
>();

export const getRelatedBinarySpools = (
  snapshot: RelatedSourceSnapshot,
): ReadonlyMap<string, RelatedBinarySpool> =>
  binarySpools.get(snapshot) ?? new Map();

export const assertCachedAttachmentWithinLimit = (
  byteLength: number,
  maxBytes: number,
): void => {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > JIRA_MAX_ATTACHMENT_BUFFER_BYTES
  ) {
    throw new Error("jira_attachment_size_limit_invalid");
  }
  if (byteLength > maxBytes) {
    throw new Error("jira_attachment_size_limit_exceeded");
  }
};

export const snapshotJiraClient = (
  client: JiraReadClient,
  snapshot: RelatedSourceSnapshot,
  spoolRoot: string,
  retry: Parameters<typeof retryOperation>[1],
): JiraReadClient => {
  const binaries = new Map<string, RelatedBinarySpool>();
  const comments = new Map<
    string,
    Awaited<ReturnType<JiraReadClient["readComments"]>>
  >();
  const remoteLinks = new Map<
    string,
    Awaited<ReturnType<JiraReadClient["listRemoteLinks"]>>
  >();
  binarySpools.set(snapshot, binaries);
  return new Proxy(client, {
    get(target, property) {
      if (property === "readComments") {
        return async (
          issueKey: string,
          options?: Parameters<JiraReadClient["readComments"]>[1],
        ) => {
          const cacheKey = canonicalizeJson({
            issue_key: issueKey,
            options: options ?? {},
          });
          const cached = comments.get(cacheKey);
          if (cached) return cached;
          const result = await retryOperation(
            () => target.readComments(issueKey, options),
            { ...retry, operationKind: "read" },
          );
          const previous =
            (snapshot.comments[issueKey] as
              | { items?: unknown[]; pages?: unknown[] }
              | undefined) ?? {};
          const rawFallback =
            "raw" in result && result.raw !== undefined ? [result.raw] : [];
          snapshot.comments[issueKey] = {
            items: [...(previous.items ?? []), ...result.items],
            pages: [
              ...(previous.pages ?? []),
              ...(result.pages ?? rawFallback),
            ],
          };
          comments.set(cacheKey, result);
          return result;
        };
      }
      if (property === "listRemoteLinks") {
        return async (issueKey: string) => {
          const cached = remoteLinks.get(issueKey);
          if (cached) return cached;
          const result = await retryOperation(
            () => target.listRemoteLinks(issueKey),
            { ...retry, operationKind: "read" },
          );
          snapshot.remote_links[issueKey] = {
            items: result.items,
            raw: result.raw,
          };
          remoteLinks.set(issueKey, result);
          return result;
        };
      }
      if (property === "downloadAttachmentContent") {
        return async (attachmentId: string | number, maxBytes: number) => {
          const cacheKey = String(attachmentId);
          const cached = binaries.get(cacheKey);
          if (cached) {
            const bytes = new Uint8Array(await readFile(cached.path));
            assertCachedAttachmentWithinLimit(bytes.byteLength, maxBytes);
            return {
              bytes,
              contentType: cached.contentType,
              contentLength: cached.contentLength,
              rateLimit: cached.rateLimit,
            };
          }
          const result = await retryOperation(
            () => target.downloadAttachmentContent(attachmentId, maxBytes),
            { ...retry, operationKind: "read" },
          );
          const digest = createHash("sha256")
            .update(result.bytes)
            .digest("hex");
          const observed = {
            sha256: digest,
            content_type: result.contentType,
            content_length: result.contentLength,
          };
          const current = snapshot.attachments[cacheKey];
          if (
            current &&
            fingerprintJiraState(current) !== fingerprintJiraState(observed)
          ) {
            throw new JiraRunnerError("plan_fingerprint_mismatch");
          }
          snapshot.attachments[cacheKey] = observed;
          await ensurePrivateDirectory(spoolRoot);
          const spoolPath = join(
            spoolRoot,
            `${createHash("sha256").update(cacheKey).digest("hex")}.bin`,
          );
          try {
            await writeFile(spoolPath, result.bytes, {
              flag: "wx",
              mode: 0o600,
            });
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "EEXIST"
            ) {
              throw error;
            }
            const existing = await readFile(spoolPath);
            if (
              createHash("sha256").update(existing).digest("hex") !== digest
            ) {
              throw new JiraRunnerError("plan_fingerprint_mismatch");
            }
          }
          binaries.set(cacheKey, {
            path: spoolPath,
            contentType: result.contentType,
            contentLength: result.contentLength,
            rateLimit: result.rateLimit,
          });
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

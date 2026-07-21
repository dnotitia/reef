import { type JiraAuthSecret, jiraAuthHeader } from "./config.js";
import {
  type JiraChangelogHistoryPayload,
  JiraChangelogPageSchema,
  JiraCommentPageSchema,
  type JiraCommentPayload,
  JiraFieldCatalogSchema,
  type JiraFieldPayload,
  JiraIssueSchema,
  JiraRemoteLinkListSchema,
  type JiraRemoteLinkPayload,
  JiraSearchResponseSchema,
  JiraSprintPageSchema,
  JiraVersionPageSchema,
  type NormalizedJiraAttachment,
  type NormalizedJiraIssue,
  type NormalizedJiraIssueLink,
  type NormalizedJiraSprint,
  type NormalizedJiraVersion,
  normalizeJiraAttachment,
  normalizeJiraIssue,
  normalizeJiraIssueLink,
  normalizeJiraSprint,
  normalizeJiraVersion,
} from "./payloads.js";
import { trimTrailingSlashes } from "./url.js";

export interface JiraRateLimit {
  limit: number | null;
  remaining: number | null;
  reset: string | null;
  nearLimit: boolean;
  retryAfterSeconds: number | null;
}

export type JiraPageCursor =
  | {
      kind: "nextPageToken";
      value: string;
    }
  | {
      kind: "startAt";
      value: number;
    };

export interface JiraPage<T> {
  items: T[];
  cursor: JiraPageCursor | null;
  isLast: boolean;
  rateLimit: JiraRateLimit;
  raw: unknown;
}

export interface JiraIssueResult {
  issue: NormalizedJiraIssue;
  rateLimit: JiraRateLimit;
  raw: unknown;
}

export interface JiraIssueCollectionResult<T> {
  items: T[];
  rateLimit: JiraRateLimit;
  raw: unknown;
}

export interface JiraBinaryResult {
  bytes: Uint8Array;
  contentType: string | null;
  contentLength: number | null;
  rateLimit: JiraRateLimit;
}

export interface JiraCatalogResult<T> {
  items: T[];
  pages: unknown[];
  rateLimits: JiraRateLimit[];
}

export interface JiraClientOptions {
  baseUrl: string;
  projectKey: string;
  auth: JiraAuthSecret;
  fetch?: typeof fetch;
}

export interface SearchProjectIssuesOptions {
  projectKey?: string;
  jql?: string;
  nextPageToken?: string;
  maxResults?: number;
  fields?: readonly string[];
  expand?: readonly string[];
}

export interface GetIssueOptions {
  fields?: readonly string[];
  expand?: readonly string[];
}

export interface OffsetPageOptions {
  startAt?: number;
  maxResults?: number;
}

export interface ListProjectVersionsOptions extends OffsetPageOptions {
  projectIdOrKey?: string;
}

export interface ListBoardSprintsOptions extends OffsetPageOptions {
  states?: readonly ("future" | "active" | "closed")[];
}

interface JiraRequestErrorContext {
  status: number;
  statusText: string;
  method: "GET";
  path: string;
  retryable: boolean;
  rateLimit: JiraRateLimit;
}

export class JiraApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly method: "GET";
  readonly path: string;
  readonly retryable: boolean;
  readonly rateLimit: JiraRateLimit;

  constructor(context: JiraRequestErrorContext) {
    super("jira_api_request_failed");
    this.name = "JiraApiError";
    this.status = context.status;
    this.statusText = context.statusText;
    this.method = context.method;
    this.path = context.path;
    this.retryable = context.retryable;
    this.rateLimit = context.rateLimit;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      method: this.method,
      path: this.path,
      retryable: this.retryable,
      rateLimit: this.rateLimit,
    };
  }
}

const jiraTransportError = (
  path: string,
  rateLimit: JiraRateLimit = readJiraRateLimit(new Headers()),
): JiraApiError =>
  new JiraApiError({
    status: 0,
    statusText: "Transport Error",
    method: "GET",
    path,
    retryable: true,
    rateLimit,
  });

const readIntegerHeader = (headers: Headers, name: string): number | null => {
  const raw = headers.get(name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export const readJiraRateLimit = (headers: Headers): JiraRateLimit => {
  const nearLimit = headers.get("x-ratelimit-nearlimit");
  return {
    limit: readIntegerHeader(headers, "x-ratelimit-limit"),
    remaining: readIntegerHeader(headers, "x-ratelimit-remaining"),
    reset: headers.get("x-ratelimit-reset"),
    nearLimit: nearLimit?.toLowerCase() === "true",
    retryAfterSeconds: readIntegerHeader(headers, "retry-after"),
  };
};

const retryableStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
export const JIRA_MAX_ATTACHMENT_BUFFER_BYTES = 256 * 1024 * 1024;

interface ResizableArrayBuffer extends ArrayBuffer {
  resize(newByteLength: number): void;
}

const ResizableArrayBufferConstructor = ArrayBuffer as typeof ArrayBuffer & {
  new (
    byteLength: number,
    options: { maxByteLength: number },
  ): ResizableArrayBuffer;
};

export const isRetryableJiraStatus = (status: number): boolean =>
  retryableStatuses.has(status);

const appendQueryParam = (
  searchParams: URLSearchParams,
  key: string,
  value: string | number | boolean | readonly string[] | null | undefined,
): void => {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      searchParams.append(key, item);
    }
    return;
  }
  searchParams.set(key, String(value));
};

const issuePath = (issueIdOrKey: string, suffix = ""): string =>
  `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}${suffix}`;

const nextOffsetCursor = (
  startAt: number,
  maxResults: number,
  total: number | undefined,
  isLast?: boolean,
): JiraPageCursor | null => {
  if (isLast === true) return null;
  const nextStartAt = startAt + maxResults;
  if (typeof total === "number" && nextStartAt >= total) return null;
  return { kind: "startAt", value: nextStartAt };
};

export class JiraReadClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly projectKey: string;
  private readonly auth: JiraAuthSecret;

  constructor(options: JiraClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = trimTrailingSlashes(options.baseUrl);
    this.projectKey = options.projectKey;
    this.auth = options.auth;
  }

  async searchProjectIssues(
    options: SearchProjectIssuesOptions = {},
  ): Promise<JiraPage<NormalizedJiraIssue>> {
    const projectKey = options.projectKey ?? this.projectKey;
    const body = await this.getJson("/rest/api/3/search/jql", {
      jql: options.jql ?? `project = ${projectKey} ORDER BY key ASC`,
      nextPageToken: options.nextPageToken,
      maxResults: options.maxResults ?? 50,
      fields: options.fields ?? [
        "summary",
        "status",
        "issuetype",
        "project",
        "assignee",
        "reporter",
        "created",
        "updated",
      ],
      expand: options.expand,
    });
    const payload = JiraSearchResponseSchema.parse(body.json);
    const cursor = payload.nextPageToken
      ? { kind: "nextPageToken" as const, value: payload.nextPageToken }
      : null;

    return {
      items: payload.issues.map(normalizeJiraIssue),
      cursor,
      isLast: payload.isLast ?? cursor === null,
      rateLimit: body.rateLimit,
      raw: body.json,
    };
  }

  async getIssue(
    issueIdOrKey: string,
    options: GetIssueOptions = {},
  ): Promise<JiraIssueResult> {
    const body = await this.getJson(issuePath(issueIdOrKey), {
      fields: options.fields,
      expand: options.expand,
    });
    const payload = JiraIssueSchema.parse(body.json);
    return {
      issue: normalizeJiraIssue(payload),
      rateLimit: body.rateLimit,
      raw: body.json,
    };
  }

  async listComments(
    issueIdOrKey: string,
    options: OffsetPageOptions = {},
  ): Promise<JiraPage<JiraCommentPayload>> {
    const body = await this.getJson(issuePath(issueIdOrKey, "/comment"), {
      startAt: options.startAt ?? 0,
      maxResults: options.maxResults ?? 50,
      expand: "properties,renderedBody",
    });
    const payload = JiraCommentPageSchema.parse(body.json);
    return {
      items: payload.comments,
      cursor: nextOffsetCursor(
        payload.startAt,
        payload.maxResults,
        payload.total,
      ),
      isLast:
        nextOffsetCursor(payload.startAt, payload.maxResults, payload.total) ===
        null,
      rateLimit: body.rateLimit,
      raw: body.json,
    };
  }

  async readComments(
    issueIdOrKey: string,
    options: Omit<OffsetPageOptions, "startAt"> = {},
  ): Promise<JiraCatalogResult<JiraCommentPayload>> {
    return this.readOffsetCatalog((startAt) =>
      this.listComments(issueIdOrKey, { ...options, startAt }),
    );
  }

  async downloadAttachmentContent(
    attachmentId: string | number,
    maxBytes: number,
  ): Promise<JiraBinaryResult> {
    return this.getBinary(
      `/rest/api/3/attachment/content/${encodeURIComponent(String(attachmentId))}`,
      maxBytes,
      { redirect: false },
    );
  }

  async listRemoteLinks(
    issueIdOrKey: string,
  ): Promise<JiraIssueCollectionResult<JiraRemoteLinkPayload>> {
    const body = await this.getJson(issuePath(issueIdOrKey, "/remotelink"));
    return {
      items: JiraRemoteLinkListSchema.parse(body.json),
      rateLimit: body.rateLimit,
      raw: body.json,
    };
  }

  async listChangelog(
    issueIdOrKey: string,
    options: OffsetPageOptions = {},
  ): Promise<JiraPage<JiraChangelogHistoryPayload>> {
    const body = await this.getJson(issuePath(issueIdOrKey, "/changelog"), {
      startAt: options.startAt ?? 0,
      maxResults: options.maxResults ?? 50,
    });
    const payload = JiraChangelogPageSchema.parse(body.json);
    const cursor = nextOffsetCursor(
      payload.startAt,
      payload.maxResults,
      payload.total,
      payload.isLast,
    );
    return {
      items: payload.values,
      cursor,
      isLast: cursor === null,
      rateLimit: body.rateLimit,
      raw: body.json,
    };
  }

  async listAttachments(
    issueIdOrKey: string,
  ): Promise<JiraIssueCollectionResult<NormalizedJiraAttachment>> {
    const detail = await this.getIssue(issueIdOrKey, {
      fields: ["attachment"],
    });
    return {
      items:
        detail.issue.raw.fields.attachment?.map(normalizeJiraAttachment) ?? [],
      rateLimit: detail.rateLimit,
      raw: detail.raw,
    };
  }

  async listIssueLinks(
    issueIdOrKey: string,
  ): Promise<JiraIssueCollectionResult<NormalizedJiraIssueLink>> {
    const detail = await this.getIssue(issueIdOrKey, {
      fields: ["issuelinks"],
    });
    return {
      items:
        detail.issue.raw.fields.issuelinks
          ?.map(normalizeJiraIssueLink)
          .filter((link): link is NormalizedJiraIssueLink => link !== null) ??
        [],
      rateLimit: detail.rateLimit,
      raw: detail.raw,
    };
  }

  async listFields(): Promise<JiraIssueCollectionResult<JiraFieldPayload>> {
    const body = await this.getJson("/rest/api/3/field");
    const payload = JiraFieldCatalogSchema.parse(body.json);
    return {
      items: payload,
      rateLimit: body.rateLimit,
      raw: body.json,
    };
  }

  async listProjectVersions(
    options: ListProjectVersionsOptions = {},
  ): Promise<JiraPage<NormalizedJiraVersion>> {
    const projectIdOrKey = options.projectIdOrKey ?? this.projectKey;
    const body = await this.getJson(
      `/rest/api/3/project/${encodeURIComponent(projectIdOrKey)}/version`,
      {
        startAt: options.startAt ?? 0,
        maxResults: options.maxResults ?? 50,
      },
    );
    const payload = JiraVersionPageSchema.parse(body.json);
    const cursor = nextOffsetCursor(
      payload.startAt,
      payload.maxResults,
      payload.total,
      payload.isLast,
    );
    return {
      items: payload.values.map(normalizeJiraVersion),
      cursor,
      isLast: cursor === null,
      rateLimit: body.rateLimit,
      raw: body.json,
    };
  }

  async readProjectVersionCatalog(
    options: Omit<ListProjectVersionsOptions, "startAt"> = {},
  ): Promise<JiraCatalogResult<NormalizedJiraVersion>> {
    return this.readOffsetCatalog((startAt) =>
      this.listProjectVersions({ ...options, startAt }),
    );
  }

  async listBoardSprints(
    boardId: string | number,
    options: ListBoardSprintsOptions = {},
  ): Promise<JiraPage<NormalizedJiraSprint>> {
    const body = await this.getJson(
      `/rest/agile/1.0/board/${encodeURIComponent(String(boardId))}/sprint`,
      {
        startAt: options.startAt ?? 0,
        maxResults: options.maxResults ?? 50,
        state: options.states?.join(","),
      },
    );
    const payload = JiraSprintPageSchema.parse(body.json);
    const cursor = nextOffsetCursor(
      payload.startAt,
      payload.maxResults,
      payload.total,
      payload.isLast,
    );
    return {
      items: payload.values.map(normalizeJiraSprint),
      cursor,
      isLast: cursor === null,
      rateLimit: body.rateLimit,
      raw: body.json,
    };
  }

  async readBoardSprintCatalog(
    boardId: string | number,
    options: Omit<ListBoardSprintsOptions, "startAt"> = {},
  ): Promise<JiraCatalogResult<NormalizedJiraSprint>> {
    return this.readOffsetCatalog((startAt) =>
      this.listBoardSprints(boardId, { ...options, startAt }),
    );
  }

  private async readOffsetCatalog<T>(
    readPage: (startAt: number) => Promise<JiraPage<T>>,
  ): Promise<JiraCatalogResult<T>> {
    const items: T[] = [];
    const pages: unknown[] = [];
    const rateLimits: JiraRateLimit[] = [];
    let startAt = 0;

    while (true) {
      const page = await readPage(startAt);
      items.push(...page.items);
      pages.push(page.raw);
      rateLimits.push(page.rateLimit);
      if (!page.cursor) break;
      if (page.cursor.kind !== "startAt" || page.cursor.value <= startAt) {
        throw new Error("jira_catalog_pagination_did_not_advance");
      }
      startAt = page.cursor.value;
    }

    return { items, pages, rateLimits };
  }

  private buildUrl(
    path: string,
    query: Record<
      string,
      string | number | boolean | readonly string[] | null | undefined
    >,
  ): URL {
    const base = new URL(this.baseUrl);
    const basePath = trimTrailingSlashes(base.pathname);
    base.pathname = `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
    base.search = "";
    for (const [key, value] of Object.entries(query)) {
      appendQueryParam(base.searchParams, key, value);
    }
    return base;
  }

  private async getJson(
    path: string,
    query: Record<
      string,
      string | number | boolean | readonly string[] | null | undefined
    > = {},
  ): Promise<{ json: unknown; rateLimit: JiraRateLimit }> {
    const url = this.buildUrl(path, query);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: jiraAuthHeader(this.auth),
      },
    });
    const rateLimit = readJiraRateLimit(response.headers);

    if (!response.ok) {
      throw new JiraApiError({
        status: response.status,
        statusText: response.statusText,
        method: "GET",
        path,
        retryable: isRetryableJiraStatus(response.status),
        rateLimit,
      });
    }

    return {
      json: await response.json(),
      rateLimit,
    };
  }

  private async getBinary(
    path: string,
    maxBytes: number,
    query: Record<string, string | number | boolean | null | undefined> = {},
  ): Promise<JiraBinaryResult> {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      maxBytes > JIRA_MAX_ATTACHMENT_BUFFER_BYTES
    )
      throw new Error("jira_attachment_size_limit_invalid");
    const url = this.buildUrl(path, query);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "*/*",
          Authorization: jiraAuthHeader(this.auth),
        },
        redirect: "error",
      });
    } catch {
      throw jiraTransportError(path);
    }
    const rateLimit = readJiraRateLimit(response.headers);
    if (!response.ok) {
      await response.body?.cancel();
      throw new JiraApiError({
        status: response.status,
        statusText: response.statusText,
        method: "GET",
        path,
        retryable: isRetryableJiraStatus(response.status),
        rateLimit,
      });
    }
    const rawLength = response.headers.get("content-length");
    const contentLength = rawLength === null ? null : Number(rawLength);
    const declaredContentLength =
      contentLength !== null &&
      Number.isSafeInteger(contentLength) &&
      contentLength >= 0
        ? contentLength
        : null;
    const contentEncoding = response.headers
      .get("content-encoding")
      ?.trim()
      .toLowerCase();
    if (
      declaredContentLength !== null &&
      (!contentEncoding || contentEncoding === "identity") &&
      declaredContentLength > maxBytes
    ) {
      await response.body?.cancel();
      throw new Error("jira_attachment_size_limit_exceeded");
    }
    const reader = response.body?.getReader();
    const buffer = new ResizableArrayBufferConstructor(0, {
      maxByteLength: maxBytes,
    });
    let byteLength = 0;
    if (reader) {
      try {
        while (true) {
          const result = await reader
            .read()
            .catch(() => Promise.reject(jiraTransportError(path, rateLimit)));
          const { done, value } = result;
          if (done) break;
          const nextByteLength = byteLength + value.byteLength;
          if (nextByteLength > maxBytes) {
            await reader.cancel();
            throw new Error("jira_attachment_size_limit_exceeded");
          }
          buffer.resize(nextByteLength);
          new Uint8Array(buffer, byteLength, value.byteLength).set(value);
          byteLength = nextByteLength;
        }
      } finally {
        reader.releaseLock();
      }
    }
    if (
      declaredContentLength !== null &&
      (!contentEncoding || contentEncoding === "identity") &&
      byteLength !== declaredContentLength
    )
      throw new Error("jira_attachment_content_length_mismatch");
    return {
      bytes: new Uint8Array(buffer, 0, byteLength),
      contentType: response.headers.get("content-type"),
      contentLength: declaredContentLength,
      rateLimit,
    };
  }
}

import { type JiraAuthSecret, jiraAuthHeader } from "./config.js";
import {
  type JiraChangelogItemPayload,
  JiraChangelogPageSchema,
  JiraCommentPageSchema,
  type JiraCommentPayload,
  JiraIssueSchema,
  JiraSearchResponseSchema,
  type NormalizedJiraAttachment,
  type NormalizedJiraIssue,
  type NormalizedJiraIssueLink,
  normalizeJiraAttachment,
  normalizeJiraIssue,
  normalizeJiraIssueLink,
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
      raw: payload,
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
      raw: payload,
    };
  }

  async listComments(
    issueIdOrKey: string,
    options: OffsetPageOptions = {},
  ): Promise<JiraPage<JiraCommentPayload>> {
    const body = await this.getJson(issuePath(issueIdOrKey, "/comment"), {
      startAt: options.startAt ?? 0,
      maxResults: options.maxResults ?? 50,
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
      raw: payload,
    };
  }

  async listChangelog(
    issueIdOrKey: string,
    options: OffsetPageOptions = {},
  ): Promise<JiraPage<JiraChangelogItemPayload>> {
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
      raw: payload,
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
}

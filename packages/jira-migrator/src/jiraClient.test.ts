import { describe, expect, it, vi } from "vitest";
import {
  jiraChangelogPageFixture,
  jiraCommentPageFixture,
  jiraIssueFixture,
  jiraSearchFixture,
} from "./fixtures.js";
import { JiraApiError, JiraReadClient } from "./jiraClient.js";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "100",
      "x-ratelimit-remaining": "42",
      ...init.headers,
    },
    status: init.status ?? 200,
    statusText: init.statusText,
  });

const makeClient = (fetchImpl: typeof fetch) =>
  new JiraReadClient({
    baseUrl: "https://example.atlassian.net",
    projectKey: "SHDEV",
    auth: {
      mode: "basic",
      email: "operator@example.com",
      apiToken: "jira-secret-token",
    },
    fetch: fetchImpl,
  });

describe("JiraReadClient", () => {
  it("searches project issues read-only through enhanced JQL pagination", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(jiraSearchFixture, {
        headers: {
          "x-ratelimit-reset": "2026-07-09T07:00:00Z",
        },
      }),
    );
    const client = makeClient(fetchImpl);

    const page = await client.searchProjectIssues({
      nextPageToken: "cursor-1",
      maxResults: 25,
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toContain("/rest/api/3/search/jql");
    expect(String(url)).toContain("jql=project+%3D+SHDEV+ORDER+BY+key+ASC");
    expect(String(url)).toContain("nextPageToken=cursor-1");
    expect(init?.method).toBe("GET");
    expect(page.items[0]?.key).toBe("SHDEV-1");
    expect(page.cursor).toEqual({ kind: "nextPageToken", value: "next-token" });
    expect(page.rateLimit).toMatchObject({
      limit: 100,
      remaining: 42,
      reset: "2026-07-09T07:00:00Z",
    });
  });

  it("reads detail, comments, attachments, links, and changelog with GET requests", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(jiraIssueFixture))
      .mockResolvedValueOnce(jsonResponse(jiraCommentPageFixture))
      .mockResolvedValueOnce(jsonResponse(jiraIssueFixture))
      .mockResolvedValueOnce(jsonResponse(jiraIssueFixture))
      .mockResolvedValueOnce(jsonResponse(jiraChangelogPageFixture));
    const client = makeClient(fetchImpl);

    await expect(client.getIssue("SHDEV-1")).resolves.toMatchObject({
      issue: { key: "SHDEV-1" },
    });
    await expect(
      client.listComments("SHDEV-1", { maxResults: 1 }),
    ).resolves.toMatchObject({
      cursor: { kind: "startAt", value: 1 },
      items: [{ id: "50001" }],
    });
    await expect(client.listAttachments("SHDEV-1")).resolves.toMatchObject({
      items: [{ filename: "brief.pdf" }],
    });
    await expect(client.listIssueLinks("SHDEV-1")).resolves.toMatchObject({
      items: [{ issueKey: "SHDEV-2" }],
    });
    await expect(
      client.listChangelog("SHDEV-1", { maxResults: 1 }),
    ).resolves.toMatchObject({
      cursor: { kind: "startAt", value: 1 },
      items: [{ id: "60001" }],
    });

    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
    ]);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/rest/api/3/issue/SHDEV-1"),
        expect.stringContaining("/rest/api/3/issue/SHDEV-1/comment"),
        expect.stringContaining("/rest/api/3/issue/SHDEV-1/changelog"),
      ]),
    );
  });

  it("classifies rate limits and transient API failures as retryable without leaking secrets", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { errorMessages: ["token jira-secret-token should never surface"] },
        {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "retry-after": "30",
            "x-ratelimit-remaining": "0",
          },
        },
      ),
    );
    const client = makeClient(fetchImpl);

    await expect(client.searchProjectIssues()).rejects.toBeInstanceOf(
      JiraApiError,
    );

    try {
      await client.searchProjectIssues();
    } catch (error) {
      expect(error).toMatchObject({
        status: 429,
        retryable: true,
        rateLimit: {
          remaining: 0,
          retryAfterSeconds: 30,
        },
      });
      expect(JSON.stringify(error)).not.toContain("jira-secret-token");
      expect(String(error)).not.toContain("jira-secret-token");
    }
  });

  it("preserves API gateway base paths when a cloud-id URL is used", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...jiraSearchFixture,
        nextPageToken: undefined,
        isLast: true,
      }),
    );
    const client = new JiraReadClient({
      baseUrl: "https://api.atlassian.com/ex/jira/cloud-abc",
      projectKey: "SHDEV",
      auth: { mode: "bearer", token: "bearer-secret" },
      fetch: fetchImpl,
    });

    await client.searchProjectIssues();

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "/ex/jira/cloud-abc/rest/api/3/search/jql",
    );
  });
});

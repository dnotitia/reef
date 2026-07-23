import { describe, expect, it, vi } from "vitest";
import { JiraApiError, JiraReadClient } from "./client.js";
import {
  jiraChangelogPageFixture,
  jiraCommentPageFixture,
  jiraFieldCatalogFixture,
  jiraIssueFixture,
  jiraSearchFixture,
  jiraSprintPageFixture,
  jiraVersionPageFixture,
} from "./fixtures.js";

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
    projectKey: "ALPHA",
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
    expect(String(url)).toContain("jql=project+%3D+ALPHA+ORDER+BY+key+ASC");
    expect(String(url)).toContain("nextPageToken=cursor-1");
    expect(String(url)).toContain("fields=assignee");
    expect(String(url)).toContain("fields=reporter");
    expect(init?.method).toBe("GET");
    expect(page.items[0]?.key).toBe("ALPHA-1");
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

    await expect(client.getIssue("ALPHA-1")).resolves.toMatchObject({
      issue: { key: "ALPHA-1" },
    });
    await expect(
      client.listComments("ALPHA-1", { maxResults: 1 }),
    ).resolves.toMatchObject({
      cursor: { kind: "startAt", value: 1 },
      items: [{ id: "50001" }],
    });
    await expect(client.listAttachments("ALPHA-1")).resolves.toMatchObject({
      items: [{ filename: "brief.pdf" }],
    });
    await expect(client.listIssueLinks("ALPHA-1")).resolves.toMatchObject({
      items: [{ issueKey: "ALPHA-2" }],
    });
    await expect(
      client.listChangelog("ALPHA-1", { maxResults: 1 }),
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
        expect.stringContaining("/rest/api/3/issue/ALPHA-1"),
        expect.stringContaining("/rest/api/3/issue/ALPHA-1/comment"),
        expect.stringContaining("/rest/api/3/issue/ALPHA-1/changelog"),
      ]),
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("expand=properties");
  });

  it("reads every comment page before returning the catalog", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(jiraCommentPageFixture))
      .mockResolvedValueOnce(
        jsonResponse({
          ...jiraCommentPageFixture,
          startAt: 1,
          comments: [
            {
              ...jiraCommentPageFixture.comments[0],
              id: "50002",
              author: {
                ...jiraCommentPageFixture.comments[0].author,
                accountId: "acct-later-commenter",
              },
            },
          ],
        }),
      );
    const client = makeClient(fetchImpl);

    const catalog = await client.readComments("ALPHA-1", { maxResults: 1 });

    expect(catalog.items.map((comment) => comment.id)).toEqual([
      "50001",
      "50002",
    ]);
    expect(catalog.pages).toHaveLength(2);
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "GET",
    ]);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("startAt=1");
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
      baseUrl: "https://api.atlassian.com/ex/jira/cloud-abc///",
      projectKey: "ALPHA",
      auth: { mode: "bearer", token: "bearer-secret" },
      fetch: fetchImpl,
    });

    await client.searchProjectIssues();

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "/ex/jira/cloud-abc/rest/api/3/search/jql",
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain(
      "cloud-abc///rest",
    );
  });

  it("reads remote links and downloads attachment bytes only from the configured origin without redirects", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 1,
            globalId: "remote-1",
            object: { url: "https://example.com/reference", title: "Ref" },
          },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "3",
          },
        }),
      );
    const client = makeClient(fetchImpl);

    await expect(client.listRemoteLinks("ALPHA-1")).resolves.toMatchObject({
      items: [{ globalId: "remote-1" }],
    });
    await expect(
      client.downloadAttachmentContent("42", 1024),
    ).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      contentLength: 3,
    });

    const [remoteUrl] = fetchImpl.mock.calls[0] ?? [];
    const [downloadUrl, downloadInit] = fetchImpl.mock.calls[1] ?? [];
    expect(String(remoteUrl)).toContain("/issue/ALPHA-1/remotelink");
    expect(String(downloadUrl)).toBe(
      "https://example.atlassian.net/rest/api/3/attachment/content/42?redirect=false",
    );
    expect(downloadInit).toMatchObject({ method: "GET", redirect: "error" });
  });

  it("stops reading attachment bodies that exceed the configured limit", async () => {
    const client = makeClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
    );

    await expect(client.downloadAttachmentContent("42", 3)).rejects.toThrow(
      "jira_attachment_size_limit_exceeded",
    );
  });

  it("rejects impractical attachment buffer limits before fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = makeClient(fetchImpl);
    await expect(
      client.downloadAttachmentContent("42", 256 * 1024 * 1024 + 1),
    ).rejects.toThrow("jira_attachment_size_limit_invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("marks attachment transport failures as retryable", async () => {
    const fetchFailure = makeClient(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network failed")),
    );
    await expect(
      fetchFailure.downloadAttachmentContent("42", 3),
    ).rejects.toMatchObject({ retryable: true });

    const interrupted = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("stream interrupted"));
      },
    });
    const streamFailure = makeClient(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(interrupted)),
    );
    await expect(
      streamFailure.downloadAttachmentContent("42", 3),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("rejects attachment bodies shorter than the declared content length", async () => {
    const client = makeClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-length": "4" },
        }),
      ),
    );

    await expect(client.downloadAttachmentContent("42", 1024)).rejects.toThrow(
      "jira_attachment_content_length_mismatch",
    );
  });

  it("does not compare decoded bytes with a compressed wire length", async () => {
    const client = makeClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-encoding": "gzip",
            "content-length": "4",
          },
        }),
      ),
    );

    await expect(
      client.downloadAttachmentContent("42", 3),
    ).resolves.toMatchObject({ bytes: new Uint8Array([1, 2, 3]) });
  });

  it("cancels unsuccessful attachment response bodies", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const client = makeClient(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(body, { status: 403, statusText: "Forbidden" }),
        ),
    );

    await expect(client.downloadAttachmentContent("42", 1024)).rejects.toThrow(
      "jira_api_request_failed",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns the pre-validation JSON value without schema coercion or stripping", async () => {
    const rawFixture = {
      ...jiraIssueFixture,
      id: 10001,
      unknownRawOnlyField: { preserved: true },
      fields: {
        ...jiraIssueFixture.fields,
        unknownCustomField: ["second", "first"],
      },
    };
    const client = makeClient(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(rawFixture)),
    );

    const result = await client.getIssue("ALPHA-1");

    expect(result.issue.id).toBe("10001");
    expect(result.raw).toEqual(rawFixture);
    expect(result.raw).toMatchObject({
      id: 10001,
      unknownRawOnlyField: { preserved: true },
      fields: { unknownCustomField: ["second", "first"] },
    });
  });

  it("reads every project Version page and preserves GET/rate-limit behavior", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(jiraVersionPageFixture))
      .mockResolvedValueOnce(
        jsonResponse({
          ...jiraVersionPageFixture,
          startAt: 1,
          isLast: true,
          values: [
            {
              ...jiraVersionPageFixture.values[0],
              id: "70002",
              name: "2.0",
            },
          ],
        }),
      );
    const client = makeClient(fetchImpl);

    const catalog = await client.readProjectVersionCatalog({ maxResults: 1 });

    expect(catalog.items.map((version) => version.id)).toEqual([
      "70001",
      "70002",
    ]);
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "GET",
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "/rest/api/3/project/ALPHA/version",
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("startAt=1");
    expect(catalog.rateLimits).toHaveLength(2);
  });

  it("reads configured board Sprint pages and the Jira field catalog", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(jiraSprintPageFixture))
      .mockResolvedValueOnce(
        jsonResponse({
          ...jiraSprintPageFixture,
          startAt: 1,
          isLast: true,
          values: [
            {
              ...jiraSprintPageFixture.values[0],
              id: 80002,
              name: "Migration Sprint 2",
              state: "future",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(jiraFieldCatalogFixture));
    const client = makeClient(fetchImpl);

    const catalog = await client.readBoardSprintCatalog("90001", {
      maxResults: 1,
      states: ["future", "active", "closed"],
    });
    const fields = await client.listFields();

    expect(catalog.items.map((sprint) => sprint.id)).toEqual([
      "80001",
      "80002",
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "/rest/agile/1.0/board/90001/sprint",
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "state=future%2Cactive%2Cclosed",
    );
    expect(fields.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Sprint" })]),
    );
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "GET",
      "GET",
    ]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { type CoreLogger, setCoreLogger } from "../../observability";
import { listRecentActivity } from "./activity";

/** Local mirror of activity.ts's private GraphqlClient shape for casting fakes. */
type GraphqlClient = <T>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

/**
 * REEF-271 — the scan's GitHub GraphQL call must surface the rate-limit budget
 * so a throttled scan is diagnosable rather than a silent stall. The `rateLimit`
 * connection rides on the query root; near exhaustion it emits a dev warn line.
 */

type LogLine = { level: string; fields: Record<string, unknown>; msg: string };

function captureCoreLogger(): { lines: LogLine[] } {
  const lines: LogLine[] = [];
  const at =
    (level: string) => (fields: Record<string, unknown>, msg: string) => {
      lines.push({ level, fields, msg });
    };
  const logger: CoreLogger = {
    info: at("info"),
    warn: at("warn"),
    debug: at("debug"),
  };
  setCoreLogger(logger);
  return { lines };
}

function makeGraphqlClient(remaining: number): GraphqlClient {
  return (async (query: string) => {
    if (query.includes("RecentCommits")) {
      return {
        rateLimit: {
          remaining,
          resetAt: "2026-06-23T07:00:00Z",
          cost: 1,
          limit: 5000,
        },
        repository: {
          defaultBranchRef: { target: { history: { nodes: [] } } },
        },
      };
    }
    return { repository: { pullRequests: { nodes: [] } } };
  }) as unknown as GraphqlClient;
}

describe("listRecentActivity rate-limit visibility (REEF-271)", () => {
  afterEach(() => {
    setCoreLogger(null);
  });

  it("warns once when the GraphQL budget nears exhaustion", async () => {
    const { lines } = captureCoreLogger();

    await listRecentActivity({
      graphqlClient: makeGraphqlClient(100),
      owner: "acme",
      repo: "platform",
    });

    const warns = lines.filter((l) => l.msg === "github rate limit low");
    expect(warns).toHaveLength(1);
    expect(warns[0].level).toBe("warn");
    expect(warns[0].fields).toMatchObject({
      repo: "acme/platform",
      github_ratelimit_remaining: 100,
      github_ratelimit_reset: "2026-06-23T07:00:00Z",
    });
  });

  it("stays quiet when the budget is healthy", async () => {
    const { lines } = captureCoreLogger();

    await listRecentActivity({
      graphqlClient: makeGraphqlClient(4000),
      owner: "acme",
      repo: "platform",
    });

    expect(lines.filter((l) => l.msg === "github rate limit low")).toHaveLength(
      0,
    );
  });

  it("is a no-op when GitHub omits rateLimit (hermetic/mocked client)", async () => {
    const { lines } = captureCoreLogger();
    const graphqlClient = (async (query: string) => {
      if (query.includes("RecentCommits")) {
        return {
          repository: {
            defaultBranchRef: { target: { history: { nodes: [] } } },
          },
        };
      }
      return { repository: { pullRequests: { nodes: [] } } };
    }) as unknown as GraphqlClient;

    await expect(
      listRecentActivity({ graphqlClient, owner: "acme", repo: "platform" }),
    ).resolves.toEqual({ commits: [], pullRequests: [] });
    expect(lines).toHaveLength(0);
  });
});

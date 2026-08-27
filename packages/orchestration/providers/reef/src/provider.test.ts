import { randomUUID } from "node:crypto";
import { type AkbAdapter, REEF_DESIRED_TABLES } from "@reef/core";
import { ProviderError } from "@reef/orchestrator";
import { describe, expect, it } from "vitest";
import {
  ReefWorkUriError,
  createReefWorkProvider,
  parseReefWorkUri,
} from "./index.js";

const VAULT = "reef-test";
const TARGET_ID = "REEF-001";
const URI = `reef://${VAULT}/${TARGET_ID}`;
const ACTOR = "alice";
const INITIAL_TIME = "2026-01-01T00:00:00.000Z";
const DEPENDENCY_ID = "REEF-002";

type FixtureRequestInit = Parameters<AkbAdapter["request"]>[1];

interface FixtureIssue {
  readonly id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  assignedTo: string | null;
  dependsOn: string[];
  implementationRefs: Array<Record<string, unknown>> | null;
  updatedAt: string;
}

interface FixtureActivity {
  readonly id: string;
  readonly reef_id: string;
  readonly event_type: string;
  readonly event_key: string;
  readonly payload: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
}

interface FixtureComment {
  readonly id: string;
  readonly reef_id: string;
  readonly body: string;
  readonly meta: Record<string, unknown>;
}

function sqlLiterals(sql: string): string[] {
  return [...sql.matchAll(/'((?:''|[^'])*)'/gu)].map((match) =>
    match[1].replaceAll("''", "'"),
  );
}

function renderFixtureSqlParams(
  sql: string,
  params: readonly unknown[] | undefined,
): string {
  if (!params) return sql;
  return sql.replace(/\$(\d+)/gu, (placeholder, indexText) => {
    const value = params[Number(indexText) - 1];
    if (value === undefined || value === null) {
      return value === null ? "NULL" : placeholder;
    }
    if (typeof value === "string") {
      return `'${value.replaceAll("'", "''")}'`;
    }
    return String(value);
  });
}

class ScriptedAkbFixture {
  readonly activities: FixtureActivity[] = [];
  readonly comments: FixtureComment[] = [];
  readonly calls: string[] = [];
  readonly issues = new Map<string, FixtureIssue>();
  readonly adapter: AkbAdapter = {
    request: (path, init) => this.request(path, init),
  };
  onRequest?: (path: string) => void;
  failureMessage: string | null = null;
  private updateSequence = 0;

  constructor() {
    this.issues.set(DEPENDENCY_ID, {
      id: DEPENDENCY_ID,
      title: "Provider-neutral orchestrator",
      status: "done",
      assignedTo: ACTOR,
      dependsOn: [],
      implementationRefs: null,
      updatedAt: INITIAL_TIME,
    });
    this.issues.set(TARGET_ID, {
      id: TARGET_ID,
      title: "Reef Work Provider",
      status: "todo",
      assignedTo: ACTOR,
      dependsOn: [DEPENDENCY_ID],
      implementationRefs: null,
      updatedAt: INITIAL_TIME,
    });
  }

  setStatus(id: string, status: FixtureIssue["status"]): void {
    const issue = this.requireIssue(id);
    issue.status = status;
    issue.updatedAt = this.nextUpdatedAt();
  }

  setAssignedTo(id: string, assignedTo: string | null): void {
    const issue = this.requireIssue(id);
    issue.assignedTo = assignedTo;
    issue.updatedAt = this.nextUpdatedAt();
  }

  removeIssue(id: string): void {
    this.issues.delete(id);
  }

  resetTarget(): void {
    const target = this.requireIssue(TARGET_ID);
    target.status = "todo";
    target.assignedTo = ACTOR;
    target.dependsOn = [DEPENDENCY_ID];
    target.implementationRefs = null;
    target.updatedAt = INITIAL_TIME;
    this.activities.length = 0;
    this.comments.length = 0;
    this.calls.length = 0;
    this.failureMessage = null;
  }

  private requireIssue(id: string): FixtureIssue {
    const issue = this.issues.get(id);
    if (!issue) throw new Error(`missing fixture issue ${id}`);
    return issue;
  }

  private nextUpdatedAt(): string {
    this.updateSequence += 1;
    return `2026-01-01T00:00:00.${String(this.updateSequence).padStart(3, "0")}Z`;
  }

  private row(issue: FixtureIssue): Record<string, unknown> {
    return {
      id: randomUUID(),
      document_uri: `akb://${VAULT}/coll/issues/doc/${issue.id.toLowerCase()}.md`,
      reef_id: issue.id,
      title: issue.title,
      status: issue.status,
      issue_type: "task",
      priority: "medium",
      assigned_to: issue.assignedTo,
      requester: ACTOR,
      reporter: null,
      start_date: null,
      due_date: null,
      milestone_id: null,
      sprint_id: null,
      release_id: null,
      estimate_points: null,
      severity: null,
      rank: null,
      closed_at: null,
      closed_reason: null,
      parent_id: null,
      labels: JSON.stringify(["test"]),
      depends_on: JSON.stringify(issue.dependsOn),
      related_to: JSON.stringify([]),
      blocks: JSON.stringify([]),
      archived_at: null,
      meta: JSON.stringify({
        author: ACTOR,
        last_editor: ACTOR,
        source: "fixture",
        last_status_change: null,
        external_refs: null,
        implementation_refs: issue.implementationRefs,
        watchers: null,
        reviewers: null,
        qa_owner: null,
        custom_fields: null,
      }),
      created_at: INITIAL_TIME,
      updated_at: issue.updatedAt,
    };
  }

  private document(issue: FixtureIssue): Record<string, unknown> {
    return {
      uri: `akb://${VAULT}/coll/issues/doc/${issue.id.toLowerCase()}.md`,
      vault: VAULT,
      path: `issues/${issue.id.toLowerCase()}.md`,
      title: issue.id,
      type: "task",
      status: "active",
      summary: issue.title,
      domain: null,
      created_by: ACTOR,
      created_at: INITIAL_TIME,
      updated_at: issue.updatedAt,
      current_commit: `commit-${issue.id}`,
      tags: ["test"],
      content: `# ${issue.title}`,
    };
  }

  private async request(
    path: string,
    init?: FixtureRequestInit,
  ): Promise<unknown> {
    this.calls.push(`${init?.method ?? "GET"} ${path}`);
    this.onRequest?.(path);
    if (this.failureMessage !== null) throw new Error(this.failureMessage);

    const documentMatch = path.match(/\/issues\/([a-z0-9_-]+)\.md$/u);
    if (documentMatch && (init?.method ?? "GET") === "GET") {
      const issue = this.issues.get(documentMatch[1].toUpperCase());
      if (!issue) throw new Error("fixture document not found");
      return this.document(issue);
    }

    if (path === "/api/v1/auth/me") {
      return { username: ACTOR };
    }

    if (path === `/api/v1/tables/${VAULT}`) {
      return {
        items: REEF_DESIRED_TABLES.map((table) => ({ name: table.name })),
      };
    }

    if (path === `/api/v1/tables/${VAULT}/sql`) {
      const body = init?.body as
        | { sql?: unknown; params?: readonly unknown[] }
        | undefined;
      const sql = renderFixtureSqlParams(String(body?.sql ?? ""), body?.params);
      return this.handleSql(sql);
    }

    if (path === `/api/v1/vaults/${VAULT}/members`) {
      return {
        members: [
          {
            username: ACTOR,
            display_name: ACTOR,
            email: null,
            role: "member",
            since: INITIAL_TIME,
          },
        ],
      };
    }

    throw new Error(`unexpected fixture request ${path}`);
  }

  private handleSql(sql: string): Record<string, unknown> {
    const normalized = sql.trim();
    if (/^SELECT[\s\S]*FROM reef_issues\b/u.test(normalized)) {
      const id = normalized.match(/reef_id = '([^']+)'/u)?.[1];
      const issue = id === undefined ? undefined : this.issues.get(id);
      return {
        kind: "table_query",
        columns: [],
        items: issue === undefined ? [] : [this.row(issue)],
        total: issue === undefined ? 0 : 1,
      };
    }

    if (normalized.includes("UPDATE reef_issues")) {
      return this.handleIssueUpdate(normalized);
    }

    if (normalized.includes("INSERT INTO reef_activity")) {
      const values = sqlLiterals(
        normalized.slice(normalized.indexOf("SELECT")),
      );
      const [reefId, eventType, eventKey, payload, meta] = values;
      if (!reefId || !eventType || !eventKey || !payload || !meta) {
        throw new Error("fixture activity insert parse failed");
      }
      if (
        !this.activities.some(
          (activity) =>
            activity.reef_id === reefId && activity.event_key === eventKey,
        )
      ) {
        this.activities.push({
          id: randomUUID(),
          reef_id: reefId,
          event_type: eventType,
          event_key: eventKey,
          payload: JSON.parse(payload) as Record<string, unknown>,
          meta: JSON.parse(meta) as Record<string, unknown>,
        });
        return {
          kind: "table_query",
          columns: ["id"],
          items: [{ id: this.activities.at(-1)?.id }],
          total: 1,
        };
      }
      return { kind: "table_query", columns: ["id"], items: [], total: 0 };
    }

    if (normalized.includes("INSERT INTO reef_comments")) {
      const values = sqlLiterals(
        normalized.slice(normalized.indexOf("INSERT INTO reef_comments")),
      );
      const [reefId, body, meta] = values;
      if (!reefId || !body || !meta)
        throw new Error("fixture comment parse failed");
      const comment = {
        id: randomUUID(),
        reef_id: reefId,
        body,
        meta: JSON.parse(meta) as Record<string, unknown>,
      } satisfies FixtureComment;
      this.comments.push(comment);
      return {
        kind: "table_query",
        columns: ["id", "reef_id", "body", "meta"],
        items: [comment],
        total: 1,
      };
    }

    if (normalized.includes("INSERT INTO reef_subscriptions")) {
      const values = sqlLiterals(
        normalized.slice(normalized.indexOf("VALUES")),
      );
      const [
        subscriptionKey,
        reefId,
        subscriber,
        source,
        status,
        subscribedAt,
      ] = values;
      if (
        !subscriptionKey ||
        !reefId ||
        !subscriber ||
        !source ||
        !status ||
        !subscribedAt
      ) {
        throw new Error("fixture subscription parse failed");
      }
      const subscription = {
        id: randomUUID(),
        subscription_key: subscriptionKey,
        reef_id: reefId,
        subscriber,
        source,
        status,
        subscribed_at: subscribedAt,
        meta: null,
      };
      return {
        kind: "table_query",
        columns: Object.keys(subscription),
        items: [subscription],
        total: 1,
      };
    }

    return { kind: "table_sql", result: "OK" };
  }

  private handleIssueUpdate(sql: string): Record<string, unknown> {
    const id = sql.match(/WHERE reef_id = '([^']+)'/u)?.[1];
    if (!id) throw new Error("fixture issue update id parse failed");
    const issue = this.issues.get(id);
    if (!issue) throw new Error("fixture issue not found");

    const expectedUpdatedAt = sql.match(/updated_at = '([^']+)'/u)?.[1];
    if (
      expectedUpdatedAt !== undefined &&
      expectedUpdatedAt !== issue.updatedAt
    ) {
      return { kind: "table_query", columns: ["reef_id"], items: [], total: 0 };
    }

    const status = sql.match(/"status" = '([^']+)'/u)?.[1];
    if (status) issue.status = status as FixtureIssue["status"];
    const metaLiteral = sql.match(/"meta" = '((?:''|[^'])*)'::json/u)?.[1];
    if (metaLiteral) {
      const meta = JSON.parse(metaLiteral.replaceAll("''", "'")) as {
        implementation_refs?: Array<Record<string, unknown>> | null;
      };
      issue.implementationRefs = meta.implementation_refs ?? null;
    }
    issue.updatedAt = this.nextUpdatedAt();
    if (normalizedHasReturning(sql)) {
      return {
        kind: "table_query",
        columns: ["reef_id"],
        items: [{ reef_id: id }],
        total: 1,
      };
    }
    return { kind: "table_sql", result: "OK" };
  }
}

function normalizedHasReturning(sql: string): boolean {
  return (
    sql.includes("RETURNING reef_id") || sql.includes("SELECT reef_id FROM upd")
  );
}

function makeProvider(
  fixture: ScriptedAkbFixture,
  clock = () => new Date("2026-02-01T00:00:00.000Z"),
) {
  return createReefWorkProvider({
    adapter: fixture.adapter,
    jwt: "test-auth-context",
    vault: VAULT,
    repository: "dnotitia/reef",
    clock,
  });
}

describe("Reef work provider", () => {
  it("parses only strict canonical work URIs and guards the configured vault", async () => {
    expect(parseReefWorkUri(URI, VAULT)).toEqual({
      uri: URI,
      vault: VAULT,
      issueId: TARGET_ID,
    });

    const invalidUris = [
      `REEF://${VAULT}/${TARGET_ID}`,
      `reef:///${TARGET_ID}`,
      "reef://reef-test",
      "reef://reef-test/",
      `reef://${VAULT}/${TARGET_ID}/extra`,
      `reef://user@${VAULT}/${TARGET_ID}`,
      `reef://${VAULT}:443/${TARGET_ID}`,
      `reef://${VAULT}/${TARGET_ID.toLowerCase()}`,
      `reef://${VAULT}/${TARGET_ID}?query=1`,
      `reef://${VAULT}/${TARGET_ID}#fragment`,
      `reef://reef%2Dtest/${TARGET_ID}`,
    ];
    for (const invalidUri of invalidUris) {
      expect(() => parseReefWorkUri(invalidUri, VAULT)).toThrow(
        ReefWorkUriError,
      );
    }
    expect(() => parseReefWorkUri(URI, "other-vault")).toThrow(
      ReefWorkUriError,
    );

    const fixture = new ScriptedAkbFixture();
    await expect(
      makeProvider(fixture).read({ uri: `${URI}?query=1` }, {}),
    ).rejects.toMatchObject({ code: "request", retryable: false });
    expect(fixture.calls).toEqual([]);
  });

  it("returns deterministic secret-free revisions and detects dependency drift", async () => {
    const fixture = new ScriptedAkbFixture();
    const provider = makeProvider(fixture);
    const first = await provider.read({ uri: URI }, {});
    const second = await provider.refresh({ uri: URI }, {});
    expect(second).toEqual(first);
    expect(first.provenance.source).toBe("akb");
    expect(JSON.stringify(first)).not.toContain("test-auth-context");

    fixture.setStatus(DEPENDENCY_ID, "in_review");
    const drifted = await provider.refresh(
      { uri: URI, revision: first.revision },
      {},
    );
    expect(drifted.revision).not.toBe(first.revision);
  });

  it("uses the core lifecycle funnel for todo to in_review transitions", async () => {
    const fixture = new ScriptedAkbFixture();
    const provider = makeProvider(fixture);
    const before = await provider.read({ uri: URI }, {});
    const inProgress = await provider.transition(
      { uri: URI, transition: "in_progress" },
      {},
    );
    expect(fixture.issues.get(TARGET_ID)?.status).toBe("in_progress");
    expect(fixture.activities).toHaveLength(1);
    expect(fixture.activities[0]).toMatchObject({
      event_type: "status_change",
      payload: { from: "todo", to: "in_progress" },
      meta: { actor: ACTOR, source: "orchestrator:reef-work-provider" },
    });
    expect(inProgress.revision).not.toBe(before.revision);

    await provider.transition({ uri: URI, transition: "in_review" }, {});
    expect(fixture.issues.get(TARGET_ID)?.status).toBe("in_review");
    expect(fixture.activities).toHaveLength(2);
    expect(fixture.activities[1]).toMatchObject({
      event_type: "status_change",
      payload: { from: "in_progress", to: "in_review" },
    });
  });

  it("rejects ineligible transitions before any row, comment, or activity mutation", async () => {
    const cases: Array<{
      setup: (fixture: ScriptedAkbFixture) => void;
      transition: string;
    }> = [
      {
        setup: (fixture) => fixture.setAssignedTo(TARGET_ID, null),
        transition: "in_progress",
      },
      {
        setup: (fixture) => fixture.setAssignedTo(TARGET_ID, "bob"),
        transition: "in_progress",
      },
      {
        setup: (fixture) => fixture.setStatus(DEPENDENCY_ID, "in_progress"),
        transition: "in_progress",
      },
      {
        setup: (fixture) => fixture.setStatus(TARGET_ID, "in_progress"),
        transition: "in_progress",
      },
      { setup: () => undefined, transition: "in_review" },
      { setup: () => undefined, transition: "done" },
    ];

    for (const { setup, transition } of cases) {
      const fixture = new ScriptedAkbFixture();
      setup(fixture);
      const provider = makeProvider(fixture);
      await expect(
        provider.transition({ uri: URI, transition }, {}),
      ).rejects.toMatchObject({
        code: "request",
        retryable: false,
      });
      expect(fixture.activities).toHaveLength(0);
      expect(fixture.comments).toHaveLength(0);
      expect(
        fixture.calls.some((call) => call.includes("UPDATE reef_issues")),
      ).toBe(false);
    }

    const missingDependency = new ScriptedAkbFixture();
    missingDependency.removeIssue(DEPENDENCY_ID);
    await expect(
      makeProvider(missingDependency).transition(
        { uri: URI, transition: "in_progress" },
        {},
      ),
    ).rejects.toMatchObject({ code: "protocol", retryable: true });
    expect(missingDependency.activities).toHaveLength(0);
  });

  it("guards reports by revision and records PM-safe outcome comments", async () => {
    const fixture = new ScriptedAkbFixture();
    const provider = makeProvider(fixture);
    const snapshot = await provider.read({ uri: URI }, {});

    await provider.report(
      {
        uri: URI,
        revision: snapshot.revision,
        outcome: "succeeded",
        summary: "Implementation is ready for review.",
      },
      {},
    );
    expect(fixture.comments).toHaveLength(1);
    expect(fixture.comments[0]).toMatchObject({
      reef_id: TARGET_ID,
      body: "succeeded: Implementation is ready for review.",
    });

    await expect(
      provider.report(
        {
          uri: URI,
          revision: "stale-revision",
          outcome: "failed",
          summary: "This must not be written.",
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "request", retryable: false });
    await expect(
      provider.report(
        {
          uri: URI,
          revision: snapshot.revision,
          outcome: "pending",
          summary: "   ",
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "request", retryable: false });
    expect(fixture.comments).toHaveLength(1);
  });

  it("maps supported artifacts, preserves refs, and de-duplicates by type/repo/ref", async () => {
    const fixture = new ScriptedAkbFixture();
    const provider = makeProvider(fixture);
    const branch = {
      kind: "branch" as const,
      ref: "feat/provider",
      uri: "https://github.com/dnotitia/reef/tree/feat/provider",
      title: "Provider branch",
    };
    await provider.linkArtifact({ uri: URI, artifact: branch }, {});
    const activityCount = fixture.activities.length;
    await provider.linkArtifact({ uri: URI, artifact: branch }, {});
    expect(fixture.activities).toHaveLength(activityCount);

    await provider.linkArtifact(
      {
        uri: URI,
        artifact: { kind: "commit", ref: "abc123" },
      },
      {},
    );
    await provider.linkArtifact(
      {
        uri: URI,
        artifact: { kind: "pull_request", ref: "42", title: "Draft PR" },
      },
      {},
    );
    expect(fixture.issues.get(TARGET_ID)?.implementationRefs).toEqual([
      {
        type: "branch",
        repo: "dnotitia/reef",
        ref: "feat/provider",
        url: "https://github.com/dnotitia/reef/tree/feat/provider",
        title: "Provider branch",
      },
      { type: "commit", repo: "dnotitia/reef", ref: "abc123" },
      {
        type: "pull_request",
        repo: "dnotitia/reef",
        ref: "42",
        title: "Draft PR",
      },
    ]);
    expect(
      fixture.activities.filter(
        (event) => event.event_type === "impl_ref_linked",
      ),
    ).toHaveLength(3);

    await expect(
      provider.linkArtifact(
        { uri: URI, artifact: { kind: "proof", ref: "proof-1" } },
        {},
      ),
    ).rejects.toMatchObject({ code: "request", retryable: false });
    expect(
      fixture.activities.filter(
        (event) => event.event_type === "impl_ref_linked",
      ),
    ).toHaveLength(3);
  });

  it("normalizes aborts and raw AKB failures without exposing secrets", async () => {
    const abortedFixture = new ScriptedAkbFixture();
    const controller = new AbortController();
    abortedFixture.onRequest = (path) => {
      if (path === "/api/v1/auth/me") controller.abort();
    };
    await expect(
      makeProvider(abortedFixture).read(
        { uri: URI },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "cancelled", retryable: false });
    expect(abortedFixture.activities).toHaveLength(0);

    const upstreamMarker = "raw-upstream-error-marker";
    const failedFixture = new ScriptedAkbFixture();
    failedFixture.failureMessage = upstreamMarker;
    await expect(
      makeProvider(failedFixture).read({ uri: URI }, {}),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ProviderError);
      expect(JSON.stringify(error)).not.toContain(upstreamMarker);
      return true;
    });
  });
});

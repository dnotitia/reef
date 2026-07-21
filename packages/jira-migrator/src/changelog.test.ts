import { describe, expect, it } from "vitest";
import {
  type BuildJiraChangelogPlanInput,
  buildJiraChangelogPlan,
  jiraChangelogActivityEventKey,
} from "./changelog.js";
import { buildJiraFieldCatalog } from "./fieldCatalog.js";
import { JiraChangelogHistorySchema } from "./payloads.js";
import { sha256CanonicalJson } from "./rawArchive.js";

const AT = "2026-07-10T01:00:00.000Z";
const SHA = "a".repeat(64);

const history = (items: readonly Record<string, unknown>[], id = "h-1") =>
  JiraChangelogHistorySchema.parse({
    id,
    created: AT,
    author: { accountId: "actor-1", displayName: "Private Person" },
    items,
  });

const fieldCatalog = buildJiraFieldCatalog({
  retrievedAt: AT,
  fields: [
    {
      id: "customfield_10015",
      name: "Start date",
      custom: true,
      schema: {
        type: "date",
        custom: "com.atlassian.jira.plugin.system.customfieldtypes:datepicker",
      },
    },
    {
      id: "customfield_10019",
      name: "Rank",
      custom: true,
      schema: {
        type: "string",
        custom: "com.pyxis.greenhopper.jira:gh-lexo-rank",
      },
    },
  ],
});

const baseInput = (
  items: readonly Record<string, unknown>[],
  id = "h-1",
): BuildJiraChangelogPlanInput => {
  const parsed = history(items, id);
  return {
    jiraCloudId: "cloud-1",
    issueId: "10001",
    reefId: "REEF-001",
    history: parsed,
    rawArchiveReference: {
      runId: "run-1",
      entryId: `history-${id}`,
      contentSha256: sha256CanonicalJson(parsed),
    },
    fieldCatalog,
    actorBindings: { "actor-1": "alice" },
    statusMappings: { "1": "todo", "2": "in_progress" },
    issueTypeMappings: { "10": "story", "11": "bug" },
    issueBindings: { "200": "REEF-002", "201": "REEF-003" },
    releaseBindings: { "300": "release-3", "301": "release-4" },
    attachmentBindings: {
      "400": {
        attachment_id: "att-400",
        file_uri: "akb://reef-e2e/file/issues/REEF-001/a.png",
        filename: "a.png",
        mime_type: "image/png",
        size_bytes: 42,
      },
    },
    relationBindings: {
      "500": {
        linkType: "Blocks",
        direction: "outward" as const,
        targetIssueId: "200",
        relation: "blocks" as const,
      },
    },
    currentIssueLinks: [
      {
        id: "500",
        type: "Blocks",
        direction: "outward" as const,
        targetIssueId: "200",
      },
    ],
    currentRemoteLinks: [
      {
        id: "600",
        globalId: "appId=confluence&pageId=600",
        url: "https://example.invalid/wiki/600",
        title: "Design page",
        application: "Confluence",
        relationship: "mentioned in",
      },
    ],
  };
};

describe("buildJiraChangelogPlan", () => {
  it("maps existing Reef events and the two new lossless event types", () => {
    const input = baseInput([
      { field: "status", fieldId: "status", from: "1", to: "2" },
      {
        field: "assignee",
        fieldId: "assignee",
        from: null,
        fromString: "Unassigned",
        to: "actor-1",
      },
      {
        field: "summary",
        fieldId: "summary",
        fromString: "Old",
        toString: "New",
      },
      {
        field: "parent",
        fieldId: "parent",
        from: null,
        fromString: "None",
        to: "200",
      },
      {
        field: "due date",
        fieldId: "duedate",
        from: null,
        fromString: "None",
        to: "2026-07-30",
      },
      {
        field: "labels",
        fieldId: "labels",
        fromString: "one,two",
        toString: "two,three",
      },
      { field: "Issue Type", fieldId: "issuetype", from: "10", to: "11" },
      {
        field: "Start date",
        fieldId: "customfield_10015",
        from: null,
        fromString: "None",
        to: "2026-07-21",
      },
    ]);
    const plan = buildJiraChangelogPlan(input);

    expect(plan.items.map((item) => item.classification)).toEqual(
      Array(8).fill("promoted"),
    );
    expect(plan.items.map((item) => item.activity?.eventType)).toEqual([
      "status_change",
      "assignee_change",
      "title_change",
      "parent_change",
      "due_date_change",
      "labels_change",
      "issue_type_change",
      "start_date_change",
    ]);
    expect(plan.items[7]?.activity?.payload).toEqual({
      from: null,
      to: "2026-07-21",
    });
    expect(plan.report.totals).toEqual({
      promoted: 8,
      raw: 0,
      deferred: 0,
      failed: 0,
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.items)).toBe(true);
  });

  it("never promotes fuzzy aliases or lossy issue types and dates", () => {
    const plan = buildJiraChangelogPlan({
      ...baseInput([
        { field: "Status value", from: "1", to: "2" },
        { field: "Issue Type", fieldId: "issuetype", from: "10", to: "999" },
        {
          field: "Start date",
          fieldId: "customfield_10015",
          from: null,
          to: "not-a-date",
        },
      ]),
      configuredExactAliases: { Workflow: "status" as const },
    });
    expect(plan.items.map((item) => item.classification)).toEqual([
      "raw",
      "deferred",
      "deferred",
    ]);
    expect(plan.items.every((item) => item.activity === null)).toBe(true);
  });

  it("defers omitted values instead of fabricating explicit null transitions", () => {
    const plan = buildJiraChangelogPlan(
      baseInput([
        { field: "assignee", fieldId: "assignee", to: "actor-1" },
        {
          field: "Start date",
          fieldId: "customfield_10015",
          to: "2026-07-21",
        },
        { field: "labels", fieldId: "labels" },
      ]),
    );

    expect(plan.items.map((item) => item.classification)).toEqual([
      "deferred",
      "deferred",
      "deferred",
    ]);
    expect(plan.items.map((item) => item.reason)).toEqual([
      "assignee_binding_missing",
      "start_date_lossy",
      "labels_value_missing",
    ]);
    expect(plan.items.every((item) => item.activity === null)).toBe(true);
  });

  it("rejects impossible calendar dates without rejecting valid leap days", () => {
    const plan = buildJiraChangelogPlan(
      baseInput([
        {
          field: "Start date",
          fieldId: "customfield_10015",
          from: null,
          to: "2026-02-31",
        },
        {
          field: "Start date",
          fieldId: "customfield_10015",
          from: null,
          to: "2024-02-29",
        },
      ]),
    );

    expect(plan.items.map((item) => item.classification)).toEqual([
      "deferred",
      "promoted",
    ]);
    expect(plan.items[0]?.reason).toBe("start_date_lossy");
    expect(plan.items[1]?.activity?.payload).toEqual({
      from: null,
      to: "2024-02-29",
    });
  });

  it("maps release, issue-link, remote-link, and attachment bindings without fabrication", () => {
    const plan = buildJiraChangelogPlan(
      baseInput([
        { field: "Fix Version", fieldId: "fixVersions", from: null, to: "300" },
        { field: "Link", fieldId: "issuelinks", from: null, to: "500" },
        {
          field: "RemoteIssueLink",
          fieldId: "RemoteIssueLink",
          from: null,
          to: "600",
        },
        { field: "Attachment", fieldId: "attachment", from: null, to: "400" },
      ]),
    );
    expect(plan.items.map((item) => item.classification)).toEqual([
      "promoted",
      "promoted",
      "promoted",
      "promoted",
    ]);
    expect(plan.items[0]?.activity).toMatchObject({
      eventType: "planning_link",
      payload: { field: "release", from: null, to: "release-3" },
    });
    expect(plan.items[1]?.activity).toMatchObject({
      eventType: "relation_change",
      payload: { relation: "blocks", added: ["REEF-002"], removed: [] },
    });
    expect(plan.items[2]?.externalRef).toEqual({
      type: "confluence",
      ref: "appId=confluence&pageId=600",
      url: "https://example.invalid/wiki/600",
      label: "Design page",
    });
    expect(plan.items[2]).not.toHaveProperty("rawAuthor");
    expect(plan.items[3]?.activity).toMatchObject({
      eventType: "attachment_added",
      payload: { attachment_id: "att-400" },
    });
  });

  it("defers missing bindings and snapshots instead of inventing target actions", () => {
    const input = baseInput([
      { field: "Fix Version", fieldId: "fixVersions", from: null, to: "999" },
      { field: "Link", fieldId: "issuelinks", from: null, to: "999" },
      {
        field: "RemoteIssueLink",
        fieldId: "RemoteIssueLink",
        from: null,
        to: "999",
      },
      { field: "Attachment", fieldId: "attachment", from: null, to: "999" },
    ]);
    const plan = buildJiraChangelogPlan(input);
    expect(plan.items.map((item) => item.classification)).toEqual(
      Array(4).fill("deferred"),
    );
    expect(
      plan.items.every(
        (item) => item.activity === null && item.externalRef === null,
      ),
    ).toBe(true);
  });

  it("defers remote links containing credentials or secret-bearing parameters", () => {
    const history = [
      {
        field: "RemoteIssueLink",
        fieldId: "RemoteIssueLink",
        from: null,
        to: "600",
      },
    ];
    const credentialPlan = buildJiraChangelogPlan({
      ...baseInput(history),
      currentRemoteLinks: [
        {
          id: "600",
          globalId: "remote-600",
          url: "https://user:password@example.invalid/wiki/600",
          title: "Private page",
          application: null,
          relationship: null,
        },
      ],
    });
    const tokenPlan = buildJiraChangelogPlan({
      ...baseInput(history),
      currentRemoteLinks: [
        {
          id: "600",
          globalId: "remote-600",
          url: "https://example.invalid/wiki/600?access_token=secret-value",
          title: "Private page",
          application: null,
          relationship: null,
        },
      ],
    });
    const fragmentUrl = new URL("https://example.invalid/callback");
    fragmentUrl.hash = new URLSearchParams([
      [["client", "secret"].join("_"), "fragment-value"],
      [["refresh", "token"].join("_"), "refresh-value"],
    ]).toString();
    const fragmentSecretPlan = buildJiraChangelogPlan({
      ...baseInput(history),
      currentRemoteLinks: [
        {
          id: "600",
          globalId: "remote-600",
          url: fragmentUrl.toString(),
          title: "Private callback",
          application: null,
          relationship: null,
        },
      ],
    });
    const aliasUrl = new URL("https://example.invalid/callback");
    aliasUrl.searchParams.set(["j", "w", "t"].join(""), "alias-value");
    const aliasPlan = buildJiraChangelogPlan({
      ...baseInput(history),
      currentRemoteLinks: [
        {
          id: "600",
          globalId: "remote-600",
          url: aliasUrl.toString(),
          title: "Private callback",
          application: null,
          relationship: null,
        },
      ],
    });

    for (const plan of [
      credentialPlan,
      tokenPlan,
      fragmentSecretPlan,
      aliasPlan,
    ]) {
      expect(plan.items[0]).toMatchObject({
        classification: "deferred",
        reason: "remote_link_url_unsafe",
        externalRef: null,
      });
    }
    const serialized = JSON.stringify([
      credentialPlan,
      tokenPlan,
      fragmentSecretPlan,
      aliasPlan,
    ]);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("fragment-value");
    expect(serialized).not.toContain("refresh-value");
    expect(serialized).not.toContain("alias-value");
    expect(serialized).not.toContain("password");
  });

  it("preserves allowlisted Confluence location parameters", () => {
    const input = baseInput([
      {
        field: "RemoteIssueLink",
        fieldId: "RemoteIssueLink",
        from: null,
        to: "600",
      },
    ]);
    const plan = buildJiraChangelogPlan({
      ...input,
      currentRemoteLinks: input.currentRemoteLinks?.map((remote) => ({
        ...remote,
        url: "https://example.invalid/wiki/view?pageId=600",
      })),
    });

    expect(plan.items[0]).toMatchObject({
      classification: "promoted",
      externalRef: {
        url: "https://example.invalid/wiki/view?pageId=600",
      },
    });
  });

  it("defers remote-link removals instead of fabricating external-ref additions", () => {
    const plan = buildJiraChangelogPlan(
      baseInput([
        {
          field: "RemoteIssueLink",
          fieldId: "RemoteIssueLink",
          from: "600",
          to: null,
        },
      ]),
    );

    expect(plan.items[0]).toMatchObject({
      classification: "deferred",
      reason: "remote_link_removal_reconciliation_unsupported",
      externalRef: null,
    });
  });

  it("defers an unbound issue link even when the current snapshot has that id", () => {
    const input = baseInput([
      { field: "Link", fieldId: "issuelinks", from: null, to: "500" },
    ]);
    const plan = buildJiraChangelogPlan({
      ...input,
      relationBindings: {},
    });

    expect(plan.items[0]).toMatchObject({
      classification: "deferred",
      reason: "issue_link_reconciliation_missing",
      activity: null,
    });
  });

  it("keeps policy-only fields raw and conserves a 6,011-item report", () => {
    const rawFields = [
      "description",
      "Rank",
      "Goals",
      "resolution",
      "Comment",
      "customfield_unknown",
    ];
    const items = Array.from({ length: 6_011 }, (_, index) => ({
      field: rawFields[index % rawFields.length],
      fieldId:
        rawFields[index % rawFields.length] === "Rank"
          ? "customfield_10019"
          : rawFields[index % rawFields.length],
      fromString: "before",
      toString: "after",
    }));
    const plan = buildJiraChangelogPlan(baseInput(items));
    expect(plan.report.itemCount).toBe(6_011);
    expect(
      Object.values(plan.report.totals).reduce((sum, count) => sum + count, 0),
    ).toBe(6_011);
    expect(plan.report.totals.raw).toBe(6_011);
    expect(plan.items.every((item) => item.activity === null)).toBe(true);
  });

  it("counts prototype-shaped field ids as ordinary own report fields", () => {
    const plan = buildJiraChangelogPlan(
      baseInput([
        { field: "Unknown", fieldId: "__proto__", from: "a", to: "b" },
        { field: "Unknown", fieldId: "constructor", from: "a", to: "b" },
      ]),
    );

    expect(plan.report.totals.raw).toBe(2);
    for (const field of ["__proto__", "constructor"]) {
      expect(Object.hasOwn(plan.report.byField, field)).toBe(true);
      expect(plan.report.byField[field]).toEqual({
        promoted: 0,
        raw: 1,
        deferred: 0,
        failed: 0,
      });
    }
    expect(Object.getPrototypeOf(plan.report.byField)).toBe(Object.prototype);
  });

  it("requires the raw object checksum and exposes drift as failed classifications", () => {
    const input = baseInput([
      { field: "status", fieldId: "status", from: "1", to: "2" },
    ]);
    expect(() =>
      buildJiraChangelogPlan({ ...input, rawArchiveReference: undefined }),
    ).toThrow(/raw archive reference/i);
    expect(() =>
      buildJiraChangelogPlan({
        ...input,
        rawArchiveReference: {
          runId: "run-1",
          entryId: "history-h-1",
          contentSha256: SHA,
        },
      }),
    ).toThrow(/raw archive checksum/i);

    const drifted = buildJiraChangelogPlan({
      ...input,
      boundSourceFingerprint: SHA,
    });
    expect(drifted.items[0]).toMatchObject({
      classification: "failed",
      reason: "source_fingerprint_conflict",
      activity: null,
    });
  });

  it("fingerprints the archived pre-normalization payload and never fabricates time", () => {
    const rawHistory = {
      id: 42,
      author: { accountId: "actor-1" },
      items: [{ field: "status", fieldId: "status", from: 1, to: 2 }],
    };
    const plan = buildJiraChangelogPlan({
      ...baseInput([]),
      history: rawHistory,
      rawArchiveReference: {
        runId: "run-1",
        entryId: "history-42",
        contentSha256: sha256CanonicalJson(rawHistory),
      },
    });

    expect(plan.sourceIdentity.history_id).toBe("42");
    expect(plan.sourceFingerprint).toBe(sha256CanonicalJson(rawHistory));
    expect(plan.items[0]).toMatchObject({
      classification: "deferred",
      reason: "history_created_invalid",
      activity: null,
    });
  });
});

describe("jiraChangelogActivityEventKey", () => {
  it("is stable for replay and distinguishes histories with identical values and time", () => {
    const one = jiraChangelogActivityEventKey({
      cloudId: "cloud-1",
      issueId: "10001",
      historyId: "h-1",
      itemIndex: 0,
      eventType: "status_change",
    });
    expect(
      jiraChangelogActivityEventKey({
        cloudId: "cloud-1",
        issueId: "10001",
        historyId: "h-1",
        itemIndex: 0,
        eventType: "status_change",
      }),
    ).toBe(one);
    expect(
      jiraChangelogActivityEventKey({
        cloudId: "cloud-1",
        issueId: "10001",
        historyId: "h-2",
        itemIndex: 0,
        eventType: "status_change",
      }),
    ).not.toBe(one);
  });

  it("percent-encodes punctuation outside the validated key alphabet", () => {
    expect(
      jiraChangelogActivityEventKey({
        cloudId: "cloud!'()*",
        issueId: "10001",
        historyId: "h-1",
        itemIndex: 0,
        eventType: "status_change",
      }),
    ).toContain("cloud%21%27%28%29%2A");
  });
});

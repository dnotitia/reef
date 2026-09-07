import { createRequire } from "node:module";
import {
  docUri,
  issueDocumentUri,
  issuePathFor,
  sha256,
  slugify,
  uuidFor,
} from "./mock-utils.mjs";

const require = createRequire(import.meta.url);
export const fixtureLogin = require("./fixture-login.json");

export const NOW = "2026-06-15T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
export const REEF_VAULT = "reef-e2e";
export const ISSUE_TITLE_COLLATOR = new Intl.Collator("en-US");
export const TOOL_LOOP_E2E_PROMPT = "tool transparency e2e";
export const TOOL_LOOP_SEARCH_ISSUES_CALL_ID = "call_e2e_search_issues";
export const TOOL_LOOP_SEARCH_DOCUMENTS_CALL_ID = "call_e2e_search_documents";
export const ISSUE_READ_CALL_ID_PREFIX = "call_e2e_read_issue_";
export const IMAGE_UPLOAD_FIXTURE_PATH =
  "/__e2e/assets/reef-markdown-editor-image.png";
export const IMAGE_UPLOAD_FIXTURE_FILE_NAME = "reef-markdown-editor-image.png";
export const IMAGE_UPLOAD_FIXTURE_CONTENT_TYPE = "image/png";
export const IMAGE_UPLOAD_FIXTURE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAYAAADuFn/PAAAAs0lEQVR42u3ZsQmAQBAEQHMTezA3sQfLEmxEEGzC0D5sQ9O3g/vgeUSYYMNNbqLlmmlLKUo/P2FK++O1h+mOJUxpP51DmHttw5T2GwAAAAAAAAAAAAAAPgCofeBcv/aBc/3aB871AQAAAAAAAAAAAAD4AsAQs4QBAAAAAAAAAAAA+AcYYpYwAAAAAAAAAAAAAP8AQ8wSBgAAAAAAAAAAAOAfYIhZwgAAAAAAAAAAAAB+D/ACWn8C0ZKjwsMAAAAASUVORK5CYII=",
  "base64",
);
export const MARKDOWN_FIXTURE_IMAGE_URL =
  "/api/e2e/assets/reef-markdown-editor-image.png";
export const MARKDOWN_FIXTURE_LARGE_IMAGE_URL =
  "/api/e2e/assets/reef-markdown-editor-large.svg";
export const MARKDOWN_FIXTURE_TRANSPARENT_IMAGE_URL =
  "/api/e2e/assets/reef-markdown-editor-transparent.svg";
export const MARKDOWN_FIXTURE_BROKEN_IMAGE_PATH =
  "/__e2e/assets/reef-markdown-editor-missing.png";
export const MARKDOWN_MEDIA_ASSETS = new Map([
  [
    "/__e2e/assets/reef-markdown-editor-large.svg",
    {
      contentType: "image/svg+xml",
      body: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200"><rect width="1600" height="1200" fill="#0f766e"/><text x="800" y="600" fill="white" font-size="96" text-anchor="middle">large fixture</text></svg>',
        "utf8",
      ),
    },
  ],
  [
    "/__e2e/assets/reef-markdown-editor-transparent.svg",
    {
      contentType: "image/svg+xml",
      body: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><circle cx="160" cy="90" r="72" fill="none" stroke="#0f766e" stroke-width="8"/></svg>',
        "utf8",
      ),
    },
  ],
  [
    MARKDOWN_FIXTURE_BROKEN_IMAGE_PATH,
    {
      contentType: "image/png",
      body: Buffer.from("not a valid image", "utf8"),
    },
  ],
]);
export const MARKDOWN_FIXTURE_FILE_ID = "incident-log";
export const MARKDOWN_FIXTURE_FILE_URI = `akb://${REEF_VAULT}/issues/file/${MARKDOWN_FIXTURE_FILE_ID}`;
export const MARKDOWN_FIXTURE_FILE_BYTES = Buffer.from(
  "fixture incident log\nstatus=contained\n",
  "utf8",
);
export const MARKDOWN_FIXTURE = [
  "A compact mixed-language introduction: 한국어 문서와 English notes share the same 2026 issue context.",
  "A second top-level paragraph repeats the reading rhythm with 숫자 12345, API names, and enough text to exercise normal wrapping in the detail panel.",
  "# Markdown reference",
  "A heading-led section keeps the hierarchy readable while this paragraph combines 한국어, English, and 42 without widening the editor.",
  "## Structure",
  "A second section paragraph explains the structure before the nested heading and keeps the blocks visibly separated.",
  "### Details",
  "A paragraph with **bold**, *italic*, ~~strikethrough~~, and **_~~nested emphasis~~_**; it includes a [reef link](https://example.com/reef), an [AKB report](akb://reef-e2e/coll/docs/doc/spec-overview.md), `inline code`, and @alice. Known issue REEF-002; unknown REEF-999, `REEF-002`, and \\REEF-002 remain readable.",
  "1. Ordered item one\n2. Ordered item two\n   - Nested unordered item\n     1. Nested ordered child",
  "- Unordered item one\n- Unordered item two\n  1. Nested ordered child\n     - Nested unordered grandchild",
  "- [x] Completed parent\n  - [ ] Open child\n  - [x] Completed child",
  "> A quoted paragraph with a meaningful boundary.\n>\n> A second quoted paragraph keeps the citation hierarchy readable.\n>\n> - Nested unordered item\n>   1. Nested ordered child\n>   2. Another ordered child",
  '```ts\nconst token = "reef";\nconst intentionallyLongLine = "012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789";\nreturn token;\n```',
  "---",
  `![Fixture image](${MARKDOWN_FIXTURE_IMAGE_URL})`,
  `![Large fixture image](${MARKDOWN_FIXTURE_LARGE_IMAGE_URL})`,
  `![Transparent fixture image](${MARKDOWN_FIXTURE_TRANSPARENT_IMAGE_URL})`,
  "![Broken fixture image](/api/e2e/assets/reef-markdown-editor-missing.png)",
  `[incident.log](${MARKDOWN_FIXTURE_FILE_URI})`,
  "| Pattern | Meaning |\n| --- | --- |\n| pipe | preserved source |",
  "The final paragraph closes the fixture with 한국어·English·숫자 혼합 content and verifies the last direct block boundary.",
].join("\n\n");
export const SUPPORTED_SCENARIOS = [
  "empty",
  "configured",
  "configured_empty",
  "configured_caught_up",
  "updated_at_range",
  "configured_multi",
  "assignee_picker",
  "backlog_bulk_partial_failure",
  "demo_board",
  "content_search",
  "raw_only",
  "notifications",
  "skill_outdated",
  "comment_mentions",
  "large_vault",
  "markdown_fixture",
  "typography",
  "status_quick_edit",
  "planning_overflow",
  "epic_grouping",
];
export const SUPPORTED_SCENARIO_SET = new Set(SUPPORTED_SCENARIOS);
export const ACCOUNT_DENIAL_CODES = new Set([
  "membership_required",
  "account_suspended",
  "identity_conflict",
]);
export const AUTH_PROTECTED_RESPONSES = new Set([
  "healthy",
  "unauthorized",
  "forbidden",
]);
export const AUTH_SESSIONS = new Set(["active", "revoked"]);
export const AUTH_PROBE_HANG_MAX_MS = 8_000;

const CONFIGURED_SCENARIOS = new Set([
  "configured",
  "configured_empty",
  "configured_caught_up",
  "updated_at_range",
  "configured_multi",
  "assignee_picker",
  "backlog_bulk_partial_failure",
  "notifications",
  "skill_outdated",
  "comment_mentions",
  "typography",
  "large_vault",
  "status_quick_edit",
  "planning_overflow",
  "epic_grouping",
]);

export function createScenarioVaults(scenario) {
  const vaults = new Map();
  if (CONFIGURED_SCENARIOS.has(scenario)) {
    const vault =
      scenario === "large_vault"
        ? largeVault(REEF_VAULT)
        : scenario === "configured_empty"
          ? configuredEmptyVault(REEF_VAULT)
          : scenario === "configured_caught_up"
            ? configuredCaughtUpVault(REEF_VAULT)
            : scenario === "updated_at_range"
              ? updatedAtRangeVault(REEF_VAULT)
              : scenario === "assignee_picker"
                ? assigneePickerVault(REEF_VAULT)
                : scenario === "planning_overflow"
                  ? planningOverflowVault(REEF_VAULT)
                  : scenario === "epic_grouping"
                    ? epicGroupingVault(REEF_VAULT)
                    : scenario === "typography"
                      ? typographyVault(REEF_VAULT)
                      : configuredVault(REEF_VAULT);
    if (scenario === "notifications") seedNotifications(vault);
    if (scenario === "skill_outdated") seedOutdatedVaultSkill(vault);
    if (scenario === "comment_mentions") {
      vault.members.push({
        username: "Bob Smith",
        display_name: "Bob Smith",
        email: "bob@example.com",
        role: "member",
        since: NOW,
      });
    }
    if (scenario === "status_quick_edit") {
      vault.members.push({
        username: "bob",
        display_name: "Bob Example",
        email: "bob@example.com",
        role: "writer",
        since: NOW,
      });
    }
    vaults.set(REEF_VAULT, vault);
    vaults.set("raw-vault", rawVault("raw-vault"));
    if (scenario === "configured_multi") {
      vaults.set("reef-zeta", configuredVault("reef-zeta"));
      vaults.set("reef-alpha", configuredVault("reef-alpha"));
    }
  } else if (scenario === "markdown_fixture") {
    vaults.set(REEF_VAULT, markdownFixtureVault(REEF_VAULT));
    vaults.set("raw-vault", rawVault("raw-vault"));
  } else if (scenario === "demo_board") {
    vaults.set(REEF_VAULT, demoBoardVault(REEF_VAULT));
    vaults.set("raw-vault", rawVault("raw-vault"));
  } else if (scenario === "content_search") {
    vaults.set(REEF_VAULT, contentSearchVault(REEF_VAULT));
    vaults.set("raw-vault", rawVault("raw-vault"));
  } else if (scenario === "raw_only") {
    vaults.set("raw-vault", rawVault("raw-vault"));
  }
  return vaults;
}

function seedIssueDocument(vault, id, content) {
  const path = issuePathFor(id);
  vault.documents.set(path, {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title: id,
    type: "task",
    status: "active",
    summary: vault.issues.find((issue) => issue.reef_id === id)?.title ?? id,
    content,
    tags: [],
    created_at: NOW,
    updated_at: NOW,
    current_commit: `e2e-seed-${slugify(id)}`,
  });
}

function seedIssueHistory(vault, id) {
  const path = issuePathFor(id);
  vault.documentHistory.set(path, [
    {
      hash: "e2e-body-update-1",
      message: "Update issue body\n\naction: update\nagent: codex",
      author: "00000000-0000-4000-8000-000000000101",
      author_name: "alice",
      date: "2026-06-17T09:00:00.000Z",
    },
    {
      hash: "e2e-body-update-2",
      message: "Update issue body\n\naction: update\nagent: codex",
      author: "00000000-0000-4000-8000-000000000102",
      author_name: null,
      date: "2026-06-17T09:01:00.000Z",
    },
    {
      hash: "e2e-body-update-3",
      message: "Update issue body\n\naction: update\nagent: codex",
      author: "00000000-0000-4000-8000-000000000103",
      author_name: "alice",
      date: "2026-06-17T09:02:00.000Z",
    },
    {
      hash: "e2e-body-update-4",
      message: "Update issue body\n\naction: update\nagent: codex",
      author: "00000000-0000-4000-8000-000000000104",
      author_name: "alice",
      date: "2026-06-17T09:03:00.000Z",
    },
    {
      hash: "e2e-body-create",
      message: "Create issue\n\naction: create",
      author: "00000000-0000-4000-8000-000000000105",
      author_name: "alice",
      date: "2026-06-17T08:59:00.000Z",
    },
    { hash: "e2e-body-malformed", message: "invalid" },
  ]);
}

function seedReferenceDocument(
  vault,
  path,
  { title, type, summary, content, tags },
) {
  vault.documents.set(path, {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title,
    type,
    status: "active",
    summary,
    content,
    tags,
    created_at: NOW,
    updated_at: NOW,
    current_commit: `e2e-seed-${slugify(path)}`,
  });
}

function seedOutdatedVaultSkill(vault) {
  vault.settings.set("vault_skill", {
    version: 9,
    synced_at: "2026-06-01T00:00:00.000Z",
  });
  const path = "overview/vault-skill.md";
  vault.documents.set(path, {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title: `${vault.name} Reef PM Workspace Skill`,
    type: "skill",
    status: "active",
    summary: "Outdated manually edited skill.",
    content: "OUTDATED MANUAL SKILL CONTENT",
    tags: ["akb:skill", "reef:pm-workspace"],
    created_at: NOW,
    updated_at: NOW,
    current_commit: "e2e-seed-outdated-vault-skill",
  });
}

function markdownFixtureVault(name) {
  const vault = configuredVault(name);
  const issue = vault.issues[0];
  const secondIssue = vault.issues.find(
    (candidate) => candidate.reef_id === "REEF-002",
  );
  if (!issue || !secondIssue) {
    throw new Error("Markdown fixture requires two seeded issues");
  }

  issue.title = "Markdown reference";
  issue.labels = ["markdown", "fixture"];
  secondIssue.title = "Alpha follow-up";
  secondIssue.labels = ["markdown", "fixture"];
  vault.issues = [issue, secondIssue];
  vault.documents = new Map();
  vault.documentHistory = new Map();
  vault.comments = [];
  vault.activity = [];
  vault.notifications = [];
  vault.subscriptions = [];
  vault.files = new Map([
    [
      MARKDOWN_FIXTURE_FILE_ID,
      {
        id: MARKDOWN_FIXTURE_FILE_ID,
        uri: MARKDOWN_FIXTURE_FILE_URI,
        filename: "incident.log",
        mimeType: "text/plain",
        sizeBytes: MARKDOWN_FIXTURE_FILE_BYTES.length,
        body: MARKDOWN_FIXTURE_FILE_BYTES,
        contentHash: sha256(MARKDOWN_FIXTURE_FILE_BYTES),
        confirmed: true,
      },
    ],
  ]);
  vault.attachments = [
    {
      id: "markdown-fixture-attachment",
      reef_id: issue.reef_id,
      file_uri: MARKDOWN_FIXTURE_FILE_URI,
      filename: "incident.log",
      mime_type: "text/plain",
      size_bytes: MARKDOWN_FIXTURE_FILE_BYTES.length,
      author: "alice",
      created_at: NOW,
      source: "issue_body",
      inline: true,
      original_jira_attachment_id: null,
      meta: null,
    },
  ];
  vault.comments = [
    {
      id: uuidFor(40),
      reef_id: issue.reef_id,
      body: MARKDOWN_FIXTURE,
      meta: {
        author: "bob",
        created_at: "2026-06-15T01:00:00.000Z",
        edited_at: null,
        mention_recipients: ["alice"],
      },
      created_at: "2026-06-15T01:00:00.000Z",
      updated_at: "2026-06-15T01:00:00.000Z",
      created_by: "bob",
    },
  ];
  seedIssueDocument(vault, issue.reef_id, MARKDOWN_FIXTURE);
  seedIssueDocument(vault, secondIssue.reef_id, "Alpha follow-up issue body.");
  seedReferenceDocument(vault, "docs/alpha-reference.md", {
    title: "Alpha reference",
    type: "reference",
    summary: "A normal vault document for inline reference suggestions.",
    content: "Alpha reference notes for the unified issue-body picker.",
    tags: ["markdown", "fixture"],
  });
  return vault;
}

function configuredVault(name) {
  const sprintId = uuidFor(1);
  const milestoneId = uuidFor(2);
  const releaseId = uuidFor(3);
  const issues = [
    issueRow({
      id: "REEF-001",
      title: "Initial issue Alpha",
      status: "todo",
      priority: "high",
      assigned_to: "alice",
      start_date: "2026-06-10",
      due_date: "2026-06-24",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      labels: ["frontend", "e2e"],
    }),
    issueRow({
      id: "REEF-002",
      title: "Initial issue Beta",
      status: "in_progress",
      priority: "medium",
      assigned_to: null,
      start_date: "2026-06-12",
      due_date: "2026-06-28",
      labels: ["backend"],
    }),
    issueRow({
      id: "REEF-003",
      title: "Backlog issue Gamma",
      status: "backlog",
      priority: "low",
      assigned_to: null,
      rank: 1000,
      labels: ["triage"],
    }),
  ];
  const vault = {
    id: `vault-${name}`,
    name,
    description: "Hermetic reef E2E workspace",
    status: "active",
    role: "owner",
    created_at: NOW,
    tables: new Set([
      "reef_settings",
      "monitored_repos",
      "reef_issues",
      "reef_templates",
      "reef_comments",
      "reef_attachments",
      "reef_activity",
      "reef_notifications",
      "reef_subscriptions",
      "reef_sprints",
      "reef_milestones",
      "reef_releases",
    ]),
    settings: new Map([["project_prefix", "REEF"]]),
    monitoredRepos: [],
    issues,
    documents: new Map(),
    documentHistory: new Map(),
    members: [
      {
        username: "alice",
        display_name: "Alice Example",
        email: "alice@example.com",
        role: "owner",
        since: NOW,
      },
    ],
    sprints: [
      {
        id: sprintId,
        name: "Sprint Alpha",
        status: "active",
        start_date: "2026-06-01",
        end_date: "2026-06-30",
        goal: "Finish the hermetic E2E spine.",
        capacity_points: 8,
        meta: {},
      },
    ],
    milestones: [
      {
        id: milestoneId,
        name: "Coverage Complete",
        status: "open",
        target_date: "2026-06-30",
        description:
          "Every routed surface is covered or deliberately deferred.",
        meta: {},
      },
    ],
    releases: [
      {
        id: releaseId,
        name: "June E2E",
        status: "in_progress",
        target_date: "2026-06-30",
        released_at: null,
        notes: "Hermetic browser coverage release.",
        meta: {},
      },
    ],
    templates: [],
    notifications: [],
    subscriptions: [],
    attachments: [],
    files: new Map(),
    comments: [
      {
        id: uuidFor(40),
        reef_id: "REEF-001",
        body: "Kicking this off — the `reconcile()` gate needs a look before we wire the write path.",
        meta: {
          author: "bob",
          created_at: "2026-06-16T09:00:00.000Z",
          edited_at: null,
        },
        created_at: "2026-06-16T09:00:00.000Z",
        updated_at: "2026-06-16T09:00:00.000Z",
        created_by: "bob",
      },
      {
        id: uuidFor(41),
        reef_id: "REEF-001",
        body: "Agreed. Pushed the schema_version stamp:\n\n```ts\nawait ensureReefTables({ adapter, vault });\n```",
        meta: {
          author: "alice",
          created_at: "2026-06-16T10:30:00.000Z",
          edited_at: "2026-06-16T10:45:00.000Z",
        },
        created_at: "2026-06-16T10:30:00.000Z",
        updated_at: "2026-06-16T10:45:00.000Z",
        created_by: "alice",
      },
    ],
    // REEF-277: seeded reef_activity field-change events so the issue timeline
    // renders the full Linear-parity set (title/labels/due/estimate/parent/
    // relation/archive) in the hermetic runtime. Real edits append more rows
    // through the insert handler below.
    activity: [
      activityRow("REEF-001", "status_change", "2026-06-16T00:00:00.000Z", {
        from: "todo",
        to: "in_progress",
      }),
      activityRow("REEF-001", "status_change", "2026-06-18T00:00:00.000Z", {
        from: "in_progress",
        to: "done",
      }),
      activityRow("REEF-001", "status_change", "2026-06-19T00:00:00.000Z", {
        from: "done",
        to: "todo",
      }),
      activityRow("REEF-002", "status_change", "2026-06-16T01:00:00.000Z", {
        from: "todo",
        to: "in_progress",
      }),
      activityRow("REEF-002", "status_change", "2026-06-26T00:00:00.000Z", {
        from: "in_progress",
        to: "done",
      }),
      activityRow("REEF-002", "status_change", "2026-06-27T00:00:00.000Z", {
        from: "done",
        to: "in_progress",
      }),
      activityRow("REEF-003", "status_change", "2026-06-15T00:00:00.000Z", {
        from: "todo",
        to: "in_progress",
      }),
      activityRow("REEF-003", "status_change", "2026-06-16T00:00:00.000Z", {
        from: "in_progress",
        to: "done",
      }),
      activityRow("REEF-003", "status_change", "2026-06-17T00:00:00.000Z", {
        from: "done",
        to: "backlog",
      }),
      activityRow("REEF-001", "title_change", "2026-06-17T08:00:00.000Z", {
        from: "Initial issue Alpha",
        to: "Initial issue Alpha (revised)",
      }),
      activityRow("REEF-001", "labels_change", "2026-06-17T08:05:00.000Z", {
        added: ["backend"],
        removed: ["frontend"],
      }),
      activityRow("REEF-001", "due_date_change", "2026-06-17T08:10:00.000Z", {
        from: null,
        to: "2026-07-15T00:00:00.000Z",
      }),
      activityRow("REEF-001", "estimate_change", "2026-06-17T08:15:00.000Z", {
        from: null,
        to: 5,
      }),
      activityRow("REEF-001", "parent_change", "2026-06-17T08:20:00.000Z", {
        from: null,
        to: "REEF-002",
      }),
      activityRow("REEF-001", "relation_change", "2026-06-17T08:25:00.000Z", {
        relation: "depends_on",
        added: ["REEF-003"],
        removed: [],
      }),
      activityRow("REEF-001", "archived_change", "2026-06-17T08:30:00.000Z", {
        from: false,
        to: true,
      }),
      activityRow("REEF-001", "issue_type_change", "2026-06-17T08:35:00.000Z", {
        from: "story",
        to: "bug",
      }),
      activityRow("REEF-001", "start_date_change", "2026-06-17T08:40:00.000Z", {
        from: null,
        to: "2026-07-21",
      }),
    ],
  };

  seedIssueDocument(vault, "REEF-001", "Alpha description from fixture.");
  seedIssueDocument(vault, "REEF-002", "Beta description from fixture.");
  seedIssueDocument(vault, "REEF-003", "Gamma backlog description.");
  seedIssueHistory(vault, "REEF-001");
  seedReferenceDocument(vault, "docs/spec-overview.md", {
    title: "Spec overview",
    type: "reference",
    summary: "Fixture document cited by Ask AI tool-loop coverage.",
    content:
      "Spec overview for the hermetic Ask AI tool transparency workflow.",
    tags: ["docs", "ask-ai", "e2e"],
  });
  return vault;
}

function typographyVault(name) {
  const vault = configuredVault(name);
  const sprintId = vault.sprints[0]?.id ?? null;
  const milestoneId = vault.milestones[0]?.id ?? null;
  const releaseId = vault.releases[0]?.id ?? null;
  const statusCycle = ["todo", "in_progress", "in_review", "done"];
  const titleCycle = ["한글 제목", "English title", "혼합 Mixed 제목"];
  const issues = Array.from({ length: 79 }, (_, index) => {
    const issueNumber = index + 1;
    const id = `REEF-${String(issueNumber).padStart(3, "0")}`;
    return issueRow({
      id,
      title: `${titleCycle[index % titleCycle.length]} ${String(issueNumber).padStart(2, "0")}`,
      status: statusCycle[index % statusCycle.length],
      priority: "medium",
      assigned_to: "alice",
      start_date: "2026-12-10",
      due_date: "2026-12-24",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      labels: ["typography"],
    });
  });

  vault.issues = issues;
  vault.documents = new Map();
  vault.documentHistory = new Map();
  vault.comments = [];
  vault.activity = [];
  for (const issue of issues) {
    seedIssueDocument(vault, issue.reef_id, `${issue.title} fixture body.`);
  }
  return vault;
}

function planningOverflowVault(name) {
  const vault = configuredVault(name);
  const template = vault.milestones[0];
  vault.milestones = [
    template,
    {
      ...template,
      id: uuidFor(4),
      name: "Adjacent milestone",
    },
    {
      ...template,
      id: uuidFor(5),
      name: "A milestone name long enough to overflow the planning filter option panel",
    },
  ];
  return vault;
}

function epicGroupingVault(name) {
  const vault = configuredVault(name);
  const issues = [
    issueRow({
      id: "REEF-100",
      title: "Platform foundation",
      status: "in_progress",
      issue_type: "epic",
      rank: 1000,
    }),
    issueRow({
      id: "REEF-101",
      title:
        "A very long product outcome title that should remain readable inside a compact Epic group header",
      status: "todo",
      issue_type: "epic",
      rank: 2000,
    }),
    issueRow({
      id: "REEF-001",
      title: "Ship the first foundation slice",
      status: "done",
      issue_type: "story",
      parent_id: "REEF-100",
      rank: 3000,
    }),
    issueRow({
      id: "REEF-002",
      title: "Review the second foundation slice",
      status: "todo",
      issue_type: "task",
      parent_id: "REEF-100",
      rank: 4000,
    }),
    issueRow({
      id: "REEF-003",
      title: "Prepare the product outcome",
      status: "in_review",
      issue_type: "story",
      parent_id: "REEF-101",
      rank: 5000,
    }),
    issueRow({
      id: "REEF-004",
      title: "Independent work",
      status: "todo",
      issue_type: "task",
      rank: 6000,
    }),
    issueRow({
      id: "REEF-005",
      title: "Missing relationship work",
      status: "todo",
      issue_type: "task",
      parent_id: "REEF-999",
      rank: 7000,
    }),
    issueRow({
      id: "REEF-006",
      title: "Non-Epic relationship work",
      status: "todo",
      issue_type: "task",
      parent_id: "REEF-004",
      rank: 8000,
    }),
  ];
  vault.issues = issues;
  vault.documents = new Map();
  vault.documentHistory = new Map();
  vault.comments = [];
  vault.activity = [];
  for (const issue of issues) {
    seedIssueDocument(vault, issue.reef_id, `${issue.title} fixture body.`);
  }
  return vault;
}

function updatedAtRangeVault(name) {
  const vault = configuredVault(name);
  const alpha = vault.issues.find((issue) => issue.reef_id === "REEF-001");
  const beta = vault.issues.find((issue) => issue.reef_id === "REEF-002");
  const gamma = vault.issues.find((issue) => issue.reef_id === "REEF-003");
  if (!alpha || !beta || !gamma) {
    throw new Error("updated-at range fixture requires configured issues");
  }
  alpha.updated_at = "2026-06-15T00:00:00.000Z";
  beta.updated_at = "2026-06-16T00:00:00.000Z";
  gamma.updated_at = "2026-06-15T00:00:00.000Z";
  alpha.created_at = "2026-06-10T00:00:00.000Z";
  beta.created_at = "2026-06-11T00:00:00.000Z";
  gamma.created_at = "2026-06-12T00:00:00.000Z";
  beta.start_date = null;
  beta.due_date = null;
  return vault;
}

function configuredEmptyVault(name) {
  const vault = configuredVault(name);
  vault.issues = [];
  vault.documents = new Map();
  vault.documentHistory = new Map();
  vault.sprints = [];
  vault.milestones = [];
  vault.releases = [];
  vault.comments = [];
  vault.activity = [];
  vault.notifications = [];
  vault.subscriptions = [];
  return vault;
}

function assigneePickerVault(name) {
  const vault = configuredVault(name);
  const rollbackIssue = vault.issues.find(
    (issue) => issue.reef_id === "REEF-002",
  );
  if (rollbackIssue) rollbackIssue.assigned_to = "alice";
  vault.members = [
    {
      username: "alice",
      display_name: "Alice Example",
      email: "alice@example.com",
      role: "owner",
      since: NOW,
    },
    {
      username: "bob",
      display_name: "Bob Example",
      email: "bob@example.com",
      role: "writer",
      since: NOW,
    },
    {
      username: "carol",
      display_name: "Carol Example",
      email: "carol@example.com",
      role: "admin",
      since: NOW,
    },
    {
      username: "same-z",
      display_name: "Same Name",
      email: "same-z@example.com",
      role: "writer",
      since: NOW,
    },
    {
      username: "same-a",
      display_name: "Same Name",
      email: "same-a@example.com",
      role: "writer",
      since: NOW,
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      username: `candidate-${String(index + 1).padStart(2, "0")}`,
      display_name: `Candidate ${String(index + 1).padStart(2, "0")}`,
      email: `candidate-${String(index + 1).padStart(2, "0")}@example.com`,
      role: index % 3 === 0 ? "admin" : "writer",
      since: NOW,
    })),
    {
      username: "reader-only",
      display_name: "Reader Only",
      email: "reader-only@example.com",
      role: "reader",
      since: NOW,
    },
    {
      username: "unknown-role",
      display_name: "Unknown Role",
      email: "unknown-role@example.com",
      role: "member",
      since: NOW,
    },
  ];
  vault.comments = [];
  vault.activity = [];
  return vault;
}

function configuredCaughtUpVault(name) {
  const vault = configuredVault(name);
  vault.issues = vault.issues
    .filter((issue) => issue.assigned_to === "alice")
    .map((issue) => ({ ...issue, status: "done" }));
  vault.documents = new Map();
  vault.comments = [];
  vault.activity = [];
  for (const issue of vault.issues) {
    seedIssueDocument(vault, issue.reef_id, `${issue.title} is complete.`);
  }
  return vault;
}

function contentSearchVault(name) {
  const vault = configuredVault(name);
  seedIssueDocument(
    vault,
    "REEF-002",
    "이 본문에는 한국어 본문 전용 검색 문구가 들어 있습니다.",
  );
  vault.comments.push(
    {
      id: uuidFor(42),
      reef_id: "REEF-003",
      body: "An English comment-only lighthouse phrase lives here.",
      meta: {
        author: "alice",
        created_at: "2026-06-17T11:00:00.000Z",
        edited_at: null,
      },
      created_at: "2026-06-17T11:00:00.000Z",
      updated_at: "2026-06-17T11:00:00.000Z",
      created_by: "alice",
    },
    {
      id: uuidFor(43),
      reef_id: "REEF-003",
      body: "Literal %_[\\ token is safe to search and highlight.",
      meta: {
        author: "alice",
        created_at: "2026-06-17T12:00:00.000Z",
        edited_at: null,
      },
      created_at: "2026-06-17T12:00:00.000Z",
      updated_at: "2026-06-17T12:00:00.000Z",
      created_by: "alice",
    },
  );
  for (let index = 0; index < 11; index += 1) {
    const createdAt = `2026-06-18T11:${String(index).padStart(2, "0")}:00.000Z`;
    vault.comments.push({
      id: uuidFor(100 + index),
      reef_id: "REEF-003",
      body: `Dedupe-before-limit comment ${index}`,
      meta: {
        author: "alice",
        created_at: createdAt,
        edited_at: null,
      },
      created_at: createdAt,
      updated_at: createdAt,
      created_by: "alice",
    });
  }
  vault.comments.push({
    id: uuidFor(120),
    reef_id: "REEF-001",
    body: "Dedupe-before-limit other issue",
    meta: {
      author: "alice",
      created_at: "2026-06-18T10:00:00.000Z",
      edited_at: null,
    },
    created_at: "2026-06-18T10:00:00.000Z",
    updated_at: "2026-06-18T10:00:00.000Z",
    created_by: "alice",
  });
  for (let index = 0; index < 12; index += 1) {
    const id = `REEF-${String(200 + index).padStart(3, "0")}`;
    vault.issues.push(
      issueRow({
        id,
        title: `Expansion fixture ${index + 1}`,
        status: "todo",
        priority: "low",
      }),
    );
    seedIssueDocument(
      vault,
      id,
      `Bounded expansion phrase appears in body fixture ${index + 1}.`,
    );
  }
  return vault;
}

function largeVault(name) {
  const vault = configuredVault(name);
  const issues = [];
  const total = 1_205;
  const titlePrefixes = [
    "! Symbol",
    "# Hash",
    "@ Mention",
    "Alpha",
    "alpha",
    "Ångström",
    "Éclair",
    "O'Reilly",
    "Zeta",
    "가나다",
    "한글",
    "다람쥐",
    "Beta",
  ];
  for (let index = 0; index < total; index += 1) {
    const issueNumber = index === 998 ? 999 : index === 1000 ? 1206 : index + 1;
    const id =
      index === 998
        ? "REEF-999"
        : `REEF-${String(issueNumber).padStart(4, "0")}`;
    const priority =
      index < 200
        ? "critical"
        : index < 400
          ? "high"
          : index < 700
            ? "medium"
            : "low";
    const isSparseMatch = index === 1_123;
    const fixtureDate =
      index < 99 ? `2026-06-${String((index % 3) + 1).padStart(2, "0")}` : null;
    issues.push(
      issueRow({
        id,
        title: isSparseMatch
          ? "Sparse residual match"
          : index < 2
            ? "! Symbol duplicate"
            : index < 4
              ? "힣 duplicate"
              : `${titlePrefixes[index % titlePrefixes.length]} ${String(index + 1).padStart(4, "0")}`,
        status: "todo",
        priority,
        start_date: fixtureDate,
        due_date: fixtureDate,
        labels: isSparseMatch ? ["tail-marker"] : ["large-fixture"],
      }),
    );
  }
  vault.issues = issues;
  vault.documents = new Map();
  for (const issue of issues) {
    seedIssueDocument(vault, issue.reef_id, `Large fixture ${issue.reef_id}.`);
  }
  return vault;
}

function demoBoardVault(name) {
  const sprintId = uuidFor(101);
  const milestoneId = uuidFor(102);
  const releaseId = uuidFor(103);
  // Keep the demo Manual-order spine born-correct. The normal create path
  // intentionally leaves a new issue unranked, so this fixture must give its
  // existing issues canonical ranks for the new row's deterministic tail to
  // remain observable across status groups.
  const vault = configuredVault(name);
  vault.members.push({
    username: "bob",
    display_name: "Bob Example",
    email: "bob@example.com",
    role: "writer",
    since: NOW,
  });
  const issues = [
    issueRow({
      id: "REEF-101",
      title: "Review monitored-repo findings",
      status: "todo",
      issue_type: "story",
      priority: "critical",
      assigned_to: "alice",
      rank: 3000,
      start_date: "2026-06-16",
      due_date: "2026-06-21",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 5,
      labels: ["ai", "github", "review"],
    }),
    issueRow({
      id: "REEF-102",
      title:
        "Polish onboarding for existing AKB workspaces across migration, access, and workspace setup flows with inherited settings and preserved planning context",
      status: "todo",
      issue_type: "task",
      priority: "high",
      assigned_to: "alice",
      rank: 2000,
      start_date: "2026-06-17",
      due_date: "2026-06-24",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 3,
      // REEF-270: a parent chain REEF-101 → REEF-102 → REEF-103 gives the drill
      // navigation hermetic spec a sub-issue / breadcrumb path to walk.
      parent_id: "REEF-101",
      labels: ["onboarding", "workspace"],
    }),
    issueRow({
      id: "REEF-103",
      title: "Add saved filters for stakeholder reports",
      status: "todo",
      issue_type: "task",
      priority: "medium",
      assigned_to: null,
      rank: 1000,
      due_date: "2026-06-27",
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 2,
      parent_id: "REEF-102",
      labels: ["reports"],
    }),
    issueRow({
      id: "REEF-104",
      title: "Wire board filters into shareable URL state",
      status: "in_progress",
      issue_type: "task",
      priority: "high",
      assigned_to: "alice",
      rank: 5000,
      start_date: "2026-06-14",
      due_date: "2026-06-20",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 3,
      labels: ["board", "filters"],
    }),
    issueRow({
      id: "REEF-105",
      title: "Stream grounded Ask AI answers from core",
      status: "in_progress",
      issue_type: "story",
      priority: "critical",
      assigned_to: "alice",
      rank: 4000,
      start_date: "2026-06-13",
      due_date: "2026-06-23",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 5,
      labels: ["ask-ai", "streaming"],
      depends_on: ["REEF-104"],
    }),
    issueRow({
      id: "REEF-106",
      title: "Review monitored-repo enrichment results",
      status: "in_review",
      issue_type: "task",
      priority: "high",
      assigned_to: "alice",
      rank: 7000,
      start_date: "2026-06-12",
      due_date: "2026-06-18",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 2,
      labels: ["ask-ai", "review"],
    }),
    issueRow({
      id: "REEF-107",
      title: "Validate planning context on issue cards",
      status: "in_review",
      issue_type: "task",
      priority: "medium",
      assigned_to: null,
      rank: 6000,
      start_date: "2026-06-11",
      due_date: "2026-06-19",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 2,
      labels: ["planning", "kanban"],
    }),
    issueRow({
      id: "REEF-108",
      title: "Ship stateless BFF route handlers",
      status: "done",
      issue_type: "story",
      priority: "high",
      assigned_to: "alice",
      start_date: "2026-06-04",
      due_date: "2026-06-12",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 5,
      labels: ["bff", "api"],
      rank: 8000,
    }),
    issueRow({
      id: "REEF-109",
      title: "Document the AKB issue storage contract",
      status: "done",
      issue_type: "task",
      priority: "medium",
      assigned_to: null,
      start_date: "2026-06-05",
      due_date: "2026-06-13",
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 2,
      labels: ["storage", "akb"],
      rank: 9000,
    }),
    issueRow({
      id: "REEF-110",
      title: "Retire legacy local issue mocks",
      status: "closed",
      issue_type: "chore",
      priority: "low",
      assigned_to: "alice",
      start_date: "2026-06-01",
      due_date: "2026-06-08",
      release_id: releaseId,
      estimate_points: 1,
      closed_at: "2026-06-10T10:30:00.000Z",
      closed_reason: "completed",
      labels: ["cleanup"],
      rank: 10000,
    }),
    issueRow({
      id: "REEF-111",
      title: "Archive the old OpenRouter settings spike",
      status: "closed",
      issue_type: "spike",
      priority: "medium",
      assigned_to: null,
      start_date: "2026-06-02",
      due_date: "2026-06-09",
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 1,
      closed_at: "2026-06-11T15:45:00.000Z",
      closed_reason: "completed",
      labels: ["settings", "llm"],
      rank: 11000,
    }),
    issueRow({
      id: "REEF-112",
      title: "Mobile density",
      status: "backlog",
      issue_type: "task",
      priority: "low",
      assigned_to: null,
      rank: 12000,
      parent_id: "REEF-101",
      labels: ["mobile", "board"],
    }),
  ];

  vault.description = "Demo reef workspace";
  vault.issues = issues;
  vault.documents = new Map();
  vault.sprints = [
    {
      id: sprintId,
      name: "Launch Readiness Sprint",
      status: "active",
      start_date: "2026-06-15",
      end_date: "2026-06-28",
      goal: "Prepare the AKB-backed issue workflow for a public demo.",
      capacity_points: 28,
      meta: {},
    },
  ];
  vault.milestones = [
    {
      id: milestoneId,
      name: "Agentic PM Preview",
      status: "open",
      target_date: "2026-06-30",
      description: "Show reviewable AI workflows across issues and reports.",
      meta: {},
    },
  ];
  vault.releases = [
    {
      id: releaseId,
      name: "reef 0.5 Demo",
      status: "in_progress",
      target_date: "2026-06-30",
      released_at: null,
      notes: "Public demo build for the README preview.",
      meta: {},
    },
  ];

  for (const issue of issues) {
    seedIssueDocument(
      vault,
      issue.reef_id,
      `## Demo note\n\n${issue.title} is part of the English README demo board.`,
    );
  }
  return vault;
}

export function rawVault(name) {
  return {
    id: `vault-${name}`,
    name,
    description: "Raw akb vault",
    status: "active",
    role: "owner",
    created_at: NOW,
    tables: new Set(),
    settings: new Map(),
    monitoredRepos: [],
    issues: [],
    documents: new Map(),
    documentHistory: new Map(),
    members: [],
    sprints: [],
    milestones: [],
    releases: [],
    templates: [],
    notifications: [],
    subscriptions: [],
    attachments: [],
    files: new Map(),
  };
}

/** Build a seeded reef_activity row (REEF-277). `at` is unique per event so it
 * doubles as a stable id seed and a sufficient event_key for dedup. */
function activityRow(reefId, eventType, at, payload) {
  return {
    id: uuidFor(at.replace(/\D/g, "").slice(-12)),
    reef_id: reefId,
    event_type: eventType,
    event_key: `${eventType}@${at}`,
    payload,
    meta: { actor: "alice", at, source: null },
    created_at: at,
    updated_at: at,
    created_by: "alice",
  };
}

function notificationKey(recipient, sourceType, sourceRef) {
  return `notification:${recipient.length}:${recipient}:${sourceType.length}:${sourceType}:${sourceRef.length}:${sourceRef}`;
}

function notificationRow({
  id,
  recipient,
  reefId,
  sourceType,
  sourceRef,
  eventType,
  actor,
  occurredAt,
  state,
}) {
  return {
    id: uuidFor(id),
    notification_key: notificationKey(recipient, sourceType, sourceRef),
    recipient,
    reef_id: reefId,
    source_type: sourceType,
    source_ref: sourceRef,
    event_type: eventType,
    actor,
    occurred_at: occurredAt,
    state,
    read_at: state === "read" ? occurredAt : null,
    archived_at: state === "archived" ? occurredAt : null,
    payload: null,
    meta: null,
  };
}

/**
 * Notification Inbox fixture: exactly 100 unread Alice rows exercises the
 * bounded badge contract, plus one read row for state controls and one Bob row
 * that must never appear in Alice's session-scoped response.
 */
function seedNotifications(vault) {
  vault.comments.push({
    id: "comment-primary",
    reef_id: "REEF-001",
    body: "@alice this comment is the mentioned source.",
    meta: {
      author: "bob",
      created_at: "2026-06-15T00:00:00.000Z",
      edited_at: null,
      mention_recipients: ["alice"],
    },
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    created_by: "bob",
  });
  vault.notifications = [];
  for (let index = 0; index < 99; index += 1) {
    const isIssueBodyMention = index === 98;
    const issue = isIssueBodyMention
      ? "REEF-001"
      : `REEF-${String((index % 3) + 1).padStart(3, "0")}`;
    vault.notifications.push(
      notificationRow({
        id: 7000 + index,
        recipient: "alice",
        reefId: issue,
        sourceType: "activity",
        sourceRef: isIssueBodyMention
          ? "issue_body_mentions_change:e2e-issue-body-commit"
          : `fixture-${index}`,
        eventType: isIssueBodyMention
          ? "issue_body_mentions_change"
          : "status_change",
        actor: "bob",
        occurredAt: isIssueBodyMention
          ? NOW
          : new Date(NOW_MS - (99 - index) * 60_000).toISOString(),
        state: "unread",
      }),
    );
  }
  vault.notifications.push(
    notificationRow({
      id: 7100,
      recipient: "alice",
      reefId: "REEF-001",
      sourceType: "comment",
      sourceRef: "comment-primary",
      eventType: "comment_created",
      actor: "bob",
      occurredAt: "2026-06-15T00:00:00.000Z",
      state: "unread",
    }),
    notificationRow({
      id: 7101,
      recipient: "alice",
      reefId: "REEF-002",
      sourceType: "activity",
      sourceRef: "read-primary",
      eventType: "priority_changed",
      actor: "bob",
      occurredAt: "2026-06-14T00:00:00.000Z",
      state: "read",
    }),
    notificationRow({
      id: 7102,
      recipient: "bob",
      reefId: "REEF-001",
      sourceType: "activity",
      sourceRef: "bob-only",
      eventType: "comment_created",
      actor: "alice",
      occurredAt: "2026-06-15T00:00:00.000Z",
      state: "unread",
    }),
  );
  seedIssueDocument(
    vault,
    "REEF-001",
    "Alpha description from fixture. Alice was mentioned in the issue body.",
  );
}

function issueRow(input) {
  return {
    document_uri: issueDocumentUri(REEF_VAULT, input.id),
    reef_id: input.id,
    title: input.title,
    status: input.status,
    issue_type: input.issue_type ?? "task",
    priority: input.priority ?? null,
    assigned_to: input.assigned_to ?? null,
    requester: input.requester ?? "alice",
    reporter: input.reporter ?? "alice",
    start_date: input.start_date ?? null,
    due_date: input.due_date ?? null,
    milestone_id: input.milestone_id ?? null,
    sprint_id: input.sprint_id ?? null,
    release_id: input.release_id ?? null,
    estimate_points: input.estimate_points ?? null,
    severity: input.severity ?? null,
    rank: input.rank ?? null,
    closed_at: input.closed_at ?? null,
    closed_reason: input.closed_reason ?? null,
    parent_id: input.parent_id ?? null,
    labels: input.labels ?? [],
    depends_on: input.depends_on ?? [],
    related_to: input.related_to ?? [],
    blocks: input.blocks ?? [],
    archived_at: input.archived_at ?? null,
    created_at: input.created_at ?? NOW,
    updated_at: NOW,
    meta: {
      author: input.author ?? "alice",
      last_editor: input.last_editor ?? "alice",
      source: input.source ?? "e2e:fixture",
      last_status_change: input.last_status_change ?? null,
      external_refs: input.external_refs ?? null,
      implementation_refs: input.implementation_refs ?? null,
      watchers: null,
      reviewers: null,
      qa_owner: null,
      custom_fields: null,
    },
  };
}

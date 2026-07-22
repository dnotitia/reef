#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const ALL_CATEGORIES = [
  "duplicates",
  "dead-code",
  "maintenance-lint",
  "large-files",
  "slow-tests",
  "comment-claims",
];

const CATEGORY_ALIASES = new Map([
  ["all", ALL_CATEGORIES],
  ["nightly", ALL_CATEGORIES],
  ["duplicates", ["duplicates"]],
  ["jscpd", ["duplicates"]],
  ["dead-code", ["dead-code"]],
  ["knip", ["dead-code"]],
  ["maintenance-lint", ["maintenance-lint"]],
  ["lint", ["maintenance-lint"]],
  ["eslint", ["maintenance-lint"]],
  ["large-files", ["large-files"]],
  ["large", ["large-files"]],
  ["oversized-files", ["large-files"]],
  ["oversized", ["large-files"]],
  ["slow-tests", ["slow-tests"]],
  ["test-profile", ["slow-tests"]],
  ["comment-claims", ["comment-claims"]],
  ["comments", ["comment-claims"]],
]);

const MAINTENANCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const LARGE_FILE_THRESHOLDS = {
  script: 600,
  source: 500,
  test: 700,
};

const SLOW_TEST_THRESHOLD_MS = 300;

const SLOW_TEST_SUPPRESSIONS = new Set([
  "ActivityItemCard ai_draft edits drafts with the shared issue draft field syntax",
  "RawArchive preserves prior versions and converges entry ordering",
  "useIssueFilterPersistence skips the restore's own marked write but saves the next user edit",
  "useIssueFilterPersistence scopes saves per vault",
  "IssueDetail keeps detail auto-save active after React StrictMode effect replay",
  "IssueDetail commits implementation refs from delivery activity edits",
  "IssueDetail commits blocks relationships from the detail panel",
  "useIssueFilterPersistence ignores searchQuery and selectedIssueId changes (filter object unchanged)",
  "useIssueFilterPersistence does not wipe the saved slot when the store is empty at mount",
  "IssueDetail keeps an earlier field's failure surfaced when a later, unrelated field saves",
  "NewIssueDialog confirms before discarding a dirty draft, then closes on confirm",
  "NewIssueDialog creates a parent-locked sub-issue with inherited defaults and keeps adding",
  "NewIssueDialog lets the user add external references while creating an issue",
  "agent artifact edit routes defines the edit command contract",
  "agent artifact dismiss routes defines the dismiss command contract",
  "useIssueFilterPersistence coalesces rapid changes into a single debounced write of the latest value",
  "useIssueFilterPersistence persists a filter change after the debounce window",
  "IssuesWorkspace persists a URL-applied filter as the last-used filter (REEF-009)",
  "agent artifact approve routes approves issue-create artifacts through the existing create flow",
  "IssuesWorkspace persists a user filter change made during the in-flight restore (REEF-009)",
  "useIssueFilterPersistence persists a filter already active for the vault at mount (URL-applied)",
  "useIssueFilterPersistence persists only sort when the user clears filters (clearFiltersOnly)",
  "GlobalSearchDialog previews recent issues from the server when open with no query",
  "GlobalSearchDialog fetches a complete id directly when the bounded page omits it",
  "POST /api/agents/runs chat streaming streams chat.workspace AgentRunEvent frames",
  "POST /api/agents/runs task execution streams issue.enrichment through the unified route",
  "POST /api/agents/runs validation returns typed runtime errors for invalid run requests",
  "IssueDetail retries every still-unsaved field (not the latest) before reporting Saved",
  "PlanningPage keeps Save enabled and validates a missing name inline",
  "GlobalSearchDialog sends the typed query to the server as `q` and highlights the match",
  "GlobalSearchDialog keeps a typed id-search bounded with a `limit` (no unbounded scan)",
  "BacklogView promotes a backlog issue to Todo via the inline status picker",
  "NewIssueDialog confirms discard when only an uncommitted child draft has content",
  "buildLoggerOptions — dev pretty vs prod JSON, redaction, error allowlist preserves the upstream status of a typed reef API error, not its detail (REEF-271)",
  "IssueDetail requests /api/issues/{id}?vault={vault} on mount",
  "IssueDetail asks for a close reason before closing from the detail panel",
  "i18n hardcoded-string guard matches the committed baseline (no new hardcoded JSX strings)",
]);

const PACKAGES_DIR = path.join(ROOT, "packages");

const LARGE_FILE_EXTRA_ROOTS = ["scripts"];

const LARGE_FILE_SUPPRESSIONS = new Map([
  [
    "packages/jira-migrator/src/related/import.test.ts",
    "Single public-stage reconciliation matrix sharing one stateful Jira/target harness; split by comments, attachments, and links when the harness is reusable without duplicating state semantics.",
  ],
  [
    "packages/web/src/components/MarkdownEditorImpl.test.tsx",
    "Single editor contract suite sharing one Tiptap chain mock; split interaction families when another editor surface reuses the mock harness.",
  ],
  [
    "packages/jira-migrator/src/archive/archive.ts",
    "Single raw-archive security boundary whose validation, permissions, manifest, and object-store helpers enforce one atomic API; extract helpers when a second archive implementation consumes them.",
  ],
  [
    "packages/jira-migrator/src/issues/mapping.ts",
    "Single immutable Jira issue-plan builder; extract a policy projector when another planner shares its field-resolution semantics.",
  ],
  [
    "packages/jira-migrator/src/jira/client.ts",
    "Single read-only Jira transport client; split pagination or binary streaming when another client implementation reuses those policies.",
  ],
  [
    "packages/jira-migrator/src/issues/changelog.ts",
    "Single changelog classification and projection pipeline; extract a classifier when another history source shares the same promoted/raw decision model.",
  ],
  [
    "packages/jira-migrator/src/content/adf.ts",
    "Single recursive ADF-to-Markdown renderer whose node helpers share escaping and reporting state; split node families when another renderer consumes them.",
  ],
  [
    "packages/core/src/adapters/akb/core/tables.ts",
    "Single AKB table lifecycle adapter keeping mutation schemas, verification, and provisioning together; split planning helpers when another adapter consumes them.",
  ],
  [
    "packages/jira-migrator/src/planning/entities.ts",
    "Single Version/Sprint planning projection with shared conflict and target-resolution rules; split entity helpers when their policies diverge or gain another consumer.",
  ],
  [
    "packages/jira-migrator/src/related/attachmentImport.ts",
    "Single attachment reconciliation transaction with ordered validation, revocation, write, and readback phases; extract a phase when another import surface reuses it.",
  ],
  [
    "packages/jira-migrator/src/accounts/mapping.ts",
    "Single account-mapping artifact pipeline sharing normalization and change-coalescing rules; extract resolution helpers when another mapping producer reuses them.",
  ],
  [
    "packages/web/src/features/issues/components/detail/IssueDetailSidebar.tsx",
    "Single detail metadata rail composing field leaves and autosave callbacks; extract a section when another detail surface shares it.",
  ],
  [
    "packages/web/tests/e2e/harness/mock-server.mjs",
    "Hermetic fixture backend; split when scenario handlers gain separate owners.",
  ],
  [
    "packages/web/src/features/issues/components/detail/IssueDetail.test.tsx",
    "Detail workflow regression suite; extract fixtures when a second detail suite needs them.",
  ],
  [
    "packages/web/src/features/issues/components/relations/IssueRelationInput.test.tsx",
    "Relation picker regression suite; extract render fixtures when another relation suite reuses them.",
  ],
  [
    "scripts/maintenance/scan.mjs",
    "Single CLI scanner orchestrator; split when a category grows its own configuration surface.",
  ],
  [
    "packages/core/src/agents/approveActivitySuggestion.test.ts",
    "Approval policy matrix; extract fixtures when another approval suite reuses them.",
  ],
  [
    "packages/core/src/adapters/akb.issue-activity.test.ts",
    "Activity append/readback regression suite; split key/diff/list groups when another activity suite reuses the setup.",
  ],
  [
    "packages/core/src/adapters/akb/issues/activity.ts",
    "Activity table adapter boundary; split key/diff/row conversion helpers when a second adapter consumes them.",
  ],
  [
    "packages/web/src/features/issues/components/relations/IssueRelationInput.tsx",
    "One composed relation picker; extract a leaf after another relation surface shares it.",
  ],
  [
    "packages/web/src/components/MarkdownEditor.tsx",
    "Single Tiptap editor wrapper; split when toolbar or extension config is reused elsewhere.",
  ],
  [
    "packages/web/src/components/MarkdownEditorImpl.tsx",
    "Cohesive Tiptap editor implementation; split when toolbar, link editing, or source mode gains a second owner.",
  ],
  [
    "packages/web/src/components/ui/combobox.tsx",
    "Shared combobox primitive kept together so option, trigger, and keyboard behavior evolve together.",
  ],
  [
    "packages/web/src/components/ui/multi-select-combobox.tsx",
    "Shared multi-select primitive; split placement or keyboard helpers when another primitive reuses them.",
  ],
  [
    "packages/web/src/features/issues/components/create/NewIssueDialog.tsx",
    "Create dialog composition; extract fields after a second create surface shares them.",
  ],
  [
    "packages/web/src/features/ui/components/DashboardShell.tsx",
    "App shell composition; extract nav badge or shortcut groups when another shell surface shares them.",
  ],
  [
    "packages/web/src/features/ui/components/DashboardShell.test.tsx",
    "Shell regression suite sharing one provider/mock setup for nav, badges, shortcuts, and dialogs; extract a platform-shortcut harness when another shell suite reuses it.",
  ],
  [
    "packages/web/src/features/issues/components/backlog/BacklogView.tsx",
    "Backlog page workflow; split when rank controls or empty states gain reuse.",
  ],
  [
    "packages/web/src/features/issues/components/refs/IssueRefsEditor.tsx",
    "Reference editor workflow; extract card/list pieces after reuse appears.",
  ],
  [
    "packages/web/src/features/issues/components/activity/timelineModel.ts",
    "Activity timeline projection model; split reconstructed-event helpers when another timeline surface consumes them.",
  ],
  [
    "packages/web/src/features/issues/components/activity/ActivityEventRow.tsx",
    "Single activity event-row renderer; split glyph or sentence leaves when another row surface reuses them.",
  ],
  [
    "packages/core/src/adapters/akb/workspace/auth.ts",
    "Workspace auth adapter boundary; split when SSO and password flows need separate owners.",
  ],
  [
    "packages/web/src/features/settings/components/TemplatesSection.tsx",
    "Templates settings workflow; extract rows/forms after another settings page shares them.",
  ],
  [
    "packages/web/src/app/globals.css",
    "Global Tailwind/theme token entrypoint; split when theme tokens or editor/task styles gain separate owners.",
  ],
]);

const GLOBSTAR = "**";

const DUPLICATE_SCAN_IGNORES = [
  `${GLOBSTAR}/node_modules/${GLOBSTAR}`,
  `${GLOBSTAR}/.next/${GLOBSTAR}`,
  `packages/web/src/components/ui/${GLOBSTAR}`,
  "packages/core/src/adapters/github.test.ts",
  "packages/core/src/adapters/akb/vaultSkill/vaultSkill.test.ts",
  "packages/core/src/agents/tools/repo/devReadFile.test.ts",
  "packages/core/src/agents/tools/repo/searchCode.test.ts",
  "packages/core/src/agents/tools/suggestion/suggestLabels.test.ts",
  "packages/core/src/agents/tools/suggestion/suggestPriority.test.ts",
  "packages/web/src/app/api/issues/reorder/route.test.ts",
  "packages/web/src/app/api/issues/route.test.ts",
  "packages/web/src/features/issues/components/backlog/BacklogView.test.tsx",
  "packages/web/src/features/issues/components/list/IssueListTable.test.tsx",
  "packages/web/src/features/issues/components/detail/IssueDetail.test.tsx",
  "packages/web/src/features/issues/components/detail/IssueChromeIdentity.test.tsx",
  "packages/web/src/features/issues/components/relations/IssueChildren.test.tsx",
  "packages/web/src/features/settings/components/AuthoringLanguageSection.test.tsx",
  "packages/web/src/features/settings/components/RepoPickerSection.test.tsx",
];

const EXCLUDED_DIRS = new Set([
  ".git",
  ".maintenance",
  ".next",
  ".pnpm-store",
  ".turbo",
  "build",
  "dist",
  "node_modules",
  "playwright-report",
  "storybook-static",
  "test-results",
]);

const CLAIM_PATTERNS = [
  {
    id: "absolute-wording",
    pattern:
      /\b(always|never|only|must|cannot|can't|no regression|source of truth)\b/i,
  },
  {
    id: "lifecycle-wording",
    pattern: /\b(forward-only|backward|reopen|terminal|rollback|regress)\b/i,
  },
  {
    id: "deprecated-or-legacy",
    pattern: /\b(@deprecated|deprecated|legacy|back-compat|compatibility)\b/i,
  },
  {
    id: "stale-doc-reference",
    pattern: /\b(FR\d+|NFR\d+|Story \d|architecture\.md|Dev Agent Record)\b/i,
  },
  {
    id: "todo-debt",
    pattern: /\b(TODO|FIXME|HACK)\b/,
  },
  {
    id: "korean-lifecycle-wording",
    pattern: /(되돌|뒤로|불가능|항상|절대)/,
  },
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function usage() {
  return `Usage: pnpm run maintenance:scan -- [category] [options]

Categories:
  all | nightly          Run all advisory maintenance scans.
  duplicates | jscpd     Run duplicate-code detection.
  dead-code | knip       Run dead-code and unused export/dependency detection.
  maintenance-lint       Run React Compiler and deprecation lint diagnostics.
  large-files            Report oversized source, test, and script files.
  slow-tests             Run Vitest JSON reports with slow-test threshold.
  comment-claims         Scan comments for claims that need verification.

Options:
  --out-dir <path>       Write reports to a specific directory.
  --dry-run              Write planned commands without executing them.
  --strict               Exit non-zero if any external scanner exits non-zero.
  --assert-clean         Exit non-zero if any scanner fails or reports findings.
  --help                 Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    assertClean: false,
    categories: [],
    dryRun: false,
    outDir: null,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--assert-clean") {
      options.assertClean = true;
      continue;
    }
    if (arg === "--out-dir") {
      options.outDir = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out-dir=")) {
      options.outDir = arg.slice("--out-dir=".length);
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const categories = CATEGORY_ALIASES.get(arg);
    if (!categories) {
      throw new Error(`Unknown maintenance category: ${arg}`);
    }
    options.categories.push(...categories);
  }

  if (options.categories.length === 0) {
    options.categories.push(...ALL_CATEGORIES);
  }

  if (options.assertClean && options.dryRun) {
    throw new Error("--assert-clean cannot be used with --dry-run");
  }

  options.categories = [...new Set(options.categories)];
  return options;
}

function displayPath(filePath) {
  const relative = path.relative(ROOT, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return filePath;
}

function packageStepKey(packageDir) {
  return path.basename(packageDir).replace(/[^a-zA-Z0-9-]/g, "-");
}

async function readPackageManifest(packageDir) {
  try {
    return JSON.parse(
      await readFile(path.join(packageDir, "package.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

async function listWorkspacePackages() {
  if (!(await pathExists(PACKAGES_DIR))) return [];
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(PACKAGES_DIR, entry.name);
    if (!(await pathExists(path.join(packageDir, "package.json")))) continue;

    const manifest = await readPackageManifest(packageDir);
    const relativeDir = displayPath(packageDir);
    const srcRoot = path.join(relativeDir, "src");
    const testRoot = path.join(relativeDir, "tests");
    packages.push({
      dir: packageDir,
      key: packageStepKey(packageDir),
      manifest,
      name:
        typeof manifest.name === "string" && manifest.name
          ? manifest.name
          : relativeDir,
      relativeDir,
      srcRoot: (await pathExists(path.join(packageDir, "src")))
        ? srcRoot
        : null,
      testRoot: (await pathExists(path.join(packageDir, "tests")))
        ? testRoot
        : null,
    });
  }

  packages.sort((left, right) =>
    left.relativeDir.localeCompare(right.relativeDir),
  );
  return packages;
}

async function workspaceSourceRoots() {
  return (await listWorkspacePackages())
    .map((workspacePackage) => workspacePackage.srcRoot)
    .filter(Boolean);
}

async function workspaceTestRoots() {
  return (await listWorkspacePackages())
    .map((workspacePackage) => workspacePackage.testRoot)
    .filter(Boolean);
}

async function largeFileRoots() {
  return [
    ...(await workspaceSourceRoots()),
    ...(await workspaceTestRoots()),
    ...LARGE_FILE_EXTRA_ROOTS,
  ];
}

function packageHasVitestTestScript(workspacePackage) {
  const testScript = workspacePackage.manifest.scripts?.test;
  return typeof testScript === "string" && /\bvitest\b/.test(testScript);
}

function commandLine(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

async function runCommand({
  args,
  command = "pnpm",
  dryRun,
  name,
  outDir,
  primaryOutputPath = null,
}) {
  const stepDir = path.join(outDir, name);
  await mkdir(stepDir, { recursive: true });

  const stdoutPath = path.join(stepDir, "stdout.txt");
  const stderrPath = path.join(stepDir, "stderr.txt");
  const commandPath = path.join(stepDir, "command.txt");
  const renderedCommand = commandLine(command, args);
  await writeFile(commandPath, `${renderedCommand}\n`);

  if (dryRun) {
    return {
      command: renderedCommand,
      code: null,
      name,
      status: "dry-run",
      rawStdoutPath: displayPath(stdoutPath),
      stderrPath: displayPath(stderrPath),
      stdoutPath: displayPath(primaryOutputPath ?? stdoutPath),
    };
  }

  const startedAt = new Date();
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);

    child.on("error", (error) => {
      stdout.end();
      stderr.end();
      resolve({
        command: renderedCommand,
        code: null,
        durationMs: Date.now() - startedAt.getTime(),
        error: error.message,
        name,
        rawStdoutPath: displayPath(stdoutPath),
        status: "error",
        stderrPath: displayPath(stderrPath),
        stdoutPath: displayPath(primaryOutputPath ?? stdoutPath),
      });
    });

    child.on("close", (code) => {
      stdout.end();
      stderr.end();
      resolve({
        command: renderedCommand,
        code,
        durationMs: Date.now() - startedAt.getTime(),
        name,
        rawStdoutPath: displayPath(stdoutPath),
        status: code === 0 ? "ok" : "nonzero",
        stderrPath: displayPath(stderrPath),
        stdoutPath: displayPath(primaryOutputPath ?? stdoutPath),
      });
    });
  });
}

async function runDuplicates({ dryRun, outDir }) {
  const reportDir = path.join(outDir, "duplicates-jscpd", "report");
  const roots = await workspaceSourceRoots();
  return [
    await runCommand({
      args: [
        "exec",
        "jscpd",
        ...roots,
        "--pattern",
        "**/*.{ts,tsx}",
        "--ignore",
        DUPLICATE_SCAN_IGNORES.join(","),
        "--min-lines",
        "20",
        "--min-tokens",
        "150",
        "--reporters",
        "json,markdown",
        "--output",
        reportDir,
      ],
      dryRun,
      name: "duplicates-jscpd",
      outDir,
      primaryOutputPath: reportDir,
    }),
  ];
}

async function runDeadCode({ dryRun, outDir }) {
  return [
    await runCommand({
      args: ["exec", "knip", "--reporter", "json", "--max-show-issues", "50"],
      dryRun,
      name: "dead-code-knip",
      outDir,
    }),
  ];
}

async function runMaintenanceLint({ dryRun, outDir }) {
  const jsonPath = path.join(
    outDir,
    "maintenance-eslint",
    "eslint-report.json",
  );
  const roots = await workspaceSourceRoots();
  return [
    await runCommand({
      args: [
        "exec",
        "eslint",
        "--config",
        "eslint.maintenance.config.mjs",
        "--format",
        "json",
        "--output-file",
        jsonPath,
        ...roots,
      ],
      dryRun,
      name: "maintenance-eslint",
      outDir,
      primaryOutputPath: jsonPath,
    }),
  ];
}

async function runSlowTests({ dryRun, outDir }) {
  const testPackages = (await listWorkspacePackages()).filter(
    packageHasVitestTestScript,
  );
  const steps = [];

  for (const workspacePackage of testPackages) {
    const stepName = `slow-tests-${workspacePackage.key}`;
    const outputPath = path.join(outDir, stepName, "vitest.json");
    steps.push(
      await runCommand({
        args: [
          "--filter",
          workspacePackage.name,
          "exec",
          "vitest",
          "run",
          "--reporter=json",
          `--outputFile=${outputPath}`,
          `--slowTestThreshold=${SLOW_TEST_THRESHOLD_MS}`,
        ],
        dryRun,
        name: stepName,
        outDir,
        primaryOutputPath: outputPath,
      }),
    );
  }

  return steps;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(startDir, options = {}, results = []) {
  const { extensions = MAINTENANCE_EXTENSIONS, skipUiComponents = false } =
    options;
  if (!(await pathExists(startDir))) return results;
  const entries = await readdir(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (
        skipUiComponents &&
        displayPath(fullPath) === "packages/web/src/components/ui"
      ) {
        continue;
      }
      await walkFiles(fullPath, options, results);
      continue;
    }
    if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function matchingClaimIds(text) {
  return CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ id }) => id,
  );
}

function findLineCommentIndex(line) {
  let fromIndex = 0;
  while (fromIndex < line.length) {
    const index = line.indexOf("//", fromIndex);
    if (index < 0) return -1;
    if (index === 0 || line[index - 1] !== ":") return index;
    fromIndex = index + 2;
  }
  return -1;
}

function pushCandidate(candidates, filePath, line, text) {
  const matches = matchingClaimIds(text);
  if (matches.length === 0) return;
  candidates.push({
    excerpt: text.trim().replace(/\s+/g, " ").slice(0, 260),
    file: displayPath(filePath),
    line,
    matches,
  });
}

function scanCommentText(filePath, content) {
  const candidates = [];
  const lines = content.split(/\r?\n/);
  let inBlock = false;
  let blockStart = 0;
  let blockLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (inBlock) {
      blockLines.push(line);
      if (line.includes("*/")) {
        pushCandidate(candidates, filePath, blockStart, blockLines.join("\n"));
        inBlock = false;
        blockLines = [];
      }
      continue;
    }

    const lineCommentIndex = findLineCommentIndex(line);
    const blockCommentIndex = line.indexOf("/*");
    const hasLineComment = lineCommentIndex >= 0;
    const hasBlockComment = blockCommentIndex >= 0;

    if (
      hasBlockComment &&
      (!hasLineComment || blockCommentIndex < lineCommentIndex)
    ) {
      const blockRemainder = line.slice(blockCommentIndex);
      if (blockRemainder.includes("*/")) {
        pushCandidate(candidates, filePath, lineNumber, blockRemainder);
      } else {
        inBlock = true;
        blockStart = lineNumber;
        blockLines = [blockRemainder];
      }
      continue;
    }

    if (hasLineComment) {
      pushCandidate(
        candidates,
        filePath,
        lineNumber,
        line.slice(lineCommentIndex),
      );
    }
  }

  if (inBlock) {
    pushCandidate(candidates, filePath, blockStart, blockLines.join("\n"));
  }

  return candidates;
}

async function runCommentClaims({ dryRun, outDir }) {
  const stepDir = path.join(outDir, "comment-claims");
  await mkdir(stepDir, { recursive: true });
  const commandPath = path.join(stepDir, "command.txt");
  const renderedCommand = "native comment-claim scan";
  await writeFile(commandPath, `${renderedCommand}\n`);

  if (dryRun) {
    return [
      {
        command: renderedCommand,
        code: null,
        name: "comment-claims",
        status: "dry-run",
        stdoutPath: displayPath(path.join(stepDir, "comment-claims.json")),
      },
    ];
  }

  const sourceRoots = await workspaceSourceRoots();
  const files = [
    ...(
      await Promise.all(
        sourceRoots.map((root) =>
          walkFiles(path.join(ROOT, root), {
            skipUiComponents: true,
          }),
        ),
      )
    ).flat(),
    ...(await walkFiles(path.join(ROOT, "scripts"))),
  ].sort();

  const candidates = [];
  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    candidates.push(...scanCommentText(filePath, content));
  }

  const jsonPath = path.join(stepDir, "comment-claims.json");
  const mdPath = path.join(stepDir, "comment-claims.md");
  await writeFile(
    jsonPath,
    `${JSON.stringify({ candidates, count: candidates.length }, null, 2)}\n`,
  );
  await writeFile(mdPath, renderCommentClaims(candidates));

  return [
    {
      command: "native comment-claim scan",
      code: 0,
      name: "comment-claims",
      status: "ok",
      summary: `${candidates.length} candidate comments`,
      stdoutPath: displayPath(jsonPath),
    },
  ];
}

function renderCommentClaims(candidates) {
  const lines = [
    "# Comment Claim Candidates",
    "",
    "These are not automatic failures. Treat each row as a claim that needs",
    "verification against the adjacent code path, tests, and docs.",
    "",
    `Total candidates: ${candidates.length}`,
    "",
    "| File | Line | Match | Excerpt |",
    "| --- | ---: | --- | --- |",
  ];

  for (const candidate of candidates.slice(0, 200)) {
    lines.push(
      `| ${candidate.file} | ${candidate.line} | ${candidate.matches.join(
        ", ",
      )} | ${candidate.excerpt.replaceAll("|", "\\|")} |`,
    );
  }

  if (candidates.length > 200) {
    lines.push("");
    lines.push(`Showing 200 of ${candidates.length} candidates.`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function countLines(content) {
  if (content.length === 0) return 0;
  const newlineCount = content.match(/\n/g)?.length ?? 0;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function classifyLargeFile(filePath) {
  const file = displayPath(filePath);
  if (file.startsWith("scripts/")) return "script";
  if (
    /(^|\/)__tests__\//.test(file) ||
    /(^|\/)tests\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  ) {
    return "test";
  }
  return "source";
}

function largeFileSuggestion(candidate) {
  if (candidate.kind === "test") {
    return "Check repeated setup, fixtures, render helpers, and scenario groups before splitting assertions.";
  }
  if (candidate.kind === "script") {
    return "Check whether CLI parsing, scanning, rendering, and orchestration have separate owners.";
  }
  if (candidate.file.endsWith(".tsx")) {
    return "Check whether state, effects, UI leaves, and formatting helpers can move behind named boundaries.";
  }
  return "Check whether schemas, adapters, pure helpers, and side-effect boundaries can be separated.";
}

function largeFileReasons(candidate) {
  const reasons = [
    `${candidate.lines} lines >= ${candidate.threshold} ${candidate.kind} threshold`,
  ];
  if (candidate.nonBlankLines >= Math.floor(candidate.threshold * 0.8)) {
    reasons.push("dense-file");
  }
  if (candidate.file.endsWith(".tsx")) {
    reasons.push("tsx-surface");
  }
  return reasons;
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

async function readJsonForAssert(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(await readFile(filePath, "utf8")),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

function countEslintMessages(report) {
  if (!Array.isArray(report)) return 0;
  return report.reduce(
    (total, fileReport) => total + (fileReport.messages?.length ?? 0),
    0,
  );
}

function countSlowTests(report) {
  if (!Array.isArray(report?.testResults)) return 0;
  return report.testResults.reduce((total, fileResult) => {
    const assertions = fileResult.assertionResults ?? [];
    return (
      total +
      assertions.filter(
        (assertion) =>
          (assertion.duration ?? 0) > SLOW_TEST_THRESHOLD_MS &&
          !SLOW_TEST_SUPPRESSIONS.has(assertion.fullName),
      ).length
    );
  }, 0);
}

function assertPath(outDir, category, suffix) {
  return path.join(outDir, category, suffix);
}

async function slowTestReportPaths(outDir) {
  const entries = await readdir(outDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("slow-tests-"),
    )
    .map((entry) => path.join(outDir, entry.name, "vitest.json"))
    .sort();
}

async function countCategoryFindings(category, outDir) {
  switch (category) {
    case "duplicates": {
      const filePath = assertPath(
        outDir,
        "duplicates-jscpd",
        "report/jscpd-report.json",
      );
      const parsed = await readJsonForAssert(filePath);
      return parsed.ok
        ? {
            count: parsed.value.duplicates?.length ?? 0,
            detail: displayPath(filePath),
            status: "ok",
          }
        : {
            count: 0,
            detail: `${displayPath(filePath)}: ${parsed.error}`,
            status: "error",
          };
    }
    case "dead-code": {
      const filePath = assertPath(outDir, "dead-code-knip", "stdout.txt");
      const parsed = await readJsonForAssert(filePath);
      return parsed.ok
        ? {
            count: parsed.value.issues?.length ?? 0,
            detail: displayPath(filePath),
            status: "ok",
          }
        : {
            count: 0,
            detail: `${displayPath(filePath)}: ${parsed.error}`,
            status: "error",
          };
    }
    case "maintenance-lint": {
      const filePath = assertPath(
        outDir,
        "maintenance-eslint",
        "eslint-report.json",
      );
      const parsed = await readJsonForAssert(filePath);
      return parsed.ok
        ? {
            count: countEslintMessages(parsed.value),
            detail: displayPath(filePath),
            status: "ok",
          }
        : {
            count: 0,
            detail: `${displayPath(filePath)}: ${parsed.error}`,
            status: "error",
          };
    }
    case "large-files": {
      const filePath = assertPath(outDir, "large-files", "large-files.json");
      const parsed = await readJsonForAssert(filePath);
      return parsed.ok
        ? {
            count: parsed.value.count ?? parsed.value.candidates?.length ?? 0,
            detail: displayPath(filePath),
            status: "ok",
          }
        : {
            count: 0,
            detail: `${displayPath(filePath)}: ${parsed.error}`,
            status: "error",
          };
    }
    case "slow-tests": {
      const reportPaths = await slowTestReportPaths(outDir);
      const reports = await Promise.all(reportPaths.map(readJsonForAssert));
      const failures = reports
        .map((report, index) =>
          report.ok
            ? null
            : `${displayPath(reportPaths[index])}: ${report.error}`,
        )
        .filter(Boolean);
      if (failures.length > 0) {
        return {
          count: 0,
          detail: failures.join("; "),
          status: "error",
        };
      }
      return {
        count: reports.reduce(
          (total, report) => total + countSlowTests(report.value),
          0,
        ),
        detail:
          reportPaths.length > 0
            ? reportPaths.map(displayPath).join(", ")
            : "no slow-test reports",
        status: "ok",
      };
    }
    case "comment-claims": {
      const filePath = assertPath(
        outDir,
        "comment-claims",
        "comment-claims.json",
      );
      const parsed = await readJsonForAssert(filePath);
      return parsed.ok
        ? {
            count: parsed.value.count ?? parsed.value.candidates?.length ?? 0,
            detail: displayPath(filePath),
            status: "ok",
          }
        : {
            count: 0,
            detail: `${displayPath(filePath)}: ${parsed.error}`,
            status: "error",
          };
    }
    default:
      return {
        count: 0,
        detail: `Unhandled category: ${category}`,
        status: "error",
      };
  }
}

async function buildAssertClean(report) {
  const categories = [];
  for (const category of report.categories) {
    const scannerFailed = category.steps.some(
      (step) => step.status !== "ok" && step.status !== "dry-run",
    );
    const findingResult = await countCategoryFindings(
      category.name,
      report.outDir,
    );
    const status =
      findingResult.status === "error"
        ? "error"
        : findingResult.count > 0
          ? "findings"
          : scannerFailed
            ? "error"
            : "clean";
    categories.push({
      detail: findingResult.detail,
      findings: findingResult.count,
      name: category.name,
      scannerFailed,
      status,
    });
  }

  const failed = categories.some((category) => category.status !== "clean");
  return { categories, failed };
}

async function runLargeFiles({ dryRun, outDir }) {
  const stepDir = path.join(outDir, "large-files");
  await mkdir(stepDir, { recursive: true });
  const jsonPath = path.join(stepDir, "large-files.json");
  const mdPath = path.join(stepDir, "large-files.md");
  const commandPath = path.join(stepDir, "command.txt");
  const roots = await largeFileRoots();
  const renderedCommand = `native large-file scan (${Object.entries(
    LARGE_FILE_THRESHOLDS,
  )
    .map(([kind, threshold]) => `${kind}>=${threshold}`)
    .join(", ")})`;
  await writeFile(commandPath, `${renderedCommand}\n`);

  if (dryRun) {
    return [
      {
        command: renderedCommand,
        code: null,
        name: "large-files",
        status: "dry-run",
        stdoutPath: displayPath(jsonPath),
      },
    ];
  }

  const files = (
    await Promise.all(roots.map((root) => walkFiles(path.join(ROOT, root))))
  )
    .flat()
    .sort();

  const candidates = [];
  const suppressed = [];
  for (const filePath of files) {
    const file = displayPath(filePath);
    const kind = classifyLargeFile(filePath);
    const threshold = LARGE_FILE_THRESHOLDS[kind];
    const content = await readFile(filePath, "utf8");
    const lines = countLines(content);
    if (lines < threshold) continue;

    const candidate = {
      file,
      kind,
      key: `large-files:${file}`,
      lines,
      nonBlankLines: content.split(/\r?\n/).filter((line) => line.trim())
        .length,
      threshold,
    };
    const suppressionReason = LARGE_FILE_SUPPRESSIONS.get(file);
    if (suppressionReason) {
      suppressed.push({ ...candidate, suppressionReason });
      continue;
    }
    candidate.reasons = largeFileReasons(candidate);
    candidate.suggestedReview = largeFileSuggestion(candidate);
    candidates.push(candidate);
  }

  candidates.sort(
    (left, right) =>
      right.lines - left.lines || left.file.localeCompare(right.file),
  );
  suppressed.sort(
    (left, right) =>
      right.lines - left.lines || left.file.localeCompare(right.file),
  );

  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        candidates,
        count: candidates.length,
        scannedRoots: roots,
        suppressed,
        suppressedCount: suppressed.length,
        thresholds: LARGE_FILE_THRESHOLDS,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(mdPath, renderLargeFiles(candidates, suppressed));

  return [
    {
      command: renderedCommand,
      code: 0,
      name: "large-files",
      status: "ok",
      summary: `${candidates.length} candidate files`,
      stdoutPath: displayPath(jsonPath),
    },
  ];
}

function renderLargeFiles(candidates, suppressed) {
  const lines = [
    "# Large File Candidates",
    "",
    "These are not automatic refactor requests. Treat each row as a cohesion",
    "review: verify whether the file has separate responsibilities before",
    "extracting modules, helpers, fixtures, or hooks.",
    "",
    `Total candidates: ${candidates.length}`,
    "",
    "| File | Kind | Lines | Nonblank | Threshold | Reasons | Suggested review |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
  ];

  for (const candidate of candidates.slice(0, 200)) {
    lines.push(
      `| ${candidate.file} | ${candidate.kind} | ${candidate.lines} | ${
        candidate.nonBlankLines
      } | ${candidate.threshold} | ${candidate.reasons.join(", ")} | ${markdownCell(
        candidate.suggestedReview,
      )} |`,
    );
  }

  if (candidates.length > 200) {
    lines.push("");
    lines.push(`Showing 200 of ${candidates.length} candidates.`);
  }

  if (suppressed.length > 0) {
    lines.push("");
    lines.push("## Suppressed");
    lines.push("");
    lines.push("| File | Kind | Lines | Reason |");
    lines.push("| --- | --- | ---: | --- |");
    for (const candidate of suppressed) {
      lines.push(
        `| ${candidate.file} | ${candidate.kind} | ${
          candidate.lines
        } | ${markdownCell(candidate.suppressionReason)} |`,
      );
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function runCategory(category, context) {
  switch (category) {
    case "duplicates":
      return await runDuplicates(context);
    case "dead-code":
      return await runDeadCode(context);
    case "maintenance-lint":
      return await runMaintenanceLint(context);
    case "large-files":
      return await runLargeFiles(context);
    case "slow-tests":
      return await runSlowTests(context);
    case "comment-claims":
      return await runCommentClaims(context);
    default:
      throw new Error(`Unhandled category: ${category}`);
  }
}

function renderSummary(report) {
  const lines = [
    "# Maintenance Scan Summary",
    "",
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Out dir: ${displayPath(report.outDir)}`,
    `Dry run: ${report.dryRun ? "yes" : "no"}`,
    `Assert clean: ${report.assertClean ? "yes" : "no"}`,
    "",
    "Scanner exits are advisory unless `--strict` is used. A non-zero scanner",
    "exit can mean findings were reported, not necessarily that the scan failed.",
    "",
    "## Results",
    "",
    "| Category | Step | Status | Code | Output |",
    "| --- | --- | --- | ---: | --- |",
  ];

  for (const category of report.categories) {
    for (const step of category.steps) {
      lines.push(
        `| ${category.name} | ${step.name} | ${step.status} | ${
          step.code ?? ""
        } | ${step.stdoutPath ?? ""} |`,
      );
    }
  }

  if (report.assertCleanResult) {
    lines.push("");
    lines.push("## Assert Clean");
    lines.push("");
    lines.push(
      report.assertCleanResult.failed
        ? "Result: failed — actionable findings or scanner errors remain."
        : "Result: passed — no actionable findings were detected.",
    );
    lines.push("");
    lines.push("| Category | Status | Findings | Detail |");
    lines.push("| --- | --- | ---: | --- |");
    for (const category of report.assertCleanResult.categories) {
      lines.push(
        `| ${category.name} | ${category.status} | ${category.findings} | ${markdownCell(
          category.detail,
        )} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Loop Use");
  lines.push("");
  lines.push("1. Build a queue of candidate findings from these reports.");
  lines.push("2. Verify each finding against real code paths before editing.");
  lines.push(
    "3. Drive each finding to a terminal state and rescan until dry, per",
  );
  lines.push("   `docs/maintenance.md`.");
  lines.push("4. The work is done when no non-terminal finding remains.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  const outDir = path.resolve(
    options.outDir ?? path.join(ROOT, ".maintenance", "reports", timestamp()),
  );
  await mkdir(outDir, { recursive: true });

  const report = {
    assertClean: options.assertClean,
    assertCleanResult: null,
    categories: [],
    dryRun: options.dryRun,
    finishedAt: null,
    outDir,
    startedAt: new Date().toISOString(),
    strict: options.strict,
  };

  for (const category of options.categories) {
    const steps = await runCategory(category, {
      dryRun: options.dryRun,
      outDir,
    });
    report.categories.push({ name: category, steps });
  }

  report.finishedAt = new Date().toISOString();
  if (options.assertClean) {
    report.assertCleanResult = await buildAssertClean(report);
    await writeFile(
      path.join(outDir, "assert-clean.json"),
      `${JSON.stringify(report.assertCleanResult, null, 2)}\n`,
    );
  }
  await writeFile(
    path.join(outDir, "summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(path.join(outDir, "summary.md"), renderSummary(report));

  const nonzero = report.categories.some(({ steps }) =>
    steps.some((step) => step.status !== "ok" && step.status !== "dry-run"),
  );
  if (options.strict && nonzero) {
    process.exitCode = 1;
  }
  if (options.assertClean && report.assertCleanResult?.failed) {
    process.exitCode = 1;
  }

  console.log(`Maintenance report written to ${displayPath(outDir)}`);
  if (options.assertClean && report.assertCleanResult?.failed) {
    console.error("Maintenance assert-clean failed:");
    for (const category of report.assertCleanResult.categories) {
      if (category.status === "clean") continue;
      console.error(
        `- ${category.name}: ${category.status}, findings=${category.findings}, ${category.detail}`,
      );
    }
  }
}

await main();

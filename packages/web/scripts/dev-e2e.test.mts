// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_READINESS_INTERACTIONS,
  buildReadyPayload,
  buildRuntimeCommand,
  getClientReadinessInputs,
  parseOptions,
  probeWorkspaceClickInteractions,
  validateResetBody,
  validateScenario,
  writeReadyFile,
} from "./dev-e2e.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("dev:e2e runtime contract", () => {
  it("pre-builds the runtime workspace through the canonical Turbo graph", () => {
    expect(buildRuntimeCommand()).toMatchObject({
      args: ["exec", "turbo", "run", "build", "--filter=@reef/web"],
    });
    expect(buildRuntimeCommand().command).toMatch(/^pnpm(?:\.cmd)?$/u);
  });

  it("accepts a source-owned scenario and an explicit ready-file path", () => {
    const options = parseOptions(
      ["--ready-file", "/tmp/reef-ready.json", "--", "comment_mentions"],
      {
        NODE_ENV: "test",
        REEF_WEB_URL: "http://localhost:9135",
        REEF_E2E_MOCK_URL: "http://127.0.0.1:9136",
      },
    );

    expect(options).toMatchObject({
      scenario: "comment_mentions",
      readyFile: "/tmp/reef-ready.json",
      webOrigin: "http://localhost:9135",
      webPort: "9135",
      fixtureOrigin: "http://127.0.0.1:9136",
      fixtureHost: "127.0.0.1",
      fixturePort: "9136",
    });
  });

  it("keeps scenario validation safe while letting the fixture define support", () => {
    expect(validateScenario("future_fixture_scenario")).toBe(
      "future_fixture_scenario",
    );
    expect(
      validateResetBody(
        { ok: true, scenario: "comment_mentions" },
        "comment_mentions",
      ),
    ).toMatchObject({ scenario: "comment_mentions" });
    expect(validateScenario("future-fixture-scenario")).toBe(
      "future-fixture-scenario",
    );
    expect(() => validateScenario("../comment_mentions")).toThrow(
      /letters, numbers/,
    );
    expect(() =>
      validateResetBody(
        { ok: true, scenario: "configured" },
        "future_fixture_scenario",
      ),
    ).toThrow(/rejected scenario/);
  });

  it("requires the fixture's browser login and workspace entrypoint contract", () => {
    expect(
      getClientReadinessInputs(
        {
          status: "ready",
          fixture_login: {
            username: "alice",
            password: "fixture-password",
            login_path: "/login?password=1",
          },
          tasks: {
            chat: {
              scenario: "configured",
              start_path: "/workspace/reef-e2e/issues",
            },
            notifications: {
              scenario: "notifications",
              start_path: "/workspace/reef-e2e/inbox",
            },
          },
        },
        "configured",
      ),
    ).toEqual({
      username: "alice",
      password: "fixture-password",
      loginPath: "/login?password=1",
      startPath: "/workspace/reef-e2e/issues",
    });
    expect(
      getClientReadinessInputs(
        {
          status: "ready",
          fixture_login: {
            username: "alice",
            password: "fixture-password",
            login_path: "/login?password=1",
          },
          tasks: {
            chat: {
              scenario: "configured",
              start_path: "/workspace/reef-e2e/issues",
            },
            notifications: {
              scenario: "notifications",
              start_path: "/workspace/reef-e2e/inbox",
            },
          },
        },
        "notifications",
      ),
    ).toMatchObject({ startPath: "/workspace/reef-e2e/inbox" });
    expect(() =>
      getClientReadinessInputs(
        {
          status: "ready",
          fixture_login: { username: "alice" },
          tasks: {
            chat: {
              scenario: "configured",
              start_path: "/workspace/reef-e2e/issues",
            },
          },
        },
        "configured",
      ),
    ).toThrow(/fixture login password/);
  });

  it("resolves the planning overflow task start path", () => {
    expect(
      getClientReadinessInputs(
        {
          status: "ready",
          fixture_login: {
            username: "alice",
            password: "fixture-password",
            login_path: "/login?password=1",
          },
          tasks: {
            planning_overflow: {
              scenario: "planning_overflow",
              start_path: "/workspace/reef-e2e/issues?view=list",
            },
          },
        },
        "planning_overflow",
      ),
    ).toMatchObject({
      startPath: "/workspace/reef-e2e/issues?view=list",
    });
  });

  it("resolves the demo board issue-drill entrypoint", () => {
    expect(
      getClientReadinessInputs(
        {
          status: "ready",
          fixture_login: {
            username: "alice",
            password: "fixture-password",
            login_path: "/login?password=1",
          },
          tasks: {
            issue_drill_navigation: {
              scenario: "demo_board",
              workspace: "reef-e2e",
              start_path: "/workspace/reef-e2e/issues?view=list",
            },
          },
        },
        "demo_board",
      ),
    ).toMatchObject({
      username: "alice",
      password: "fixture-password",
      loginPath: "/login?password=1",
      startPath: "/workspace/reef-e2e/issues?view=list",
    });
  });

  function readinessPage({
    newIssueClickWorks = true,
    issueDetailOpen = false,
    issueDetailAppearanceDelayMs,
    issueDetailLoaded,
    issueDetailCloseWorks = true,
  }: {
    newIssueClickWorks?: boolean;
    issueDetailOpen?: boolean;
    issueDetailAppearanceDelayMs?: number;
    issueDetailLoaded?: boolean;
    issueDetailCloseWorks?: boolean;
  } = {}) {
    const state = {
      newIssueOpen: false,
      issueDetailOpen,
      issueDetailLoaded: issueDetailLoaded ?? issueDetailOpen,
    };
    const selectors: string[] = [];
    let issueDetailAppearance: Promise<void> | undefined;
    const scheduleIssueDetailAppearance = () => {
      if (
        issueDetailAppearanceDelayMs === undefined ||
        issueDetailAppearance !== undefined
      ) {
        return;
      }
      issueDetailAppearance = new Promise((resolve) => {
        setTimeout(() => {
          state.issueDetailOpen = true;
          state.issueDetailLoaded = true;
          resolve();
        }, issueDetailAppearanceDelayMs);
      });
    };
    const locatorFor = (selector: string) => {
      const locator = {
        first: () => locator,
        isVisible: async () => {
          if (
            selector === CLIENT_READINESS_INTERACTIONS.issueDetail.observable
          ) {
            scheduleIssueDetailAppearance();
            return state.issueDetailLoaded;
          }
          if (selector === CLIENT_READINESS_INTERACTIONS.issueDetail.close) {
            return state.issueDetailOpen;
          }
          return selector === CLIENT_READINESS_INTERACTIONS.newIssue.observable
            ? state.newIssueOpen
            : true;
        },
        waitFor: async ({ state: expected }: { state: string }) => {
          if (
            (selector ===
              CLIENT_READINESS_INTERACTIONS.issueDetail.observable ||
              selector === CLIENT_READINESS_INTERACTIONS.issueDetail.close) &&
            expected === "visible"
          ) {
            scheduleIssueDetailAppearance();
            await issueDetailAppearance;
          } else if (
            selector === CLIENT_READINESS_INTERACTIONS.newIssue.trigger
          ) {
            await issueDetailAppearance;
          }
          const visible =
            selector === CLIENT_READINESS_INTERACTIONS.newIssue.observable
              ? state.newIssueOpen
              : selector ===
                  CLIENT_READINESS_INTERACTIONS.issueDetail.observable
                ? state.issueDetailLoaded
                : selector === CLIENT_READINESS_INTERACTIONS.issueDetail.close
                  ? state.issueDetailOpen
                  : true;
          if ((expected === "visible") !== visible) {
            throw new Error(`${selector} is not ${expected}`);
          }
        },
        click: async () => {
          if (selector === CLIENT_READINESS_INTERACTIONS.newIssue.trigger) {
            if (!state.issueDetailOpen && newIssueClickWorks) {
              state.newIssueOpen = true;
            }
          } else if (
            selector === CLIENT_READINESS_INTERACTIONS.newIssue.close
          ) {
            state.newIssueOpen = false;
          } else if (
            selector === CLIENT_READINESS_INTERACTIONS.issueDetail.close
          ) {
            if (issueDetailCloseWorks) {
              state.issueDetailOpen = false;
              state.issueDetailLoaded = false;
            }
          }
        },
      };
      return locator;
    };

    return {
      selectors,
      page: {
        locator(selector: string) {
          selectors.push(selector);
          return locatorFor(selector);
        },
      },
    };
  }

  it("waits for a delayed direct issue detail before probing the workspace click", async () => {
    const { page, selectors } = readinessPage({
      issueDetailAppearanceDelayMs: 5,
    });

    await probeWorkspaceClickInteractions(page, 1_000, {
      startPath: "/workspace/reef-e2e/issues/example",
    });

    expect(selectors).toEqual([
      CLIENT_READINESS_INTERACTIONS.issueDetail.observable,
      CLIENT_READINESS_INTERACTIONS.issueDetail.close,
      CLIENT_READINESS_INTERACTIONS.newIssue.trigger,
      CLIENT_READINESS_INTERACTIONS.newIssue.observable,
      CLIENT_READINESS_INTERACTIONS.newIssue.close,
    ]);
  });

  it("requires an ordinary workspace click to produce observable state", async () => {
    const { page, selectors } = readinessPage();

    await probeWorkspaceClickInteractions(page, 1_000);

    expect(selectors).toEqual([
      CLIENT_READINESS_INTERACTIONS.newIssue.trigger,
      CLIENT_READINESS_INTERACTIONS.newIssue.observable,
      CLIENT_READINESS_INTERACTIONS.newIssue.close,
    ]);
  });

  it("fails readiness when the ordinary workspace click is a no-op", async () => {
    await expect(
      probeWorkspaceClickInteractions(
        readinessPage({ newIssueClickWorks: false }).page,
        1_000,
      ),
    ).rejects.toThrow(/New Issue dialog after click/);
  });

  it("honors an issue-detail start path before probing workspace clicks", async () => {
    const { page, selectors } = readinessPage({ issueDetailOpen: true });

    await probeWorkspaceClickInteractions(page, 1_000, {
      startPath: "/workspace/reef-e2e/issues/REEF-001",
    });

    expect(selectors).toEqual([
      CLIENT_READINESS_INTERACTIONS.issueDetail.observable,
      CLIENT_READINESS_INTERACTIONS.issueDetail.close,
      CLIENT_READINESS_INTERACTIONS.newIssue.trigger,
      CLIENT_READINESS_INTERACTIONS.newIssue.observable,
      CLIENT_READINESS_INTERACTIONS.newIssue.close,
    ]);
  });

  it("does not treat the issue change-review route as an issue-detail start", async () => {
    const { page, selectors } = readinessPage();

    await probeWorkspaceClickInteractions(page, 1_000, {
      startPath:
        "/workspace/reef-e2e/issues/changes?start_at=2026-06-15T00:00:00.000Z&end_at=2026-06-19T00:00:00.000Z&tz=UTC",
    });

    expect(selectors).toEqual([
      CLIENT_READINESS_INTERACTIONS.newIssue.trigger,
      CLIENT_READINESS_INTERACTIONS.newIssue.observable,
      CLIENT_READINESS_INTERACTIONS.newIssue.close,
    ]);
  });

  it("fails readiness when the declared issue-detail start cannot close", async () => {
    await expect(
      probeWorkspaceClickInteractions(
        readinessPage({
          issueDetailCloseWorks: false,
          issueDetailOpen: true,
        }).page,
        1_000,
        { startPath: "/workspace/reef-e2e/issues/REEF-001" },
      ),
    ).rejects.toThrow(/declared issue detail start close/);
  });

  it("does not treat the issue-detail shell as visible before content loads", async () => {
    await expect(
      probeWorkspaceClickInteractions(
        readinessPage({ issueDetailOpen: true, issueDetailLoaded: false }).page,
        1_000,
        { startPath: "/workspace/reef-e2e/issues/REEF-001" },
      ),
    ).rejects.toThrow(/declared issue detail start/);
  });

  it("writes a private runtime ready descriptor", async () => {
    const root = await mkdtemp(join(tmpdir(), "reef-dev-e2e-contract-test-"));
    temporaryDirectories.push(root);
    const readyFile = join(root, "ready.json");
    const payload = buildReadyPayload({
      webOrigin: "http://localhost:9135",
      fixtureOrigin: "http://127.0.0.1:9136",
      scenario: "comment_mentions",
    });

    await writeReadyFile(readyFile, payload);

    expect(payload).toEqual({
      schema_version: 2,
      status: "ready",
      scenario: "comment_mentions",
      services: {
        web: {
          origin: "http://localhost:9135",
          health: { method: "GET", url: "http://localhost:9135" },
          readiness: { mode: "browser", status: "ready" },
        },
        fixture: {
          origin: "http://127.0.0.1:9136",
          health: {
            method: "GET",
            url: "http://127.0.0.1:9136/__e2e/health",
          },
          reset: {
            method: "POST",
            url: "http://127.0.0.1:9136/__e2e/reset",
            content_type: "application/json",
            body: { scenario: "comment_mentions" },
          },
          discovery: {
            method: "GET",
            url: "http://127.0.0.1:9136/__e2e/runtime",
          },
        },
      },
    });
    expect(Object.keys(payload)).not.toContain("pid");
    expect(Object.keys(payload)).not.toContain("candidate_head");
    expect(JSON.parse(await readFile(readyFile, "utf8"))).toEqual(payload);
    expect((await stat(readyFile)).mode & 0o077).toBe(0);
  });
});

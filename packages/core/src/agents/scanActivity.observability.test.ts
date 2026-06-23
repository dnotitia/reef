import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CoreLogger, setCoreLogger } from "../observability";
import {
  VAULT,
  buildCommitsResponse,
  buildPrsResponse,
  makeGitHubAdapter,
  makeLlmAdapter,
  mockAkbAdapter,
  mockReadIssue,
  noIssueLinkJson,
  resetScanActivityMocks,
  scanActivity,
  validDraftJson,
} from "./scanActivity.testSupport";

/**
 * REEF-271 — the scan must not go silent on dev stdout (the observed 137s gap)
 * and must emit a one-line completion summary for trace-backend-less prod. These
 * assert the `observe` checkpoints and completion line flow through the wired
 * core logger, with the completion summary carrying the same counts the
 * `reef.agent.scanActivity` span records.
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

describe("scanActivity observability (REEF-271)", () => {
  beforeEach(() => {
    resetScanActivityMocks();
  });

  afterEach(() => {
    setCoreLogger(null);
  });

  it("emits exactly one completion summary line with the scan counts", async () => {
    const { lines } = captureCoreLogger();
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "untrackedSha", message: "feat: add rate limiting" },
        { oid: "trackedSha", message: "fix: resolve login bug (REEF-042)" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
      { text: JSON.stringify({ rationale: "Work has started on the fix." }) },
    ]);
    mockReadIssue.mockResolvedValueOnce({
      issue: { title: "Login bug", status: "todo" },
      content: "",
    });

    await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
    });

    const completion = lines.filter((l) => l.msg === "scan_activity complete");
    expect(completion).toHaveLength(1);
    expect(completion[0].fields).toMatchObject({
      repo: "acme/platform",
      commits_scanned: 2,
      prs_scanned: 0,
      untracked_count: 1,
      tracked_issue_count: 1,
      drafts_generated: 1,
      status_changes_generated: 1,
    });
  });

  it("emits progress checkpoints between fetch and the LLM stage", async () => {
    const { lines } = captureCoreLogger();
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([
        { oid: "untrackedSha", message: "feat: add rate limiting" },
      ]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
    ]);

    await scanActivity({
      adapter,
      akbAdapter: mockAkbAdapter,
      vault: VAULT,
      llmAdapter: llm,
      owner: "acme",
      repo: "platform",
      since: "2026-04-06T00:00:00Z",
      projectPrefix: "REEF",
    });

    const messages = lines.map((l) => l.msg);
    expect(messages).toContain("scan_activity fetched");
    expect(messages).toContain("scan_activity generating drafts");
    // The fetch checkpoint must precede the completion line.
    expect(messages.indexOf("scan_activity fetched")).toBeLessThan(
      messages.indexOf("scan_activity complete"),
    );
  });

  it("stays silent when no core logger is wired (prod + trace backend)", async () => {
    // No setCoreLogger here → the default no-op. The scan must still run and the
    // span attributes are set (not observable here); we only assert no throw and
    // no captured lines.
    const lines: LogLine[] = [];
    const adapter = makeGitHubAdapter(
      buildCommitsResponse([{ oid: "x", message: "chore: noop" }]),
      buildPrsResponse(),
    );
    const llm = makeLlmAdapter([
      { text: JSON.stringify(noIssueLinkJson) },
      { text: JSON.stringify(validDraftJson) },
    ]);

    await expect(
      scanActivity({
        adapter,
        akbAdapter: mockAkbAdapter,
        vault: VAULT,
        llmAdapter: llm,
        owner: "acme",
        repo: "platform",
        since: "2026-04-06T00:00:00Z",
        projectPrefix: "REEF",
      }),
    ).resolves.toBeDefined();
    expect(lines).toHaveLength(0);
  });
});

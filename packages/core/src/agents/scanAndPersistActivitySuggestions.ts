import {
  type AkbAdapter,
  akbEnsureReefTables,
  akbListActivitySuggestions,
  akbReadAuthoringLanguage,
  akbReadConfig,
  akbWriteActivitySuggestion,
} from "../adapters";
import type { GitHubAdapter } from "../adapters/github";
import type { LlmAdapter } from "../adapters/llm";
import {
  draftToActivitySuggestion,
  statusChangeToActivitySuggestion,
} from "../models";
import type {
  PendingDraft,
  PendingStatusChange,
} from "../schemas/activity/pendingDraft";
import type { ActivitySuggestion } from "../schemas/activity/suggestion";
import type { AgentRunEvent } from "./framework/events";
import { scanActivity } from "./scanActivity";
import { type RepoRef, assertRepoAllowed } from "./tools/repo/allowlist";

export interface ScanAndPersistActivitySuggestionsParams {
  adapter: GitHubAdapter;
  akbAdapter: AkbAdapter;
  vault: string;
  llmAdapter: LlmAdapter;
  owner: string;
  repo: string;
  since?: string;
  projectPrefix: string;
  onEvent?: (event: AgentRunEvent) => void | Promise<void>;
  isAborted?: () => boolean;
}

export interface CompletedActivitySuggestionScan {
  status: "completed";
  drafts: PendingDraft[];
  statusChanges: PendingStatusChange[];
  persistedSuggestions: ActivitySuggestion[];
  addedDrafts: number;
  addedStatusChanges: number;
  scannedAt: string;
}

export interface AbortedActivitySuggestionScan {
  status: "aborted";
  drafts: PendingDraft[];
  statusChanges: PendingStatusChange[];
  persistedSuggestions: ActivitySuggestion[];
  addedDrafts: number;
  addedStatusChanges: number;
  scannedAt: string;
}

export type ScanAndPersistActivitySuggestionsResult =
  | CompletedActivitySuggestionScan
  | AbortedActivitySuggestionScan;

export async function scanAndPersistActivitySuggestions(
  params: ScanAndPersistActivitySuggestionsParams,
): Promise<ScanAndPersistActivitySuggestionsResult> {
  const {
    adapter,
    akbAdapter,
    vault,
    llmAdapter,
    owner,
    repo,
    since,
    projectPrefix,
    onEvent,
    isAborted,
  } = params;

  const empty = emptyResult();
  if (isAborted?.()) return { ...empty, status: "aborted" };

  // Boundary check FIRST (REEF-289): reject a scan of any repo this vault does
  // not monitor before any GitHub read or akb write happens. Manual scan,
  // agent-run, and any future worker all funnel through this one path, so the
  // guard lives here rather than in each thin route.
  await assertScanRepoMonitored({ akbAdapter, vault, owner, repo });
  if (isAborted?.()) return { ...empty, status: "aborted" };

  await akbEnsureReefTables({ adapter: akbAdapter, vault });
  if (isAborted?.()) return { ...empty, status: "aborted" };

  const existing = await akbListActivitySuggestions({
    adapter: akbAdapter,
    vault,
  });
  if (isAborted?.()) return { ...empty, status: "aborted" };

  const authoringLanguage = await akbReadAuthoringLanguage({
    adapter: akbAdapter,
    vault,
  });
  if (isAborted?.()) return { ...empty, status: "aborted" };

  const result = await scanActivity({
    adapter,
    akbAdapter,
    vault,
    llmAdapter,
    owner,
    repo,
    ...(since ? { since } : {}),
    projectPrefix,
    authoringLanguage,
    dismissedRefs: existing.suggestions.flatMap(suggestionDismissKeys),
    onEvent,
  });
  if (isAborted?.()) {
    return {
      ...emptyResult(result.drafts, result.statusChanges),
      status: "aborted",
    };
  }

  const persistedSuggestions = [
    ...(await Promise.all(result.drafts.map(draftToActivitySuggestion))),
    ...(await Promise.all(
      result.statusChanges.map(statusChangeToActivitySuggestion),
    )),
  ];

  let addedDrafts = 0;
  let addedStatusChanges = 0;
  const writtenSuggestions: ActivitySuggestion[] = [];
  for (const suggestion of persistedSuggestions) {
    if (isAborted?.()) {
      return {
        status: "aborted",
        drafts: result.drafts,
        statusChanges: result.statusChanges,
        persistedSuggestions: writtenSuggestions,
        addedDrafts,
        addedStatusChanges,
        scannedAt: new Date().toISOString(),
      };
    }
    await akbWriteActivitySuggestion({
      adapter: akbAdapter,
      vault,
      suggestion,
    });
    writtenSuggestions.push(suggestion);
    if (suggestion.kind === "draft") addedDrafts++;
    else addedStatusChanges++;
  }

  return {
    status: "completed",
    drafts: result.drafts,
    statusChanges: result.statusChanges,
    persistedSuggestions: writtenSuggestions,
    addedDrafts,
    addedStatusChanges,
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Reject a scan whose requested `owner`/`repo` is not one of the active vault's
 * `monitored_repos` (REEF-289).
 *
 * Since REEF-240 the scan runs on a server-managed GitHub App installation token
 * that can read every repository the App is installed on — far beyond what this
 * vault monitors. Without this gate an authenticated workspace user could point
 * `/api/activity/scan` (or the `activity.scan` agent run) at an arbitrary
 * App-installed repo and pull its commit/PR activity into their inbox. This
 * enforces the same single-source monitored-repo boundary that chat's repo tools
 * (`assertRepoAllowed`, REEF-243) and issue enrichment
 * (`resolveVerifiedRepoContext`) already apply.
 *
 * Fail closed: a config-read failure or an empty `monitored_repos` rejects the
 * scan rather than letting it proceed unbounded — a security boundary must not
 * fail open. Throws `SchemaValidationError` for an unmonitored repo, which the
 * route translates to a PM-facing 422 (and the agent run surfaces as a
 * structured error).
 */
async function assertScanRepoMonitored({
  akbAdapter,
  vault,
  owner,
  repo,
}: {
  akbAdapter: AkbAdapter;
  vault: string;
  owner: string;
  repo: string;
}): Promise<void> {
  const { config } = await akbReadConfig({ adapter: akbAdapter, vault });
  const allowedRepos: RepoRef[] = config.monitored_repos.map((monitored) => ({
    owner: monitored.owner,
    repo: monitored.name,
  }));
  assertRepoAllowed(allowedRepos, owner, repo);
}

function suggestionDismissKeys(suggestion: ActivitySuggestion): string[] {
  if (suggestion.kind === "draft") {
    return [
      `${suggestion.provenance.repo}:${suggestion.provenance.type}:${suggestion.provenance.ref}`,
    ];
  }
  return suggestion.evidence.map((e) => `${e.repo}:${e.type}:${e.ref}`);
}

function emptyResult(
  drafts: PendingDraft[] = [],
  statusChanges: PendingStatusChange[] = [],
): Omit<ScanAndPersistActivitySuggestionsResult, "status"> {
  return {
    drafts,
    statusChanges,
    persistedSuggestions: [],
    addedDrafts: 0,
    addedStatusChanges: 0,
    scannedAt: new Date().toISOString(),
  };
}

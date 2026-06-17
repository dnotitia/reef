import {
  type AkbAdapter,
  akbEnsureReefTables,
  akbListActivitySuggestions,
  akbReadAuthoringLanguage,
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

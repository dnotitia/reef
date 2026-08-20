"use client";

import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { TypePill } from "@/components/fields/TypePill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnrichmentReviewBar } from "@/features/ai/components/EnrichmentReviewBar";
import { ChatSurface } from "@/features/ai/components/ChatSurface";
import { useWorkspaceChat } from "@/features/ai/hooks/useWorkspaceChat";
import type { AgentRunFetch } from "@/features/ai/runtime/types";
import { useCreateIssue } from "@/features/issues/hooks/mutations/useCreateIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { fetchVaultDocumentSearch } from "@/features/issues/hooks/queries/useVaultDocumentSearch";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useVaultRoster } from "@/features/settings/hooks/useVaultRoster";
import {
  ensureProjectConfig,
  useProjectConfig,
} from "@/features/settings/hooks/useProjectConfig";
import {
  type NewIssueDialogContext,
  useViewStore,
} from "@/features/ui/stores/useViewStore";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { akbDocumentSlugTitle } from "@/lib/akb/documentUri";
import { VAULT_HEADER } from "@/lib/akb/headers";
import { apiFetch } from "@/lib/apiClient";
import { withVault } from "@/lib/workspaceHref";
import { DEFAULT_CONFIG } from "@reef/core";
import type {
  DocumentSearchHit,
  EnrichmentRepoContext,
  IssueCreateInput,
  IssueListItem,
  IssueType,
  ReferenceSuggestion,
  Template,
} from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ISSUE_TYPE_OPTIONS, NO_SELECTION } from "../../lib/metadataOptions";
import { IssueRefsEditor } from "../refs/IssueRefsEditor";
import { IssueFieldRow } from "../shared/IssueFieldRow";
import { SimilarIssuesSection } from "../shared/SimilarIssuesSection";
import { DiscardDraftDialog } from "./DiscardDraftDialog";
import { EnrichmentReferencesPanel } from "./EnrichmentReferencesPanel";
import { IssueDraftFields } from "./IssueDraftFields";
import { NewIssueRailFields } from "./NewIssueRailFields";
import { NewIssueRelationFields } from "./NewIssueRelationFields";
import { TemplatePicker } from "./TemplatePicker";
import { useNewIssueEnrichment } from "./useNewIssueEnrichment";
import {
  type NewIssueFormDefaults,
  useNewIssueFormState,
} from "./useNewIssueFormState";

/**
 * Modal dialog for creating a new issue.
 *
 * Reads the active `vault` and `project_prefix` from IndexedDB, builds a
 * `{ fields, content }` create payload, and calls useCreateIssue which posts
 * to /api/issues. The route handler allocates the issue ID server-side.
 *
 * Open/close is owned by useViewStore so any toolbar button or keyboard
 * shortcut in the shell can trigger it.
 */
function getSubIssueDefaults(
  context: NewIssueDialogContext,
): NewIssueFormDefaults {
  return {
    priority: context.defaults.priority,
    sprintId: context.defaults.sprintId,
    milestoneId: context.defaults.milestoneId,
    parentId: context.parent.id,
    labels: [...context.defaults.labels],
  };
}

export function NewIssueDialog({
  focusOriginRef: pendingFocusOriginRef,
}: {
  focusOriginRef?: { current: HTMLElement | null };
} = {}) {
  const open = useViewStore((s) => s.newIssueDialogOpen);
  const dialogContext = useViewStore((s) => s.newIssueDialogContext);
  const closeDialog = useViewStore((s) => s.closeNewIssueDialog);
  const { vault } = useActiveVault();
  const router = useRouter();
  const t = useTranslations("toasts");
  const tc = useTranslations("issues.create");
  const common = useTranslations("common");
  const markdownEditor = useTranslations("markdownEditor");
  const fieldNames = useFieldNameLabels();
  const createMutation = useCreateIssue();
  const queryClient = useQueryClient();
  // Display prefix; the submit handler re-fetches the canonical value
  // via ensureProjectConfig so a cold load does not use a stale prefix.
  const configQuery = useProjectConfig(vault ?? "");
  const prefix =
    configQuery.data?.config.project_prefix ?? DEFAULT_CONFIG.project_prefix;
  const { data: vaultMembers = [] } = useVaultRoster(vault ?? "");
  const subIssueContext =
    dialogContext?.kind === "subIssue" ? dialogContext : null;

  const {
    title,
    setTitle,
    issueType,
    setIssueType,
    priority,
    setPriority,
    assignee,
    setAssignee,
    requester,
    setRequester,
    reporter,
    setReporter,
    startDate,
    setStartDate,
    dueDate,
    setDueDate,
    milestoneId,
    setMilestoneId,
    sprintId,
    setSprintId,
    releaseId,
    setReleaseId,
    estimatePoints,
    setEstimatePoints,
    severity,
    setSeverity,
    parentId,
    setParentId,
    labels,
    setLabels,
    dependsOn,
    setDependsOn,
    blocks,
    setBlocks,
    relatedTo,
    setRelatedTo,
    externalRefs,
    setExternalRefs,
    references,
    setReferences,
    body,
    setBody,
    formApi,
    resetFields,
    buildCreateFields,
  } = useNewIssueFormState();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createAnother, setCreateAnother] = useState(false);
  // Discard-confirmation for an in-progress draft (REEF-075 / WIG warn-before-
  // unsaved). Shown when the dialog is dismissed while the form has content.
  const [discardOpen, setDiscardOpen] = useState(false);
  // AI-suggested references the PM dismissed this session (hidden from the
  // candidate list); accepted ones move into form `references` instead.
  const [dismissedRefs, setDismissedRefs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // AI reference candidates captured into local state so closing the suggestion
  // bar (which resets enrichMutation) doesn't discard documents the PM hasn't
  // accepted or dismissed yet.
  const [referenceCandidates, setReferenceCandidates] = useState<
    ReferenceSuggestion[]
  >([]);
  const [chatOpen, setChatOpen] = useState(false);
  // Focus target for the first invalid field on a failed submit (validation is
  // surfaced inline, not as a toast — see handleSubmit).
  const titleInputRef = useRef<HTMLInputElement>(null);
  const seededContextRef = useRef<typeof dialogContext | undefined>(undefined);
  const focusOriginRef = useRef<HTMLElement | null>(null);

  // Local issue list still drives relation pickers; enrichment now fetches its
  // own AKB context server-side so the prompt sees a consistent workspace view.
  const { data: existingIssues } = useIssueList(vault ?? "");
  // Whole-vault relation graph for accurate blocked badges in the relation dropdowns.
  const { data: relations } = useIssueRelations(vault ?? "");
  const chatFetch = useMemo<AgentRunFetch>(
    () => (input, init) =>
      apiFetch(input, {
        ...init,
        headers: {
          ...((init?.headers as Record<string, string> | undefined) ?? {}),
          ...(vault ? { [VAULT_HEADER]: vault } : {}),
        },
      }),
    [vault],
  );
  const chatDraft: IssueCreateInput = (() => {
    const fields = buildCreateFields({
      fallbackTitle: "(untitled)",
      status: subIssueContext && sprintId ? "todo" : undefined,
    });
    if (subIssueContext) fields.parent_id = subIssueContext.parent.id;
    return { fields, content: body };
  })();
  const knownIssueIds = useMemo(
    () => new Set((existingIssues ?? []).map((issue) => issue.id)),
    [existingIssues],
  );
  const workspaceChat = useWorkspaceChat({
    fetch: chatFetch,
    route: null,
    reefId: null,
    draft: chatDraft,
  });
  // Optional GitHub grounding for enrichment code tools. Labels come from AKB
  // vault context; the first deployment-managed monitored repository enables
  // read-only code search.
  const repoContext: EnrichmentRepoContext | undefined = configQuery.data
    ?.config.monitored_repos[0]
    ? {
        owner: configQuery.data.config.monitored_repos[0].owner,
        repo: configQuery.data.config.monitored_repos[0].name,
      }
    : undefined;

  const {
    enrichment,
    enrichMutation,
    enrichError,
    enrichIsEmpty,
    showEnrichmentBar,
    buildEnrichmentRequest,
    handleAcceptAll,
    handleEnrichClick,
    renderEnrichable,
    renderFieldLabel,
  } = useNewIssueEnrichment({
    vault,
    prefix,
    repoContext,
    title,
    body,
    estimatePoints,
    formApi,
    buildCreateFields,
    setSubmitError,
    setReferenceCandidates,
  });

  // AI-proposed documents not yet accepted into `references` or dismissed.
  const candidateReferences = useMemo(
    () =>
      referenceCandidates.filter(
        (suggestion) =>
          !references.includes(suggestion.uri) &&
          !dismissedRefs.has(suggestion.uri),
      ),
    [referenceCandidates, references, dismissedRefs],
  );
  const issueBodyMentionConfig = useMemo(
    () =>
      vault
        ? {
            members: vaultMembers,
            issues: existingIssues ?? [],
            searchDocuments: (query: string, signal: AbortSignal) =>
              fetchVaultDocumentSearch(query, vault, signal),
            suggestionsLabel: markdownEditor("mentionSuggestions"),
            mentionOptionLabel: (username: string) =>
              markdownEditor("mentionOption", { username: `@${username}` }),
            peopleSectionLabel: markdownEditor("peopleSection"),
            issuesSectionLabel: markdownEditor("issuesSection"),
            documentsSectionLabel: markdownEditor("documentsSection"),
            issueOptionLabel: (issue: IssueListItem) =>
              markdownEditor("issueOption", {
                id: issue.id,
                title: issue.title,
              }),
            documentOptionLabel: (hit: DocumentSearchHit) =>
              markdownEditor("documentOption", {
                title: hit.title ?? akbDocumentSlugTitle(hit.uri),
              }),
            documentSearchLoadingLabel: markdownEditor("documentSearchLoading"),
            documentSearchErrorLabel: markdownEditor("documentSearchError"),
            documentSearchEmptyLabel: markdownEditor("documentSearchEmpty"),
          }
        : undefined,
    [existingIssues, markdownEditor, vault, vaultMembers],
  );

  function resetForm() {
    resetFields();
    setSubmitError(null);
    setChatOpen(false);
    workspaceChat.clear();
    setCreateAnother(false);
    setDismissedRefs(new Set());
    setReferenceCandidates([]);
    enrichment.reset();
    enrichMutation.reset();
    createMutation.reset();
  }

  useEffect(() => {
    if (!open) {
      seededContextRef.current = undefined;
      return;
    }
    if (seededContextRef.current === dialogContext) return;
    resetFields(
      dialogContext?.kind === "subIssue"
        ? getSubIssueDefaults(dialogContext)
        : undefined,
    );
    setSubmitError(null);
    setChatOpen(false);
    workspaceChat.clear();
    seededContextRef.current = dialogContext;
  }, [dialogContext, open, resetFields, workspaceChat.clear]);

  function handleApplyTemplate(template: Template) {
    // Prefix the existing title when the user hasn't typed one yet —
    // avoids producing "Bug: Bug: …" on a re-pick. The body consistently overwrites:
    // re-picking a template is an explicit "give me this skeleton" gesture.
    if (template.title_prefix && !title.trim()) {
      setTitle(template.title_prefix);
    }
    setBody(template.body);
    if (template.priority) {
      setPriority(template.priority);
    }
    if (template.default_labels.length > 0) {
      setLabels(template.default_labels);
    }
    setSubmitError(null);
    // No success toast: the applied title/body/priority/labels are immediately
    // visible in the form, so a toast would be redundant noise.
  }

  // Committed form state the user would lose by closing now.
  const hasCommittedDraft =
    title.trim() !== "" ||
    body.trim() !== "" ||
    issueType !== "task" ||
    priority !== NO_SELECTION ||
    assignee !== "" ||
    requester !== "" ||
    reporter !== "" ||
    startDate !== "" ||
    dueDate !== "" ||
    milestoneId !== "" ||
    sprintId !== "" ||
    releaseId !== "" ||
    estimatePoints.trim() !== "" ||
    severity !== "" ||
    parentId !== "" ||
    labels.length > 0 ||
    dependsOn.length > 0 ||
    blocks.length > 0 ||
    relatedTo.length > 0 ||
    externalRefs.length > 0 ||
    references.length > 0;

  // Wraps the form body so the close path can also catch text buffered inside
  // child controls before it is committed — a label typed but not yet entered,
  // a relation search, and especially an external reference URL/title typed but
  // not yet added. Those live in child-local state, not the form values above,
  // so `hasCommittedDraft` alone would miss them and let the dialog discard
  // typed content silently. Reading `.value` on close (not during render) is a
  // cheap, framework-agnostic way to include every such buffered input.
  const formBodyRef = useRef<HTMLDivElement>(null);
  function hasBufferedText(): boolean {
    const root = formBodyRef.current;
    if (!root) return false;
    return Array.from(root.querySelectorAll("input, textarea")).some(
      (el) =>
        (el as HTMLInputElement | HTMLTextAreaElement).value.trim() !== "",
    );
  }
  // Any content the user would lose by closing now — committed values plus
  // uncommitted text still sitting in a child input.
  function hasUnsavedDraft(): boolean {
    return hasCommittedDraft || hasBufferedText();
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      closeDialog();
      resetForm();
    }
  }

  useLayoutEffect(() => {
    if (!open || focusOriginRef.current?.isConnected) return;
    const active = document.activeElement;
    focusOriginRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  function handleOpenAutoFocus() {
    const active = document.activeElement;
    const pendingOrigin = pendingFocusOriginRef?.current;
    focusOriginRef.current = pendingOrigin?.isConnected
      ? pendingOrigin
      : focusOriginRef.current?.isConnected
        ? focusOriginRef.current
        : active instanceof HTMLElement && active !== document.body
          ? active
          : null;
  }

  function handleCloseAutoFocus(event: Event) {
    event.preventDefault();
    const origin = pendingFocusOriginRef?.current ?? focusOriginRef.current;
    if (pendingFocusOriginRef) pendingFocusOriginRef.current = null;
    focusOriginRef.current = null;
    const fallback = document.querySelector<HTMLElement>(
      "[data-command-focus-destination]",
    );
    const destination = origin?.isConnected ? origin : fallback;
    destination?.focus({ preventScroll: true });
  }

  // A dismiss request (Cancel / Escape / outside click). Confirms first when the
  // draft has content; an untouched form (or a submit in flight) closes directly.
  function requestClose() {
    if (isSubmitting) return;
    if (hasUnsavedDraft()) {
      setDiscardOpen(true);
      return;
    }
    closeDialog();
    resetForm();
  }

  async function handleSubmit() {
    setSubmitError(null);

    if (!vault) {
      setSubmitError(tc("workspaceRequired"));
      return;
    }
    if (!title.trim()) {
      setSubmitError(tc("titleRequired"));
      // Move focus to the first invalid field so the inline error is actionable.
      titleInputRef.current?.focus();
      return;
    }
    if (estimatePoints.trim() && Number.isNaN(Number(estimatePoints.trim()))) {
      setSubmitError(tc("estimateNaN"));
      return;
    }

    const fields = buildCreateFields({
      status: subIssueContext && sprintId ? "todo" : undefined,
    });
    if (subIssueContext) {
      fields.parent_id = subIssueContext.parent.id;
    }

    let canonicalPrefix: string;
    try {
      const { config } = await ensureProjectConfig(queryClient, vault);
      canonicalPrefix = config.project_prefix;
    } catch (err) {
      const message =
        err instanceof Error
          ? tc("configLoadErrorDetail", { message: err.message })
          : tc("configLoadError");
      setSubmitError(message);
      return;
    }

    try {
      const { issue, failed_references: failedReferences } =
        await createMutation.mutateAsync({
          vault,
          prefix: canonicalPrefix,
          create: { fields, content: body },
          ...(references.length > 0 ? { references } : {}),
        });
      const failedCount = failedReferences?.length ?? 0;
      if (failedCount > 0) {
        toast.warning(
          t("issueCreatedWithDocFailures", {
            id: issue.id,
            count: failedCount,
          }),
        );
      } else if (issue.status === "backlog") {
        // Read-back: a new issue lands in `backlog` by default (REEF-130), which
        // the default board view hides (it floors to the active statuses). Name
        // where it went so the create doesn't look like it silently vanished.
        toast.success(t("issueAddedToBacklog", { id: issue.id }), {
          description: t("issueAddedToBacklogDescription"),
        });
      } else {
        toast.success(t("issueCreated", { id: issue.id }));
      }
      if (subIssueContext && createAnother) {
        resetFields(getSubIssueDefaults(subIssueContext));
        setSubmitError(null);
        setDismissedRefs(new Set());
        setReferenceCandidates([]);
        enrichment.reset();
        enrichMutation.reset();
        createMutation.reset();
        requestAnimationFrame(() => titleInputRef.current?.focus());
        return;
      }
      closeDialog();
      resetForm();
      router.push(withVault(vault, `/issues/${issue.id}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : tc("createError");
      setSubmitError(message);
    }
  }

  const isSubmitting = createMutation.isPending;
  const noVault = !vault;
  // Right-rail metadata (People / Planning), mirroring the issue detail sidebar.
  const railFields = (
    <NewIssueRailFields
      vault={vault ?? ""}
      isSubmitting={isSubmitting}
      assignee={assignee}
      requester={requester}
      reporter={reporter}
      startDate={startDate}
      dueDate={dueDate}
      estimatePoints={estimatePoints}
      severity={severity}
      sprintId={sprintId}
      milestoneId={milestoneId}
      releaseId={releaseId}
      setAssignee={setAssignee}
      setRequester={setRequester}
      setReporter={setReporter}
      setStartDate={setStartDate}
      setDueDate={setDueDate}
      setEstimatePoints={setEstimatePoints}
      setSeverity={setSeverity}
      setSprintId={setSprintId}
      setMilestoneId={setMilestoneId}
      setReleaseId={setReleaseId}
      renderEnrichable={renderEnrichable}
      renderFieldLabel={renderFieldLabel}
    />
  );
  // Parent / Relations live in the rail. Create still does not expose an
  // editable Sub-issues list before the issue exists.
  const relationFields = (
    <NewIssueRelationFields
      isSubmitting={isSubmitting}
      existingIssues={existingIssues ?? []}
      relations={relations}
      parentId={parentId}
      dependsOn={dependsOn}
      blocks={blocks}
      relatedTo={relatedTo}
      setParentId={setParentId}
      setDependsOn={setDependsOn}
      setBlocks={setBlocks}
      setRelatedTo={setRelatedTo}
      lockedParent={subIssueContext?.parent}
      renderEnrichable={renderEnrichable}
      renderFieldLabel={renderFieldLabel}
    />
  );
  const externalRefFields = renderEnrichable(
    "external_refs",
    <IssueRefsEditor
      externalRefs={externalRefs}
      implementationRefs={[]}
      onExternalRefsChange={setExternalRefs}
      disabled={isSubmitting}
      idPrefix="new-issue-refs"
    />,
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="new-issue-dialog"
        // The header already owns the top-right action row (template picker +
        // Enrich with AI). The shared close X overlaps those actions, and the
        // footer Cancel / Escape / outside-click / post-submit redirect all
        // still dismiss — so this dialog opts out of the built-in close X.
        showCloseButton={false}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        // Canvas matches the issue detail sheet (REEF-167) so the widened rail
        // doesn't steal width from the main column.
        className="grid max-h-[calc(100dvh-2rem)] min-h-0 max-w-[min(94vw,1200px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-5 overflow-hidden pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onInteractOutside={(e) => {
          // The relation picker renders its dropdown in a body portal, so Radix
          // sees a click on one of its options as "outside" the dialog. That is
          // a normal in-dialog selection, not a dismiss — keep the dialog open
          // and does not prompt to discard for it.
          const target = e.detail.originalEvent.target;
          if (
            target instanceof Element &&
            target.closest('[data-testid="relation-dropdown-panel"]')
          ) {
            e.preventDefault();
            return;
          }
          // Hold the dialog open while submitting, or to confirm discarding a
          // draft with content, instead of losing the in-progress issue silently.
          if (isSubmitting || hasUnsavedDraft()) {
            e.preventDefault();
            if (!isSubmitting) setDiscardOpen(true);
          }
        }}
        onEscapeKeyDown={(e) => {
          if (isSubmitting || hasUnsavedDraft()) {
            e.preventDefault();
            if (!isSubmitting) setDiscardOpen(true);
          }
        }}
      >
        <DialogHeader data-testid="new-issue-dialog-header" className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-start gap-3">
            <div
              data-testid="new-issue-dialog-heading"
              className="min-w-0 flex-1 basis-0 break-words"
            >
              <DialogTitle>
                {subIssueContext ? tc("subIssueHeading") : tc("heading")}
              </DialogTitle>
              <DialogDescription
                className={subIssueContext && vault ? "sr-only" : undefined}
              >
                {vault
                  ? subIssueContext
                    ? tc.rich("createSubIssueIn", {
                        vault,
                        parent: `${subIssueContext.parent.id} ${subIssueContext.parent.title}`,
                        mono: (chunks) => (
                          <span className="font-mono">{chunks}</span>
                        ),
                        strong: (chunks) => (
                          <span className="font-medium text-foreground">
                            {chunks}
                          </span>
                        ),
                      })
                    : tc.rich("createIn", {
                        vault,
                        mono: (chunks) => (
                          <span className="font-mono">{chunks}</span>
                        ),
                      })
                  : tc("configureFirst")}
              </DialogDescription>
              {subIssueContext && vault ? (
                <div
                  aria-hidden="true"
                  className="mt-1.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs"
                >
                  <span className="max-w-[12rem] shrink-0 truncate font-mono text-[11px]">
                    {vault}
                  </span>
                  <span className="text-muted-foreground/50">/</span>
                  <span className="shrink-0 font-mono text-[11px] text-foreground">
                    {subIssueContext.parent.id}
                  </span>
                </div>
              ) : null}
            </div>
            <div
              data-testid="new-issue-dialog-actions"
              className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0"
            >
              <TemplatePicker
                vault={vault ?? ""}
                onSelect={handleApplyTemplate}
                disabled={isSubmitting}
              />
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 bg-ai px-3 text-xs text-ai-foreground hover:bg-ai/90"
                onClick={handleEnrichClick}
                disabled={isSubmitting || enrichMutation.isPending || noVault}
                data-testid="enrich-trigger"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {enrichMutation.isPending
                  ? tc("enriching")
                  : tc("enrichWithAi")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={chatOpen ? "secondary" : "outline"}
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={() => setChatOpen((openState) => !openState)}
                disabled={isSubmitting || noVault}
                aria-expanded={chatOpen}
                data-testid="new-issue-chat-trigger"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {chatOpen ? tc("closeAiChat") : tc("openAiChat")}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div
          data-testid="new-issue-dialog-body"
          className="min-w-0 min-h-0 overflow-y-auto overscroll-contain"
          ref={formBodyRef}
        >
          <div className="flex flex-col gap-4">
            {chatOpen && (
              <section
                data-testid="new-issue-chat-panel"
                aria-label={tc("aiChatHeading")}
                className="flex h-[360px] min-h-[280px] flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {tc("aiChatHeading")}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {tc("aiChatDescription")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setChatOpen(false)}
                    data-testid="new-issue-chat-close"
                  >
                    {common("close")}
                  </Button>
                </div>
                <ChatSurface
                  messages={workspaceChat.messages}
                  sendMessage={workspaceChat.sendMessage}
                  status={workspaceChat.status}
                  stop={workspaceChat.stop}
                  retry={workspaceChat.retry}
                  vault={vault ?? ""}
                  knownIssueIds={knownIssueIds}
                  emptyState={
                    <p className="pt-8 text-center text-sm text-muted-foreground">
                      {tc("aiChatEmptyState")}
                    </p>
                  }
                  composerPlaceholder={tc("aiChatPlaceholder")}
                  composerDisabled={isSubmitting || noVault}
                  inputTestId="new-issue-chat-input"
                  submitTestId="new-issue-chat-send"
                  retryTestId="new-issue-chat-retry"
                />
              </section>
            )}
            {showEnrichmentBar && (
              <EnrichmentReviewBar
                pending={enrichment.counts.pending}
                accepted={enrichment.counts.accepted}
                onAcceptAll={handleAcceptAll}
                onDismissAll={enrichment.dismissAll}
                isLoading={enrichMutation.isPending}
                isEmpty={enrichIsEmpty}
                error={enrichError?.message}
                onRetry={() => {
                  const enrichmentRequest = buildEnrichmentRequest();
                  if (enrichmentRequest)
                    enrichMutation.mutate(enrichmentRequest);
                }}
                onClose={() => enrichMutation.reset()}
              />
            )}

            <IssueDraftFields
              layout="split"
              titleInputRef={titleInputRef}
              title={title}
              onTitleChange={setTitle}
              titleBelow={
                <SimilarIssuesSection title={title} vault={vault ?? ""} />
              }
              priority={priority}
              onPriorityChange={setPriority}
              labels={labels}
              onLabelsChange={setLabels}
              body={body}
              onBodyChange={setBody}
              vault={vault ?? undefined}
              mentionConfig={issueBodyMentionConfig}
              bodyWysiwygPlaceholder={tc("descriptionWysiwygPlaceholder")}
              bodySourcePlaceholder={tc("descriptionPlaceholder")}
              disabled={isSubmitting}
              renderField={renderEnrichable}
              titleId="new-issue-title"
              labelsId="new-issue-labels"
              titleTestId="new-issue-title-input"
              priorityTestId="new-issue-priority-select"
              labelsTestId="new-issue-labels-input"
              railSlot={
                <>
                  {railFields}
                  {relationFields}
                </>
              }
              mainExtra={externalRefFields}
              primaryField={
                // A row-shaped Type so split Details reads as a property list
                // (REEF-167), matching the issue detail rail.
                <IssueFieldRow
                  label={fieldNames.type}
                  labelId="new-issue-type-label"
                >
                  {renderEnrichable(
                    "issue_type",
                    <EnumSelectField
                      value={issueType}
                      onValueChange={(value) =>
                        setIssueType(value as IssueType)
                      }
                      options={ISSUE_TYPE_OPTIONS}
                      renderItem={(type) => (
                        <TypePill type={type} variant="badge" />
                      )}
                      placeholder={fieldNames.type}
                      ariaLabelledby="new-issue-type-label"
                      disabled={isSubmitting}
                    />,
                  )}
                </IssueFieldRow>
              }
            />

            <EnrichmentReferencesPanel
              candidates={candidateReferences}
              confirmed={references}
              disabled={isSubmitting}
              onAdd={(uri) => setReferences([...references, uri])}
              onDismiss={(uri) =>
                setDismissedRefs((prev) => new Set(prev).add(uri))
              }
              onRemove={(uri) =>
                setReferences(references.filter((existing) => existing !== uri))
              }
            />
            {submitError ? (
              <p
                role="alert"
                data-testid="new-issue-error"
                className="rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text"
              >
                {submitError}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter
          data-testid="new-issue-dialog-footer"
          className="min-w-0 items-center gap-2 sm:flex-row sm:justify-end"
        >
          {subIssueContext ? (
            <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 rounded border-border accent-brand"
                checked={createAnother}
                onChange={(event) => setCreateAnother(event.target.checked)}
                disabled={isSubmitting}
                data-testid="create-and-add-another"
              />
              {tc("createAndAddAnother")}
            </label>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={requestClose}
            disabled={isSubmitting}
            data-testid="new-issue-cancel"
          >
            {common("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || noVault}
            data-testid="new-issue-submit"
          >
            {isSubmitting ? tc("creating") : tc("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <DiscardDraftDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={() => {
          setDiscardOpen(false);
          closeDialog();
          resetForm();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </Dialog>
  );
}

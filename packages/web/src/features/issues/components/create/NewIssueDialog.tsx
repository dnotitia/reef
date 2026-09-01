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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EnrichmentReviewBar } from "@/features/ai/components/EnrichmentReviewBar";
import { useWorkspaceChat } from "@/features/ai/hooks/useWorkspaceChat";
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
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { DEFAULT_CONFIG } from "@reef/core";
import type {
  DocumentSearchHit,
  EnrichmentRepoContext,
  IssueListItem,
  IssueType,
  ReferenceSuggestion,
  Template,
} from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { ListPlus, Maximize2, MessageSquare, Minimize2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ISSUE_TYPE_OPTIONS, NO_SELECTION } from "../../lib/metadataOptions";
import { createVaultAwareFetch } from "@/features/ai/runtime/createVaultAwareFetch";
import { IssueRefsEditor } from "../refs/IssueRefsEditor";
import { IssueFieldRow } from "../shared/IssueFieldRow";
import { SimilarIssuesSection } from "../shared/SimilarIssuesSection";
import { DiscardDraftDialog } from "./DiscardDraftDialog";
import { DraftConversationPanel } from "./DraftConversationPanel";
import { EnrichmentReferencesPanel } from "./EnrichmentReferencesPanel";
import { IssueDraftFields } from "./IssueDraftFields";
import { NewIssueRailFields } from "./NewIssueRailFields";
import { NewIssueRelationFields } from "./NewIssueRelationFields";
import { TemplatePicker } from "./TemplatePicker";
import { useNewIssueDialogGeometry } from "./newIssueDialogGeometry";
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
  preferredDescriptionHeight,
}: {
  focusOriginRef?: { current: HTMLElement | null };
  /** Non-persistent height supplied by the maximized create shell. */
  preferredDescriptionHeight?: number;
} = {}) {
  const open = useViewStore((s) => s.newIssueDialogOpen);
  const dialogContext = useViewStore((s) => s.newIssueDialogContext);
  const closeDialog = useViewStore((s) => s.closeNewIssueDialog);
  const [draftConversationOpen, setDraftConversationOpen] = useState(false);
  const formBodyRef = useRef<HTMLDivElement>(null);
  const {
    dialogRef: dialogContentRef,
    descriptionFrameRef,
    isMaximized,
    preferredDescriptionHeight: maximizedDescriptionHeight,
    dialogStyle,
    onToggleMaximize,
  } = useNewIssueDialogGeometry(open, formBodyRef, draftConversationOpen);
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
  // bar (which resets the enrichment run) doesn't discard documents the PM hasn't
  // accepted or dismissed yet.
  const [referenceCandidates, setReferenceCandidates] = useState<
    ReferenceSuggestion[]
  >([]);
  // Focus target for the first invalid field on a failed submit (validation is
  // surfaced inline, not as a toast — see handleSubmit).
  const titleInputRef = useRef<HTMLInputElement>(null);
  const seededContextRef = useRef<typeof dialogContext | undefined>(undefined);
  const focusOriginRef = useRef<HTMLElement | null>(null);
  const draftConversationToggleRef = useRef<HTMLButtonElement>(null);
  // Radix handles Escape on document capture. Keep a synchronous pointer
  // origin so a clicked message remains owned by the conversation even if its
  // non-interactive content cannot retain focus before that listener runs.
  const draftConversationInteractionRef = useRef(false);
  const draftViewDraftRef = useRef<HTMLButtonElement>(null);
  const restoreDraftConversationFocusRef = useRef(false);
  const subIssueContext =
    dialogContext?.kind === "subIssue" ? dialogContext : null;

  // Local issue list still drives relation pickers; enrichment now fetches its
  // own AKB context server-side so the prompt sees a consistent workspace view.
  const { data: existingIssues } = useIssueList(vault ?? "");
  // Whole-vault relation graph for accurate blocked badges in the relation dropdowns.
  const { data: relations } = useIssueRelations(vault ?? "");
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
    enrichRun,
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

  const chatFetch = useMemo(() => createVaultAwareFetch(vault), [vault]);
  const draftConversation = useWorkspaceChat({
    fetch: chatFetch,
    route: null,
    reefId: null,
    scopeKey: vault ?? null,
    draft: {
      fields: buildCreateFields({
        fallbackTitle: "(untitled)",
        status: subIssueContext && sprintId ? "todo" : undefined,
      }),
      content: body,
    },
  });
  const knownIssueIds = useMemo(
    () => new Set((existingIssues ?? []).map((issue) => issue.id)),
    [existingIssues],
  );

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
    setDraftConversationOpen(false);
    draftConversationInteractionRef.current = false;
    // Abort the live draft chat synchronously before the !open effect runs.
    draftConversation.clear();
    setCreateAnother(false);
    setDismissedRefs(new Set());
    setReferenceCandidates([]);
    enrichment.reset();
    enrichRun.reset();
    createMutation.reset();
  }

  useEffect(() => {
    if (!open) {
      seededContextRef.current = undefined;
      draftConversationInteractionRef.current = false;
      return;
    }
    if (seededContextRef.current === dialogContext) return;
    resetFields(
      dialogContext?.kind === "subIssue"
        ? getSubIssueDefaults(dialogContext)
        : undefined,
    );
    setSubmitError(null);
    setDraftConversationOpen(false);
    draftConversation.clear();
    seededContextRef.current = dialogContext;
  }, [dialogContext, draftConversation.clear, open, resetFields]);

  useEffect(() => {
    if (open) return;
    setDraftConversationOpen(false);
    draftConversation.clear();
  }, [draftConversation.clear, open]);

  const previousVaultRef = useRef(vault);
  useEffect(() => {
    if (previousVaultRef.current === vault) return;
    previousVaultRef.current = vault;
    setDraftConversationOpen(false);
  }, [vault]);

  useLayoutEffect(() => {
    if (draftConversationOpen || !restoreDraftConversationFocusRef.current) {
      return;
    }
    restoreDraftConversationFocusRef.current = false;
    const target =
      window.innerWidth >= 900
        ? draftConversationToggleRef.current
        : draftViewDraftRef.current;
    target?.focus({ preventScroll: true });
  }, [draftConversationOpen]);

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
    references.length > 0 ||
    draftConversation.composerText.trim() !== "";

  // Wraps the form body so the close path can also catch text buffered inside
  // child controls before it is committed — a label typed but not yet entered,
  // a relation search, and especially an external reference URL/title typed but
  // not yet added. Those live in child-local state, not the form values above,
  // so `hasCommittedDraft` alone would miss them and let the dialog discard
  // typed content silently. Reading `.value` on close (not during render) is a
  // cheap, framework-agnostic way to include every such buffered input.
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
        setDraftConversationOpen(false);
        draftConversation.clear();
        setDismissedRefs(new Set());
        setReferenceCandidates([]);
        enrichment.reset();
        enrichRun.reset();
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
  const resolvedPreferredDescriptionHeight = isMaximized
    ? maximizedDescriptionHeight
    : preferredDescriptionHeight;
  const maximizeLabel = isMaximized
    ? tc("restoreWindow")
    : tc("maximizeWindow");

  function closeDraftConversation() {
    draftConversationInteractionRef.current = false;
    restoreDraftConversationFocusRef.current = true;
    if (
      draftConversation.status === "submitted" ||
      draftConversation.status === "streaming"
    ) {
      draftConversation.stop();
    }
    setDraftConversationOpen(false);
  }

  const dialogWidthClass = draftConversationOpen
    ? isMaximized
      ? "max-w-[min(94vw,2100px)]"
      : "max-w-[min(94vw,1620px)]"
    : isMaximized
      ? "max-w-[min(94vw,1680px)]"
      : "max-w-[min(94vw,1200px)]";
  // The temporary AI rail needs an explicit viewport-capped width so its
  // grid slots stay deterministic while the dialog opens and closes.
  const dialogMaxWidthLimit = draftConversationOpen
    ? isMaximized
      ? 2100
      : 1620
    : undefined;
  const dialogWidth =
    dialogMaxWidthLimit && typeof window !== "undefined"
      ? Math.min(window.innerWidth * 0.94, dialogMaxWidthLimit)
      : undefined;

  const draftForm = (
    <div className="flex flex-col gap-4">
      {showEnrichmentBar && (
        <EnrichmentReviewBar
          pending={enrichment.counts.pending}
          accepted={enrichment.counts.accepted}
          onAcceptAll={handleAcceptAll}
          onDismissAll={enrichment.dismissAll}
          isLoading={enrichRun.isPending}
          isEmpty={enrichIsEmpty}
          error={enrichError?.message}
          onRetry={() => {
            const enrichmentRequest = buildEnrichmentRequest();
            if (enrichmentRequest) enrichRun.mutate(enrichmentRequest);
          }}
          onClose={() => enrichRun.reset()}
        />
      )}

      <IssueDraftFields
        layout={draftConversationOpen ? "chat" : "split"}
        titleInputRef={titleInputRef}
        title={title}
        onTitleChange={setTitle}
        titleBelow={<SimilarIssuesSection title={title} vault={vault ?? ""} />}
        priority={priority}
        onPriorityChange={setPriority}
        labels={labels}
        onLabelsChange={setLabels}
        body={body}
        onBodyChange={setBody}
        vault={vault ?? undefined}
        mentionConfig={issueBodyMentionConfig}
        enableHeightResize
        preferredDescriptionHeight={resolvedPreferredDescriptionHeight}
        descriptionBodyFrameRef={descriptionFrameRef}
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
          <IssueFieldRow label={fieldNames.type} labelId="new-issue-type-label">
            {renderEnrichable(
              "issue_type",
              <EnumSelectField
                value={issueType}
                onValueChange={(value) => setIssueType(value as IssueType)}
                options={ISSUE_TYPE_OPTIONS}
                renderItem={(type) => <TypePill type={type} variant="badge" />}
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
        onDismiss={(uri) => setDismissedRefs((prev) => new Set(prev).add(uri))}
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
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        data-testid="new-issue-dialog"
        // The header owns the top-right action row (Template, Get suggestions,
        // chat, and maximize). The shared close X overlaps those actions, and
        // the footer Cancel / Escape / outside-click / post-submit redirect all
        // still dismiss — so this dialog opts out of the built-in close X.
        showCloseButton={false}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        // Canvas matches the issue detail sheet (REEF-167) so the widened rail
        // doesn't steal width from the main column.
        className={`grid max-h-[calc(100dvh-2rem)] min-h-0 ${dialogWidthClass} grid-rows-[auto_minmax(0,1fr)_auto] gap-5 overflow-hidden pb-[calc(1.25rem+env(safe-area-inset-bottom))]`}
        style={{
          ...dialogStyle,
          ...(dialogWidth
            ? { width: `${dialogWidth}px`, maxWidth: `${dialogWidth}px` }
            : {}),
        }}
        onInteractOutside={(e) => {
          draftConversationInteractionRef.current = false;
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
        onPointerDownCapture={() => {
          // The panel capture handler marks its own pointer after this reset.
          draftConversationInteractionRef.current = false;
        }}
        onKeyDownCapture={(e) => {
          if (e.key !== "Escape") {
            draftConversationInteractionRef.current = false;
          }
        }}
        onEscapeKeyDown={(e) => {
          const escapeTargets = [e.target, document.activeElement];
          const escapedFromConversation =
            draftConversationOpen &&
            (escapeTargets.some(
              (target) =>
                target instanceof Element &&
                target.closest('[data-testid="draft-conversation-panel"]'),
            ) ||
              draftConversationInteractionRef.current);
          if (escapedFromConversation) {
            e.preventDefault();
            closeDraftConversation();
            return;
          }
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
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-ai-border px-3 text-ai-subtle-foreground text-xs hover:bg-ai-subtle"
                onClick={handleEnrichClick}
                disabled={isSubmitting || enrichRun.isPending || noVault}
                data-testid="enrich-trigger"
              >
                <ListPlus className="size-3.5" aria-hidden="true" />
                {enrichRun.isPending ? tc("enriching") : tc("enrichWithAi")}
              </Button>
              <Button
                type="button"
                ref={draftConversationToggleRef}
                variant="outline"
                size="sm"
                className={cn(
                  "hidden h-8 min-w-[7rem] shrink-0 justify-center gap-1.5 border-ai-border px-3 text-xs min-[900px]:inline-flex",
                  draftConversationOpen
                    ? "bg-ai-subtle text-ai-subtle-foreground hover:bg-ai-subtle"
                    : "text-ai-subtle-foreground hover:bg-ai-subtle",
                )}
                onClick={() => {
                  if (draftConversationOpen) {
                    closeDraftConversation();
                  } else {
                    setDraftConversationOpen(true);
                  }
                }}
                disabled={!draftConversationOpen && noVault}
                aria-expanded={draftConversationOpen}
                aria-controls="draft-conversation-panel"
                data-testid="draft-conversation-toggle"
              >
                {draftConversationOpen ? (
                  <X className="size-3.5" aria-hidden="true" />
                ) : (
                  <MessageSquare className="size-3.5" aria-hidden="true" />
                )}
                {draftConversationOpen
                  ? tc("closeConversation")
                  : tc("openConversation")}
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 shrink-0 p-0 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                      aria-label={maximizeLabel}
                      aria-pressed={isMaximized}
                      title={maximizeLabel}
                      data-testid="new-issue-maximize-toggle"
                      onClick={onToggleMaximize}
                    >
                      {isMaximized ? (
                        <Minimize2 className="size-4" aria-hidden="true" />
                      ) : (
                        <Maximize2 className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{maximizeLabel}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-1 rounded-md border border-border-subtle bg-surface-subtle p-1 min-[900px]:hidden">
            <Button
              type="button"
              ref={draftViewDraftRef}
              size="sm"
              variant={draftConversationOpen ? "ghost" : "secondary"}
              aria-pressed={!draftConversationOpen}
              data-testid="draft-view-draft"
              onClick={() => {
                if (draftConversationOpen) closeDraftConversation();
              }}
            >
              {tc("draftView")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={draftConversationOpen ? "secondary" : "ghost"}
              className={
                draftConversationOpen
                  ? "bg-ai-subtle text-ai-subtle-foreground hover:bg-ai-subtle"
                  : undefined
              }
              aria-pressed={draftConversationOpen}
              aria-controls="draft-conversation-panel"
              data-testid="draft-view-conversation"
              onClick={() => setDraftConversationOpen(true)}
              disabled={noVault}
            >
              {tc("conversationView")}
            </Button>
          </div>
        </DialogHeader>

        <div
          data-testid="new-issue-dialog-body"
          className={cn(
            "min-w-0 min-h-0",
            draftConversationOpen
              ? "overflow-hidden"
              : "overflow-y-auto overscroll-contain",
          )}
          ref={formBodyRef}
        >
          <div
            data-testid={
              draftConversationOpen ? "draft-conversation-layout" : undefined
            }
            className={
              draftConversationOpen
                ? "grid h-full min-h-0 min-w-0 grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_400px]"
                : "min-w-0"
            }
          >
            <div
              data-testid={
                draftConversationOpen
                  ? "draft-conversation-authoring"
                  : undefined
              }
              className={cn(
                "min-w-0",
                draftConversationOpen
                  ? "hidden min-h-0 overflow-y-auto overscroll-contain min-[900px]:block"
                  : undefined,
              )}
            >
              {draftForm}
            </div>
            {draftConversationOpen ? (
              <DraftConversationPanel
                messages={draftConversation.messages}
                composerText={draftConversation.composerText}
                onComposerTextChange={draftConversation.setComposerText}
                sendMessage={draftConversation.sendMessage}
                status={draftConversation.status}
                stop={draftConversation.stop}
                vault={vault ?? ""}
                knownIssueIds={knownIssueIds}
                onConversationPointerDown={() => {
                  draftConversationInteractionRef.current = true;
                }}
                disabled={isSubmitting || noVault}
              />
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

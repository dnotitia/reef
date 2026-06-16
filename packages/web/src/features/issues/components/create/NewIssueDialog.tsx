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
import { useActivityRepo } from "@/features/activity/hooks/useActivityRepo";
import { EnrichmentReviewBar } from "@/features/ai/components/EnrichmentReviewBar";
import { useCreateIssue } from "@/features/issues/hooks/mutations/useCreateIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  ensureProjectConfig,
  useProjectConfig,
} from "@/features/settings/hooks/useProjectConfig";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { DEFAULT_CONFIG } from "@reef/core";
import type { IssueType, ReferenceSuggestion, Template } from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ISSUE_TYPE_OPTIONS, NO_SELECTION } from "../../lib/metadataOptions";
import { IssueFieldRow } from "../shared/IssueFieldRow";
import { DiscardDraftDialog } from "./DiscardDraftDialog";
import { EnrichmentReferencesPanel } from "./EnrichmentReferencesPanel";
import { IssueDraftFields } from "./IssueDraftFields";
import { NewIssueRailFields } from "./NewIssueRailFields";
import { NewIssueRelationFields } from "./NewIssueRelationFields";
import { TemplatePicker } from "./TemplatePicker";
import { useNewIssueEnrichment } from "./useNewIssueEnrichment";
import { useNewIssueFormState } from "./useNewIssueFormState";

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
export function NewIssueDialog() {
  const open = useViewStore((s) => s.newIssueDialogOpen);
  const closeDialog = useViewStore((s) => s.closeNewIssueDialog);
  const { vault } = useActiveVault();
  const router = useRouter();
  const createMutation = useCreateIssue();
  const queryClient = useQueryClient();
  // Display prefix; the submit handler re-fetches the canonical value
  // via ensureProjectConfig so a cold load does not use a stale prefix.
  const configQuery = useProjectConfig(vault ?? "");
  const prefix =
    configQuery.data?.config.project_prefix ?? DEFAULT_CONFIG.project_prefix;

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
  // Focus target for the first invalid field on a failed submit (validation is
  // surfaced inline, not as a toast — see handleSubmit).
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Local issue list still drives relation pickers; enrichment now fetches its
  // own AKB context server-side so the prompt sees a consistent workspace view.
  const { data: existingIssues } = useIssueList(vault ?? "");
  // Whole-vault relation graph for accurate blocked badges in the relation dropdowns.
  const { data: relations } = useIssueRelations(vault ?? "");
  // Optional GitHub grounding for enrichment code tools. Labels come from AKB
  // vault context instead; the monitored repo just enables code search/read.
  const { repo: scanRepo } = useActivityRepo(vault ?? "");

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
    scanRepo,
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

  function resetForm() {
    resetFields();
    setSubmitError(null);
    setDismissedRefs(new Set());
    setReferenceCandidates([]);
    enrichment.reset();
    enrichMutation.reset();
    createMutation.reset();
  }

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
      setSubmitError(
        "Configure a workspace in Settings before creating issues.",
      );
      return;
    }
    if (!title.trim()) {
      setSubmitError("Title is required.");
      // Move focus to the first invalid field so the inline error is actionable.
      titleInputRef.current?.focus();
      return;
    }
    if (estimatePoints.trim() && Number.isNaN(Number(estimatePoints.trim()))) {
      setSubmitError("Estimate must be a number.");
      return;
    }

    const fields = buildCreateFields();

    let canonicalPrefix: string;
    try {
      const { config } = await ensureProjectConfig(queryClient, vault);
      canonicalPrefix = config.project_prefix;
    } catch (err) {
      const message =
        err instanceof Error
          ? `Couldn't load project config: ${err.message}`
          : "Couldn't load project config.";
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
      closeDialog();
      resetForm();
      const failedCount = failedReferences?.length ?? 0;
      if (failedCount > 0) {
        toast.warning(
          `Issue ${issue.id} created, but ${failedCount} linked document${
            failedCount === 1 ? "" : "s"
          } couldn't be attached — add ${
            failedCount === 1 ? "it" : "them"
          } from the issue.`,
        );
      } else if (issue.status === "backlog") {
        // Read-back: a new issue lands in `backlog` by default (REEF-130), which
        // the default board view hides (it floors to the active statuses). Name
        // where it went so the create doesn't look like it silently vanished.
        toast.success(`Issue ${issue.id} added to the backlog`, {
          description:
            "It won't appear on the default board until you move it to Todo.",
        });
      } else {
        toast.success(`Issue ${issue.id} created`);
      }
      router.push(`/issues/${issue.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create issue.";
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
  // Main-column relationships and external refs, kept below the description so
  // they don't crowd the rail — matching the issue detail screen.
  const relationFields = (
    <NewIssueRelationFields
      isSubmitting={isSubmitting}
      existingIssues={existingIssues ?? []}
      relations={relations}
      parentId={parentId}
      dependsOn={dependsOn}
      blocks={blocks}
      relatedTo={relatedTo}
      externalRefs={externalRefs}
      setParentId={setParentId}
      setDependsOn={setDependsOn}
      setBlocks={setBlocks}
      setRelatedTo={setRelatedTo}
      setExternalRefs={setExternalRefs}
      renderEnrichable={renderEnrichable}
      renderFieldLabel={renderFieldLabel}
    />
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
        // Canvas matches the issue detail sheet (REEF-167) so the widened rail
        // doesn't steal width from the main column.
        className="max-h-[88vh] max-w-[min(94vw,1080px)] gap-5 overflow-y-auto overscroll-contain"
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
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>New Issue</DialogTitle>
              <DialogDescription>
                {vault ? (
                  <>
                    Create an issue in{" "}
                    <span className="font-mono">{vault}</span>.
                  </>
                ) : (
                  <>Configure a workspace in Settings first.</>
                )}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
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
                {enrichMutation.isPending ? "Enriching…" : "Enrich with AI"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4" ref={formBodyRef}>
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
                if (enrichmentRequest) enrichMutation.mutate(enrichmentRequest);
              }}
              onClose={() => enrichMutation.reset()}
            />
          )}

          <IssueDraftFields
            layout="split"
            titleInputRef={titleInputRef}
            title={title}
            onTitleChange={setTitle}
            priority={priority}
            onPriorityChange={setPriority}
            labels={labels}
            onLabelsChange={setLabels}
            body={body}
            onBodyChange={setBody}
            disabled={isSubmitting}
            renderField={renderEnrichable}
            titleId="new-issue-title"
            labelsId="new-issue-labels"
            titleTestId="new-issue-title-input"
            priorityTestId="new-issue-priority-select"
            labelsTestId="new-issue-labels-input"
            railSlot={railFields}
            mainExtra={relationFields}
            primaryField={
              // A row-shaped Type so split Details reads as a property list
              // (REEF-167), matching the issue detail rail.
              <IssueFieldRow label="Type" labelId="new-issue-type-label">
                {renderEnrichable(
                  "issue_type",
                  <EnumSelectField
                    value={issueType}
                    onValueChange={(value) => setIssueType(value as IssueType)}
                    options={ISSUE_TYPE_OPTIONS}
                    renderItem={(type) => (
                      <TypePill type={type} variant="badge" />
                    )}
                    placeholder="Type"
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
        </div>

        {submitError ? (
          <p
            role="alert"
            data-testid="new-issue-error"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {submitError}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={requestClose}
            disabled={isSubmitting}
            data-testid="new-issue-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || noVault}
            data-testid="new-issue-submit"
          >
            {isSubmitting ? "Creating…" : "Create issue"}
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

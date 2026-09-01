"use client";

import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { useVaultRoster } from "@/features/settings/hooks/useVaultRoster";
import { fetchVaultDocumentSearch } from "@/features/issues/hooks/queries/useVaultDocumentSearch";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { akbDocumentSlugTitle } from "@/lib/akb/documentUri";
import type {
  DocumentSearchHit,
  ExternalRef,
  ImplementationRef,
  IssueListItem,
  IssueMetadata,
  IssueUpdatePatch,
} from "@reef/core";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, type ComponentProps } from "react";
import { ActivityTimeline } from "../activity/ActivityTimeline";
import { IssueAttachments } from "../attachments/IssueAttachments";
import { IssueLinkedDocuments } from "../refs/IssueLinkedDocuments";
import { IssueRefsEditor } from "../refs/IssueRefsEditor";
import { IssueChildren } from "../relations/IssueChildren";

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

type ValueSetter<T> = (value: T) => void;

export function IssueDetailMain({
  issueId,
  vault,
  issue,
  allIssues,
  relations,
  title,
  body,
  externalRefs,
  implementationRefs,
  setTitle,
  setBody,
  setExternalRefs,
  setImplementationRefs,
  onUploadBodyFiles,
  resolveBodyImageSrc,
  resolveBodyAttachmentHref,
  commitTitle,
  commitBody,
  commit,
}: {
  issueId: string;
  vault: string;
  issue: IssueMetadata | undefined;
  allIssues: readonly IssueListItem[];
  relations: ComponentProps<typeof IssueChildren>["relationGraph"];
  title: string;
  body: string;
  externalRefs: ExternalRef[];
  implementationRefs: ImplementationRef[];
  setTitle: ValueSetter<string>;
  setBody: ValueSetter<string>;
  setExternalRefs: ValueSetter<ExternalRef[]>;
  setImplementationRefs: ValueSetter<ImplementationRef[]>;
  onUploadBodyFiles?: ComponentProps<typeof MarkdownEditor>["onUploadFiles"];
  resolveBodyImageSrc?: ComponentProps<
    typeof MarkdownEditor
  >["resolveImageSrc"];
  resolveBodyAttachmentHref?: ComponentProps<
    typeof MarkdownEditor
  >["resolveAttachmentHref"];
  commitTitle: (value: string) => void;
  commitBody: (value: string) => void;
  commit: (patch: IssueUpdatePatch) => void;
}) {
  const fieldNames = useFieldNameLabels();
  const t = useTranslations("issues.detail");
  const tr = useTranslations("issues.relations");
  const markdownEditor = useTranslations("markdownEditor");
  const { data: vaultMembers = [] } = useVaultRoster(vault);
  const openNewIssueDialog = useViewStore((state) => state.openNewIssueDialog);
  const issueBodyMentionConfig = useMemo(
    () => ({
      members: vaultMembers,
      issues: allIssues,
      searchDocuments: (query: string, signal: AbortSignal) =>
        fetchVaultDocumentSearch(query, vault, signal),
      suggestionsLabel: markdownEditor("mentionSuggestions"),
      mentionOptionLabel: (username: string) =>
        markdownEditor("mentionOption", { username: `@${username}` }),
      peopleSectionLabel: markdownEditor("peopleSection"),
      issuesSectionLabel: markdownEditor("issuesSection"),
      documentsSectionLabel: markdownEditor("documentsSection"),
      issueOptionLabel: (candidate: IssueListItem) =>
        markdownEditor("issueOption", {
          id: candidate.id,
          title: candidate.title,
        }),
      documentOptionLabel: (hit: DocumentSearchHit) =>
        markdownEditor("documentOption", {
          title: hit.title ?? akbDocumentSlugTitle(hit.uri),
        }),
      documentSearchLoadingLabel: markdownEditor("documentSearchLoading"),
      documentSearchErrorLabel: markdownEditor("documentSearchError"),
      documentSearchEmptyLabel: markdownEditor("documentSearchEmpty"),
    }),
    [allIssues, markdownEditor, vault, vaultMembers],
  );

  function handleAddSubIssue() {
    if (!issue) return;
    openNewIssueDialog({
      kind: "subIssue",
      parent: {
        id: issue.id,
        title: issue.title,
      },
      defaults: {
        priority: issue.priority ?? null,
        sprintId: issue.sprint_id ?? null,
        milestoneId: issue.milestone_id ?? null,
        labels: issue.labels ?? [],
      },
    });
  }

  const addSubIssueAction = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="group h-6 gap-1 px-1.5 type-caption text-muted-foreground hover:text-foreground"
      onClick={handleAddSubIssue}
      disabled={!issue}
      data-testid="add-sub-issue-trigger"
    >
      <span className="grid size-4 place-items-center rounded-sm bg-secondary text-muted-foreground transition-colors group-hover:text-foreground">
        <Plus className="size-3" />
      </span>
      {tr("addSubIssue")}
    </Button>
  );

  return (
    <main className="flex min-w-0 flex-col gap-4 overflow-x-clip [overflow-clip-margin:3px]">
      {/* overflow-x-clip stops long bodies/refs from widening the column; the
          clip-margin lets a focused field's 2–3px ring/outline paint past the
          clip edge so left/right borders aren't shaved off (REEF-226). */}
      <div className="flex flex-col gap-1">
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor="issue-title"
        >
          {fieldNames.title}
        </label>
        <Input
          id="issue-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => commitTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={t("titlePlaceholder")}
          data-testid="issue-title-input"
        />
      </div>

      <div id="issue-description" className="scroll-mt-4 flex flex-col gap-1">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: MarkdownEditor uses contenteditable, not a native input */}
        <label className="text-xs font-medium text-muted-foreground">
          {fieldNames.description}
        </label>
        <MarkdownEditor
          value={body}
          onChange={setBody}
          onBlur={commitBody}
          onUploadFiles={onUploadBodyFiles}
          resolveImageSrc={resolveBodyImageSrc}
          resolveAttachmentHref={resolveBodyAttachmentHref}
          placeholder={t("descriptionWysiwygPlaceholder")}
          sourcePlaceholder={t("descriptionPlaceholder")}
          ariaLabel={t("descriptionAriaLabel")}
          vault={vault}
          mentionConfig={issueBodyMentionConfig}
          enableHeightResize
        />
      </div>

      <IssueChildren
        issueId={issueId}
        allIssues={allIssues}
        members={vaultMembers}
        relationGraph={relations}
        action={addSubIssueAction}
      />

      <IssueLinkedDocuments issueId={issueId} vault={vault} />

      <IssueAttachments issueId={issueId} vault={vault} />

      <IssueRefsEditor
        externalRefs={externalRefs}
        implementationRefs={implementationRefs}
        onExternalRefsChange={(next) => {
          setExternalRefs(next);
          if (!sameJson(next, issue?.external_refs ?? [])) {
            commit({ external_refs: next });
          }
        }}
        onImplementationRefsChange={(next) => {
          setImplementationRefs(next);
          if (!sameJson(next, issue?.implementation_refs ?? [])) {
            commit({ implementation_refs: next });
          }
        }}
      />

      {/* The unified activity timeline (REEF-064) sits at the bottom: comments,
          status changes, and reconstructed events merge into one chronological
          thread after the structured fields. */}
      {issue ? (
        <ActivityTimeline
          issueId={issueId}
          vault={vault}
          issue={issue}
          knownIssues={allIssues}
        />
      ) : null}
    </main>
  );
}

"use client";

import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Input } from "@/components/ui/input";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import type {
  ExternalRef,
  ImplementationRef,
  IssueListItem,
  IssueMetadata,
  IssueUpdatePatch,
} from "@reef/core";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { ActivityTimeline } from "../activity/ActivityTimeline";
import { IssueLinkedDocuments } from "../refs/IssueLinkedDocuments";
import { IssueRefsEditor } from "../refs/IssueRefsEditor";
import { IssueChildren } from "../relations/IssueChildren";
import { IssueRelationInput } from "../relations/IssueRelationInput";
import { IssueFormSection } from "../shared/IssueFormSection";

/** Order-sensitive equality so a reorder still counts as a change. */
function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

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
  parentId,
  dependsOn,
  blocks,
  relatedTo,
  externalRefs,
  implementationRefs,
  setTitle,
  setBody,
  setParentId,
  setDependsOn,
  setBlocks,
  setRelatedTo,
  setExternalRefs,
  setImplementationRefs,
  commitTitle,
  commitBody,
  commit,
}: {
  issueId: string;
  vault: string;
  issue: IssueMetadata | undefined;
  allIssues: readonly IssueListItem[];
  relations: ComponentProps<typeof IssueRelationInput>["relationGraph"];
  title: string;
  body: string;
  parentId: string;
  dependsOn: string[];
  blocks: string[];
  relatedTo: string[];
  externalRefs: ExternalRef[];
  implementationRefs: ImplementationRef[];
  setTitle: ValueSetter<string>;
  setBody: ValueSetter<string>;
  setParentId: ValueSetter<string>;
  setDependsOn: ValueSetter<string[]>;
  setBlocks: ValueSetter<string[]>;
  setRelatedTo: ValueSetter<string[]>;
  setExternalRefs: ValueSetter<ExternalRef[]>;
  setImplementationRefs: ValueSetter<ImplementationRef[]>;
  commitTitle: (value: string) => void;
  commitBody: (value: string) => void;
  commit: (patch: IssueUpdatePatch) => void;
}) {
  const fieldNames = useFieldNameLabels();
  const t = useTranslations("issues.detail");
  const s = useTranslations("sections");
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

      <div className="flex flex-col gap-1">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: MarkdownEditor uses contenteditable, not a native input */}
        <label className="text-xs font-medium text-muted-foreground">
          {fieldNames.description}
        </label>
        <MarkdownEditor
          value={body}
          onChange={setBody}
          onBlur={commitBody}
          placeholder={t("descriptionPlaceholder")}
          ariaLabel={t("descriptionAriaLabel")}
        />
      </div>

      <IssueChildren
        issueId={issueId}
        allIssues={allIssues}
        relationGraph={relations}
      />

      <IssueFormSection title={s("relationships")}>
        <div className="grid gap-3 md:grid-cols-2">
          <IssueRelationInput
            id="issue-parent"
            label={fieldNames.parent}
            value={parentId ? [parentId] : []}
            allIssues={allIssues}
            relationGraph={relations}
            currentIssueId={issueId}
            onChange={(next) => {
              const nextParent = next[0] ?? "";
              setParentId(nextParent);
              if (nextParent !== (issue?.parent_id ?? "")) {
                commit({
                  parent_id: nextParent || null,
                } as IssueUpdatePatch);
              }
            }}
            maxItems={1}
          />
          <IssueRelationInput
            id="issue-depends-on"
            label={fieldNames.dependsOn}
            value={dependsOn}
            allIssues={allIssues}
            relationGraph={relations}
            currentIssueId={issueId}
            navigable
            onChange={(next) => {
              setDependsOn(next);
              if (!sameStringArray(next, issue?.depends_on ?? [])) {
                commit({ depends_on: next });
              }
            }}
          />
          <IssueRelationInput
            id="issue-blocks"
            label={fieldNames.blocks}
            value={blocks}
            allIssues={allIssues}
            relationGraph={relations}
            currentIssueId={issueId}
            navigable
            onChange={(next) => {
              setBlocks(next);
              if (!sameStringArray(next, issue?.blocks ?? [])) {
                commit({ blocks: next });
              }
            }}
          />
          <IssueRelationInput
            id="issue-related-to"
            label={fieldNames.related}
            value={relatedTo}
            allIssues={allIssues}
            relationGraph={relations}
            currentIssueId={issueId}
            navigable
            onChange={(next) => {
              setRelatedTo(next);
              if (!sameStringArray(next, issue?.related_to ?? [])) {
                commit({ related_to: next });
              }
            }}
          />
        </div>
      </IssueFormSection>

      <IssueLinkedDocuments issueId={issueId} vault={vault} />

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
        <ActivityTimeline issueId={issueId} vault={vault} issue={issue} />
      ) : null}
    </main>
  );
}

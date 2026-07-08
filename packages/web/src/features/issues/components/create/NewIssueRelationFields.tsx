"use client";

import { useFieldNameLabels } from "@/i18n/fieldLabels";
import type { EnrichmentField, IssueListItem } from "@reef/core";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { IssueRelationInput } from "../relations/IssueRelationInput";
import { IssueFieldRow } from "../shared/IssueFieldRow";
import { IssueFormSection } from "../shared/IssueFormSection";

type RenderEnrichable = (
  field: EnrichmentField,
  control: ReactNode,
) => ReactNode;

type RenderFieldLabel = (
  field: EnrichmentField,
  htmlFor: string,
  text: string,
) => ReactNode;

/**
 * Parent and relationship inputs for the new-issue dialog. They live in the
 * right rail beside Details / People / Planning, matching the issue detail
 * screen's details-first property rail; external refs stay in the main column
 * with the authoring surface.
 */
export function NewIssueRelationFields({
  isSubmitting,
  existingIssues,
  relations,
  parentId,
  dependsOn,
  blocks,
  relatedTo,
  lockedParent,
  setParentId,
  setDependsOn,
  setBlocks,
  setRelatedTo,
  renderEnrichable,
  renderFieldLabel,
}: {
  isSubmitting: boolean;
  existingIssues: readonly IssueListItem[];
  relations: ComponentProps<typeof IssueRelationInput>["relationGraph"];
  parentId: string;
  dependsOn: string[];
  blocks: string[];
  relatedTo: string[];
  lockedParent?: Pick<IssueListItem, "id" | "title">;
  setParentId: (value: string) => void;
  setDependsOn: (value: string[]) => void;
  setBlocks: (value: string[]) => void;
  setRelatedTo: (value: string[]) => void;
  renderEnrichable: RenderEnrichable;
  renderFieldLabel: RenderFieldLabel;
}) {
  const fieldNames = useFieldNameLabels();
  const sections = useTranslations("sections");
  const t = useTranslations("issues.create");
  return (
    <>
      <IssueFormSection title={fieldNames.parent}>
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "parent_id",
            "new-issue-parent",
            fieldNames.parent,
          )}
          align="start"
        >
          {lockedParent ? (
            <div
              id="new-issue-parent"
              data-testid="new-issue-parent-locked"
              className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
            >
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {lockedParent.id}
              </span>
              <span className="min-w-0 truncate">{lockedParent.title}</span>
              <span className="ml-auto shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t("parentLocked")}
              </span>
            </div>
          ) : (
            renderEnrichable(
              "parent_id",
              <IssueRelationInput
                id="new-issue-parent"
                label={fieldNames.parent}
                hideLabel
                value={parentId ? [parentId] : []}
                allIssues={existingIssues}
                relationGraph={relations}
                onChange={(next) => setParentId(next[0] ?? "")}
                disabled={isSubmitting}
                maxItems={1}
              />,
            )
          )}
        </IssueFieldRow>
      </IssueFormSection>

      <IssueFormSection title={sections("relationships")}>
        <div className="flex flex-col gap-3">
          <IssueFieldRow
            labelSlot={renderFieldLabel(
              "depends_on",
              "new-issue-depends-on",
              fieldNames.dependsOn,
            )}
            align="start"
          >
            {renderEnrichable(
              "depends_on",
              <IssueRelationInput
                id="new-issue-depends-on"
                label={fieldNames.dependsOn}
                hideLabel
                value={dependsOn}
                allIssues={existingIssues}
                relationGraph={relations}
                onChange={setDependsOn}
                disabled={isSubmitting}
              />,
            )}
          </IssueFieldRow>
          <IssueFieldRow
            labelSlot={renderFieldLabel(
              "blocks",
              "new-issue-blocks",
              fieldNames.blocks,
            )}
            align="start"
          >
            {renderEnrichable(
              "blocks",
              <IssueRelationInput
                id="new-issue-blocks"
                label={fieldNames.blocks}
                hideLabel
                value={blocks}
                allIssues={existingIssues}
                relationGraph={relations}
                onChange={setBlocks}
                disabled={isSubmitting}
              />,
            )}
          </IssueFieldRow>
          <IssueFieldRow
            labelSlot={renderFieldLabel(
              "related_to",
              "new-issue-related-to",
              fieldNames.related,
            )}
            align="start"
          >
            {renderEnrichable(
              "related_to",
              <IssueRelationInput
                id="new-issue-related-to"
                label={fieldNames.related}
                hideLabel
                value={relatedTo}
                allIssues={existingIssues}
                relationGraph={relations}
                onChange={setRelatedTo}
                disabled={isSubmitting}
              />,
            )}
          </IssueFieldRow>
        </div>
      </IssueFormSection>
    </>
  );
}

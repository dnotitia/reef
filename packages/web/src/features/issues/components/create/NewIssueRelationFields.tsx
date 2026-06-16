"use client";

import type { EnrichmentField, ExternalRef, IssueListItem } from "@reef/core";
import type { ComponentProps, ReactNode } from "react";
import { IssueRefsEditor } from "../refs/IssueRefsEditor";
import { IssueRelationInput } from "../relations/IssueRelationInput";
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
 * Main-column relationships and external refs for the new-issue dialog
 * (REEF-075). These sit under the Description rather than in the rail — matching
 * the issue detail screen, where relationships and refs live in the main column
 * — so they don't crowd the narrow metadata rail and the relation pickers keep
 * a readable width.
 */
export function NewIssueRelationFields({
  isSubmitting,
  existingIssues,
  relations,
  parentId,
  dependsOn,
  blocks,
  relatedTo,
  externalRefs,
  setParentId,
  setDependsOn,
  setBlocks,
  setRelatedTo,
  setExternalRefs,
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
  externalRefs: ExternalRef[];
  setParentId: (value: string) => void;
  setDependsOn: (value: string[]) => void;
  setBlocks: (value: string[]) => void;
  setRelatedTo: (value: string[]) => void;
  setExternalRefs: (value: ExternalRef[]) => void;
  renderEnrichable: RenderEnrichable;
  renderFieldLabel: RenderFieldLabel;
}) {
  return (
    <>
      <IssueFormSection title="Relationships">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            {renderFieldLabel("parent_id", "new-issue-parent", "Parent")}
            {renderEnrichable(
              "parent_id",
              <IssueRelationInput
                id="new-issue-parent"
                label="Parent"
                hideLabel
                value={parentId ? [parentId] : []}
                allIssues={existingIssues}
                relationGraph={relations}
                onChange={(next) => setParentId(next[0] ?? "")}
                disabled={isSubmitting}
                maxItems={1}
              />,
            )}
          </div>
          <div className="flex flex-col gap-1">
            {renderFieldLabel(
              "depends_on",
              "new-issue-depends-on",
              "Depends on",
            )}
            {renderEnrichable(
              "depends_on",
              <IssueRelationInput
                id="new-issue-depends-on"
                label="Depends on"
                hideLabel
                value={dependsOn}
                allIssues={existingIssues}
                relationGraph={relations}
                onChange={setDependsOn}
                disabled={isSubmitting}
              />,
            )}
          </div>
          <div className="flex flex-col gap-1">
            {renderFieldLabel("blocks", "new-issue-blocks", "Blocks")}
            {renderEnrichable(
              "blocks",
              <IssueRelationInput
                id="new-issue-blocks"
                label="Blocks"
                hideLabel
                value={blocks}
                allIssues={existingIssues}
                relationGraph={relations}
                onChange={setBlocks}
                disabled={isSubmitting}
              />,
            )}
          </div>
          <div className="flex flex-col gap-1">
            {renderFieldLabel("related_to", "new-issue-related-to", "Related")}
            {renderEnrichable(
              "related_to",
              <IssueRelationInput
                id="new-issue-related-to"
                label="Related"
                hideLabel
                value={relatedTo}
                allIssues={existingIssues}
                relationGraph={relations}
                onChange={setRelatedTo}
                disabled={isSubmitting}
              />,
            )}
          </div>
        </div>
      </IssueFormSection>

      {renderEnrichable(
        "external_refs",
        <IssueRefsEditor
          externalRefs={externalRefs}
          implementationRefs={[]}
          onExternalRefsChange={setExternalRefs}
          disabled={isSubmitting}
          idPrefix="new-issue-refs"
        />,
      )}
    </>
  );
}

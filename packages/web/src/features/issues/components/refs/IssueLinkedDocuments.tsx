"use client";

import { useAddIssueReference } from "@/features/issues/hooks/mutations/useAddIssueReference";
import { useRemoveIssueReference } from "@/features/issues/hooks/mutations/useRemoveIssueReference";
import { useIssueReferences } from "@/features/issues/hooks/queries/useIssueReferences";
import { akbIssueDocumentUri } from "@reef/core";
import { useMemo } from "react";
import { ISSUE_SECTION_HEADER_CLASS } from "../shared/IssueFormSection";
import { DocumentRefCard } from "./DocumentRefCard";
import { DocumentRefInput } from "./DocumentRefInput";

/**
 * The issue detail's "Linked documents" section (REEF-083): akb documents this
 * issue references, as akb-native `references` relation edges. Unlike
 * external_refs / implementation_refs (issue-metadata patches owned by the
 * parent form), references are a separate relation API, so this component owns
 * its own data + mutations rather than being a controlled child.
 */
interface IssueLinkedDocumentsProps {
  issueId: string;
  vault: string;
  disabled?: boolean;
}

export function IssueLinkedDocuments({
  issueId,
  vault,
  disabled = false,
}: IssueLinkedDocumentsProps) {
  const { data: references = [] } = useIssueReferences(issueId, vault);
  const addReference = useAddIssueReference();
  const removeReference = useRemoveIssueReference();

  // Exclude the issue's own document (akb rejects a self-referencing edge)
  // alongside the already-linked documents. Stable identity (react-query keeps
  // `references` referentially stable while unchanged) so the picker's candidate
  // filter isn't rebuilt every render.
  const existingUris = useMemo(
    () => [
      akbIssueDocumentUri(vault, issueId),
      ...references.map((reference) => reference.uri),
    ],
    [vault, issueId, references],
  );

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className={ISSUE_SECTION_HEADER_CLASS}>Linked documents</h3>

      {references.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          {references.map((reference) => (
            <DocumentRefCard
              key={reference.uri}
              reference={reference}
              disabled={disabled || removeReference.isPending}
              onRemove={() =>
                removeReference.mutate({
                  issueId,
                  vault,
                  targetUri: reference.uri,
                })
              }
            />
          ))}
        </div>
      ) : null}

      <DocumentRefInput
        vault={vault}
        existingUris={existingUris}
        disabled={disabled}
        pending={addReference.isPending}
        onAdd={(uri) => addReference.mutate({ issueId, vault, targetUri: uri })}
      />

      {addReference.isError ? (
        <p className="text-xs text-destructive">
          Couldn't link that document. Try again.
        </p>
      ) : null}
    </section>
  );
}

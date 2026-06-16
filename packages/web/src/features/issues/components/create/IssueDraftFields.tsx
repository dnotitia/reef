"use client";

import { MarkdownEditor } from "@/components/MarkdownEditor";
import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { Input } from "@/components/ui/input";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import { PRIORITY_OPTIONS, PriorityBadge } from "@/components/ui/priority-dot";
import { NO_SELECTION } from "@reef/core/fields";
import { type ReactNode, type Ref, useId } from "react";
import type { PrioritySelection } from "../../lib/issueDraftForm";
import { IssueFieldRow } from "../shared/IssueFieldRow";
import { IssueFormSection } from "../shared/IssueFormSection";

/** The fields this component owns internally (vs. slot-injected ones). */
export type DraftFieldKey = "title" | "priority" | "labels" | "content";

/**
 * Optional per-field render override. Returning `control` unchanged is a
 * no-op; consumers (e.g. inline AI enrichment) can wrap or replace a control.
 */
export type RenderDraftField = (
  field: DraftFieldKey,
  control: ReactNode,
) => ReactNode;

interface IssueDraftFieldsProps {
  title: string;
  onTitleChange: (title: string) => void;
  priority: PrioritySelection;
  onPriorityChange: (priority: PrioritySelection) => void;
  labels: readonly string[];
  onLabelsChange: (labels: string[]) => void;
  body: string;
  onBodyChange: (body: string) => void;
  disabled?: boolean;
  titleAction?: ReactNode;
  primaryField?: ReactNode;
  secondaryField?: ReactNode;
  /**
   * Layout of the draft fields.
   * - `stack` (default): one column — Details, then `beforeDescription`, then
   *   Description. The AI draft review surface uses this.
   * - `split` (REEF-075): a main column (Title + Description + `mainExtra`)
   *   beside a right rail (Details + `railSlot`), mirroring the issue detail
   *   screen so metadata does not pushes the description down the page.
   */
  layout?: "stack" | "split";
  /** Stack layout just: rendered between Details and Description. */
  beforeDescription?: ReactNode;
  /** Split layout just: rendered in the right rail, after Details. */
  railSlot?: ReactNode;
  /** Split layout just: rendered in the main column, after Description. */
  mainExtra?: ReactNode;
  descriptionAction?: ReactNode;
  /** Wraps/overrides the internally-owned controls; defaults to passthrough. */
  renderField?: RenderDraftField;
  /** Lets the parent focus the title input (e.g. on a failed submit). */
  titleInputRef?: Ref<HTMLInputElement>;
  titleId?: string;
  labelsId?: string;
  titleTestId?: string;
  priorityTestId?: string;
  labelsTestId?: string;
  bodyTestId?: string;
  titlePlaceholder?: string;
  bodyPlaceholder?: string;
}

/**
 * Shared issue draft editor used by both manual issue creation and AI draft
 * review. Keeping these fields together makes label parsing and markdown
 * authoring behave the same across entry points.
 */
export function IssueDraftFields({
  title,
  onTitleChange,
  priority,
  onPriorityChange,
  labels,
  onLabelsChange,
  body,
  onBodyChange,
  disabled = false,
  titleAction,
  primaryField,
  secondaryField,
  layout = "stack",
  beforeDescription,
  railSlot,
  mainExtra,
  descriptionAction,
  renderField,
  titleInputRef,
  titleId = "issue-draft-title",
  labelsId = "issue-draft-labels",
  titleTestId,
  priorityTestId,
  labelsTestId,
  bodyTestId,
  titlePlaceholder = "Issue title",
  bodyPlaceholder = "Describe the issue…",
}: IssueDraftFieldsProps) {
  const priorityLabelId = useId();
  const wrap = (field: DraftFieldKey, control: ReactNode): ReactNode =>
    renderField ? renderField(field, control) : control;
  const fieldGridClass =
    primaryField && secondaryField
      ? "grid grid-cols-1 gap-3 md:grid-cols-3"
      : primaryField || secondaryField
        ? "grid grid-cols-1 gap-3 md:grid-cols-2"
        : "grid grid-cols-1 gap-3";

  const titleField = (
    <div className="flex flex-col gap-1">
      <div className="flex items-end justify-between gap-2">
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor={titleId}
        >
          Title
        </label>
        {titleAction}
      </div>
      {wrap(
        "title",
        <Input
          ref={titleInputRef}
          id={titleId}
          data-testid={titleTestId}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={titlePlaceholder}
          autoFocus
          disabled={disabled}
        />,
      )}
    </div>
  );

  // Extracted so the stack layout (grid cell) and the split layout (property
  // row) share one control without duplicating the enrichment `wrap`.
  const priorityControl = wrap(
    "priority",
    <EnumSelectField
      value={priority}
      onValueChange={(value) => onPriorityChange(value as PrioritySelection)}
      options={PRIORITY_OPTIONS}
      renderItem={(p) => <PriorityBadge priority={p} />}
      placeholder="No priority"
      noneOption={{ value: NO_SELECTION, label: "No priority" }}
      testId={priorityTestId}
      ariaLabelledby={priorityLabelId}
      disabled={disabled}
    />,
  );

  const inlineFields = (
    <div className={fieldGridClass}>
      {primaryField}

      <div className="flex flex-col gap-1">
        <span
          id={priorityLabelId}
          className="text-xs font-medium text-muted-foreground"
        >
          Priority
        </span>
        {priorityControl}
      </div>

      {secondaryField}
    </div>
  );

  const labelsField = (
    <div className="flex flex-col gap-1">
      <label
        className="text-xs font-medium text-muted-foreground"
        htmlFor={labelsId}
      >
        Labels
      </label>
      {wrap(
        "labels",
        <LabelChipInput
          id={labelsId}
          data-testid={labelsTestId}
          value={labels}
          onChange={onLabelsChange}
          placeholder="Add a label and press Enter…"
          disabled={disabled}
        />,
      )}
    </div>
  );

  const descriptionField = (
    <IssueFormSection title="Description" action={descriptionAction}>
      <div data-testid={bodyTestId}>
        {wrap(
          "content",
          <MarkdownEditor
            value={body}
            onChange={onBodyChange}
            placeholder={bodyPlaceholder}
            readOnly={disabled}
            ariaLabel="Issue description"
          />,
        )}
      </div>
    </IssueFormSection>
  );

  // Split layout (REEF-075): Title + Description own the main column so the
  // writing area stays prominent, while Details and the injected `railSlot`
  // (People / Planning) move to a right rail that stacks under the main column
  // below `lg`. Mirrors the issue detail screen's main/aside split.
  if (layout === "split") {
    return (
      // Rail track 340px matches the issue detail rail (REEF-167) so the same
      // metadata reads at the same width on both the create and edit surfaces.
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {titleField}
          {descriptionField}
          {mainExtra}
        </div>
        <aside className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          {/* Details as property rows (REEF-167): Type arrives as a row-shaped
              `primaryField`, Priority gets its own row, so the create rail
              mirrors the issue detail rail instead of a `grid-cols-2` half-grid.
              Labels stays stacked — its chip input wraps to multiple lines, so
              full width reads better than a fixed-gutter row. */}
          <IssueFormSection title="Details">
            {primaryField}
            <IssueFieldRow label="Priority" labelId={priorityLabelId}>
              {priorityControl}
            </IssueFieldRow>
            {secondaryField}
            {labelsField}
          </IssueFormSection>
          {railSlot}
        </aside>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <IssueFormSection title="Details">
        {titleField}
        {inlineFields}
        {labelsField}
      </IssueFormSection>

      {beforeDescription}

      {descriptionField}
    </div>
  );
}

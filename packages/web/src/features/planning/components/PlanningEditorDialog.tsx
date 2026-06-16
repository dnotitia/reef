"use client";

import { FormSection } from "@/components/FormSection";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { DatePickerField } from "@/components/fields/DatePickerField";
import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import {
  MILESTONE_STATUS_OPTIONS,
  RELEASE_STATUS_OPTIONS,
  SPRINT_STATUS_OPTIONS,
} from "@/components/fields/planningFieldKit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Milestone, Release, Sprint } from "@reef/core";
import { useEffect, useId, useRef } from "react";
import type { PlanningItem, PlanningKind } from "../hooks/usePlanningCatalog";
import { PLANNING_KIND_SINGULAR } from "../lib/planningItems";
import { type EditorState, emptyItem, formatDate } from "./planningPageUtils";

const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";

const STATUS_OPTIONS_BY_KIND: Record<PlanningKind, readonly string[]> = {
  sprints: SPRINT_STATUS_OPTIONS,
  milestones: MILESTONE_STATUS_OPTIONS,
  releases: RELEASE_STATUS_OPTIONS,
};

const NOTES_PLACEHOLDER: Record<PlanningKind, string> = {
  sprints: "Describe the sprint goal…",
  milestones: "What this milestone represents…",
  releases: "Release notes · changes · upgrade notes…",
};

export function PlanningEditorDialog({
  editor,
  formError,
  onClose,
  onChange,
  onSave,
  isSaving,
}: {
  editor: EditorState | null;
  formError: string | null;
  onClose: () => void;
  onChange: (patch: Partial<PlanningItem>) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const kind = editor?.kind ?? "sprints";
  const item = editor?.item ?? emptyItem(kind);
  const nameInputId = useId();
  const nameErrorId = useId();
  const capacityInputId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameMissing = !String(item.name ?? "").trim();
  const nameError = nameMissing ? formError : null;
  const formLevelError = nameError ? null : formError;
  const title =
    editor?.mode === "edit"
      ? `Edit ${PLANNING_KIND_SINGULAR[kind]}`
      : `New ${PLANNING_KIND_SINGULAR[kind]}`;

  useEffect(() => {
    if (nameError) {
      nameInputRef.current?.focus();
    }
  }, [nameError]);

  return (
    <Dialog
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent
        data-testid="planning-editor-dialog"
        showCloseButton={false}
        className="max-h-[88vh] max-w-3xl gap-5 overflow-y-auto overscroll-contain"
        onInteractOutside={(e) => {
          if (isSaving) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isSaving) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {editor?.mode === "edit"
              ? `Update this ${PLANNING_KIND_SINGULAR[kind].toLowerCase()}.`
              : `Add a new ${PLANNING_KIND_SINGULAR[kind].toLowerCase()} to the workspace.`}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <FormSection title="Details">
            <label
              htmlFor={nameInputId}
              className={cn("flex flex-col gap-1", FIELD_LABEL_CLASS)}
            >
              Name
              <Input
                id={nameInputId}
                ref={nameInputRef}
                name="planning-name"
                data-testid="planning-name-input"
                value={item.name ?? ""}
                onChange={(e) => onChange({ name: e.target.value })}
                autoComplete="off"
                disabled={isSaving}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? nameErrorId : undefined}
              />
              {nameError && (
                <span
                  id={nameErrorId}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {nameError}
                </span>
              )}
            </label>
            <StatusField
              kind={kind}
              value={item.status}
              onChange={onChange}
              disabled={isSaving}
            />
            {kind === "sprints" && (
              <label
                htmlFor={capacityInputId}
                className={cn("flex flex-col gap-1", FIELD_LABEL_CLASS)}
              >
                Capacity
                <Input
                  id={capacityInputId}
                  name="capacity_points"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={(item as Partial<Sprint>).capacity_points ?? ""}
                  onChange={(e) =>
                    onChange({
                      capacity_points: e.target.value
                        ? Number(e.target.value)
                        : null,
                    } as Partial<PlanningItem>)
                  }
                  disabled={isSaving}
                />
              </label>
            )}
          </FormSection>

          <FormSection title="Schedule">
            {kind === "sprints" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <DateField
                  label="Start"
                  value={(item as Partial<Sprint>).start_date}
                  disabled={isSaving}
                  onChange={(value) =>
                    onChange({ start_date: value } as Partial<PlanningItem>)
                  }
                />
                <DateField
                  label="End"
                  align="end"
                  value={(item as Partial<Sprint>).end_date}
                  disabled={isSaving}
                  onChange={(value) =>
                    onChange({ end_date: value } as Partial<PlanningItem>)
                  }
                />
              </div>
            )}
            {kind === "milestones" && (
              <DateField
                label="Target"
                value={(item as Partial<Milestone>).target_date}
                disabled={isSaving}
                onChange={(value) =>
                  onChange({ target_date: value } as Partial<PlanningItem>)
                }
              />
            )}
            {kind === "releases" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <DateField
                  label="Target"
                  value={(item as Partial<Release>).target_date}
                  disabled={isSaving}
                  onChange={(value) =>
                    onChange({ target_date: value } as Partial<PlanningItem>)
                  }
                />
                <DateField
                  label="Released"
                  align="end"
                  value={(item as Partial<Release>).released_at}
                  disabled={isSaving}
                  onChange={(value) =>
                    onChange({ released_at: value } as Partial<PlanningItem>)
                  }
                />
              </div>
            )}
          </FormSection>

          <FormSection title="Notes">
            {kind === "sprints" && (
              <MarkdownField
                label="Goal"
                value={(item as Partial<Sprint>).goal}
                disabled={isSaving}
                placeholder={NOTES_PLACEHOLDER.sprints}
                onChange={(value) =>
                  onChange({ goal: value } as Partial<PlanningItem>)
                }
              />
            )}
            {kind === "milestones" && (
              <MarkdownField
                label="Description"
                value={(item as Partial<Milestone>).description}
                disabled={isSaving}
                placeholder={NOTES_PLACEHOLDER.milestones}
                onChange={(value) =>
                  onChange({ description: value } as Partial<PlanningItem>)
                }
              />
            )}
            {kind === "releases" && (
              <MarkdownField
                label="Notes"
                value={(item as Partial<Release>).notes}
                disabled={isSaving}
                placeholder={NOTES_PLACEHOLDER.releases}
                onChange={(value) =>
                  onChange({ notes: value } as Partial<PlanningItem>)
                }
              />
            )}
          </FormSection>
          {formLevelError && (
            <p
              role="alert"
              data-testid="planning-editor-error"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {formLevelError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="planning-save"
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusField({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: PlanningKind;
  value: unknown;
  onChange: (patch: Partial<PlanningItem>) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const options = STATUS_OPTIONS_BY_KIND[kind];

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className={FIELD_LABEL_CLASS}>
        Status
      </span>
      <EnumSelectField
        value={String(value ?? options[0])}
        onValueChange={(status) =>
          onChange({ status } as Partial<PlanningItem>)
        }
        options={options}
        renderItem={(status) => (
          <PlanningStatusBadge kind={kind} status={status} />
        )}
        ariaLabelledby={labelId}
        disabled={disabled}
      />
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  disabled,
  align = "start",
}: {
  label: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  align?: "start" | "end" | "center";
}) {
  const inputId = useId();

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      <DatePickerField
        id={inputId}
        label={label}
        value={formatDate(value)}
        disabled={disabled}
        align={align}
        onChange={(next) => onChange(next || null)}
      />
    </div>
  );
}

function MarkdownField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", FIELD_LABEL_CLASS)}>
      <span>{label}</span>
      <MarkdownEditor
        value={value ?? ""}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={disabled}
        ariaLabel={label}
      />
    </div>
  );
}

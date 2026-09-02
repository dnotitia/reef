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
import {
  useFieldNameLabels,
  usePlanningKindSingularLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Milestone, Release, Sprint } from "@reef/core";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";
import type { PlanningItem, PlanningKind } from "../hooks/usePlanningCatalog";
import { type EditorState, emptyItem, formatDate } from "./planningPageUtils";

const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";

const STATUS_OPTIONS_BY_KIND: Record<PlanningKind, readonly string[]> = {
  sprints: SPRINT_STATUS_OPTIONS,
  milestones: MILESTONE_STATUS_OPTIONS,
  releases: RELEASE_STATUS_OPTIONS,
};

export function PlanningEditorDialog({
  editor,
  focusOriginRef,
  formError,
  onClose,
  onChange,
  onSave,
  isSaving,
}: {
  editor: EditorState | null;
  focusOriginRef: { current: HTMLElement | null };
  formError: string | null;
  onClose: () => void;
  onChange: (patch: Partial<PlanningItem>) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const planningKindSingular = usePlanningKindSingularLabels();
  const fieldNames = useFieldNameLabels();
  const t = useTranslations("planning");
  const common = useTranslations("common");
  const sections = useTranslations("sections");
  const kind = editor?.kind ?? "sprints";
  const item = editor?.item ?? emptyItem(kind);
  const nameInputId = useId();
  const nameErrorId = useId();
  const capacityInputId = useId();
  const formId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameMissing = !String(item.name ?? "").trim();
  const nameError = nameMissing ? formError : null;
  const formLevelError = nameError ? null : formError;
  const title =
    editor?.mode === "edit"
      ? t("editKind", { kind: planningKindSingular[kind] })
      : t("newKind", { kind: planningKindSingular[kind] });

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
        className="grid max-h-[calc(100dvh-2rem)] min-h-0 max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] gap-5 overflow-hidden pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onInteractOutside={(e) => {
          if (isSaving) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isSaving) e.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          const origin = focusOriginRef.current;
          focusOriginRef.current = null;
          if (!origin?.isConnected) return;
          event.preventDefault();
          origin.focus({ preventScroll: true });
        }}
      >
        <DialogHeader data-testid="planning-editor-dialog-header">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {editor?.mode === "edit"
              ? t("editDescription", {
                  kind: planningKindSingular[kind].toLowerCase(),
                })
              : t("createDescription", {
                  kind: planningKindSingular[kind].toLowerCase(),
                })}
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="planning-editor-dialog-body"
          className="min-h-0 min-w-0 overflow-y-auto overscroll-contain"
        >
          <form
            id={formId}
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <FormSection title={sections("details")}>
              <label
                htmlFor={nameInputId}
                className={cn("flex flex-col gap-1", FIELD_LABEL_CLASS)}
              >
                {t("name")}
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
                    className="text-xs text-destructive-text"
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
                  {t("capacity")}
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

            <FormSection title={t("schedule")}>
              {kind === "sprints" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <DateField
                    label={fieldNames.start}
                    value={(item as Partial<Sprint>).start_date}
                    disabled={isSaving}
                    onChange={(value) =>
                      onChange({ start_date: value } as Partial<PlanningItem>)
                    }
                  />
                  <DateField
                    label={t("end")}
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
                  label={t("target")}
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
                    label={t("target")}
                    value={(item as Partial<Release>).target_date}
                    disabled={isSaving}
                    onChange={(value) =>
                      onChange({ target_date: value } as Partial<PlanningItem>)
                    }
                  />
                  <DateField
                    label={t("released")}
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

            <FormSection title={t("notes")}>
              {kind === "sprints" && (
                <MarkdownField
                  label={t("goal")}
                  value={(item as Partial<Sprint>).goal}
                  disabled={isSaving}
                  placeholder={t("notesPlaceholder.sprints")}
                  onChange={(value) =>
                    onChange({ goal: value } as Partial<PlanningItem>)
                  }
                />
              )}
              {kind === "milestones" && (
                <MarkdownField
                  label={fieldNames.description}
                  value={(item as Partial<Milestone>).description}
                  disabled={isSaving}
                  placeholder={t("notesPlaceholder.milestones")}
                  onChange={(value) =>
                    onChange({ description: value } as Partial<PlanningItem>)
                  }
                />
              )}
              {kind === "releases" && (
                <MarkdownField
                  label={t("notes")}
                  value={(item as Partial<Release>).notes}
                  disabled={isSaving}
                  placeholder={t("notesPlaceholder.releases")}
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
                className="rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text"
              >
                {formLevelError}
              </p>
            )}
          </form>
        </div>

        <DialogFooter
          data-testid="planning-editor-dialog-footer"
          className="min-w-0 flex-col gap-2 sm:flex-row sm:justify-end"
        >
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {common("cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            data-testid="planning-save"
            disabled={isSaving}
            busy={isSaving}
            aria-label={common("save")}
            className="w-full sm:w-auto"
          >
            {isSaving ? t("saving") : common("save")}
          </Button>
        </DialogFooter>
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
  const fieldNames = useFieldNameLabels();
  const options = STATUS_OPTIONS_BY_KIND[kind];

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className={FIELD_LABEL_CLASS}>
        {fieldNames.status}
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

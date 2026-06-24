"use client";

import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  useDeleteIssueTemplate,
  useIssueTemplates,
  useUpsertIssueTemplate,
} from "@/features/settings/hooks/useIssueTemplates";
import {
  useEnrichmentEmptyLabels,
  useFieldNameLabels,
} from "@/i18n/fieldLabels";
import {
  type Priority,
  TEMPLATE_NAME_PATTERN,
  type Template,
} from "@reef/core";
import { NO_SELECTION, PRIORITY_OPTIONS } from "@reef/core/fields";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_ISSUE_TEMPLATES } from "../lib/defaultIssueTemplates";

interface EditorState {
  /** Name of the template being edited (locks the name field); `null` when creating. */
  originalName: string | null;
  draft: Template;
}

function emptyDraft(): Template {
  return {
    name: "",
    label: "",
    description: "",
    default_labels: [],
    body: "",
  };
}

/**
 * Settings → Templates. List + inline editor for issue templates in the
 * active workspace.
 *
 * Edits broadcast a cache update so NewIssueDialog's TemplatePicker sees
 * the change on its next read. Rename is intentionally not supported:
 * changing `name` would change the filename, so the user deletes-and-creates.
 */
export function TemplatesSection({ canEdit = true }: { canEdit?: boolean }) {
  const t = useTranslations("toasts");
  const tt = useTranslations("settings.templates");
  const c = useTranslations("common");
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const fieldNames = useFieldNameLabels();
  const empty = useEnrichmentEmptyLabels();
  const query = useIssueTemplates(vault);
  const upsert = useUpsertIssueTemplate(vault);
  const remove = useDeleteIssueTemplate(vault);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [defaultLabels, setDefaultLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const templates = query.data?.templates ?? [];
  const saving = upsert.isPending;
  const deleting = remove.isPending;
  // Non-editors open the editor read (view inspection), so every
  // field control is locked and the save path is hidden (REEF-020).
  const editDisabled = saving || !canEdit;
  const [seeding, setSeeding] = useState(false);

  async function seedDefaults() {
    if (!vault || seeding) return;
    setSeeding(true);
    try {
      await Promise.all(
        DEFAULT_ISSUE_TEMPLATES.map((template) =>
          upsert.mutateAsync({ template }),
        ),
      );
      toast.success(t("templatesSeeded"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("templatesSeedError");
      toast.error(msg);
    } finally {
      setSeeding(false);
    }
  }

  function startCreate() {
    setEditor({ originalName: null, draft: emptyDraft() });
    setDefaultLabels([]);
    setError(null);
  }

  function startEdit(template: Template) {
    setEditor({
      originalName: template.name,
      draft: { ...template },
    });
    setDefaultLabels(template.default_labels);
    setError(null);
  }

  function cancel() {
    setEditor(null);
    setDefaultLabels([]);
    setError(null);
  }

  function updateDraft<K extends keyof Template>(key: K, value: Template[K]) {
    if (!editor) return;
    setEditor({ ...editor, draft: { ...editor.draft, [key]: value } });
  }

  async function save() {
    if (!editor || !vault) return;
    setError(null);

    const draft: Template = {
      ...editor.draft,
      default_labels: defaultLabels,
    };

    if (!TEMPLATE_NAME_PATTERN.test(draft.name)) {
      setError(tt("nameInvalid"));
      return;
    }
    if (draft.label.trim().length === 0) {
      setError(tt("labelRequired"));
      return;
    }
    if (editor.originalName === null) {
      if (templates.some((t) => t.name === draft.name)) {
        setError(tt("nameTaken", { name: draft.name }));
        return;
      }
    }

    try {
      await upsert.mutateAsync({ template: draft });
      toast.success(
        editor.originalName === null
          ? t("templateCreated", { label: draft.label })
          : t("templateSaved", { label: draft.label }),
      );
      cancel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("templateSaveError");
      setError(msg);
      toast.error(msg);
    }
  }

  async function confirmDelete(template: Template) {
    if (!window.confirm(tt("deleteConfirm", { label: template.label }))) {
      return;
    }
    try {
      await remove.mutateAsync({ name: template.name });
      toast.success(t("templateDeleted", { label: template.label }));
      if (editor?.originalName === template.name) cancel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("templateDeleteError");
      toast.error(msg);
    }
  }

  function renderList() {
    if (query.isPending) {
      return (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      );
    }
    if (templates.length === 0 && editor === null) {
      return (
        <div
          className="flex flex-col gap-2"
          data-testid="templates-section-empty"
        >
          {canEdit ? (
            <>
              <p className="text-sm text-muted-foreground">
                {tt("emptyPromptPrefix")} <strong>{tt("newTemplate")}</strong>{" "}
                {tt("emptyPromptSuffix")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void seedDefaults()}
                disabled={saving || deleting || seeding}
                data-testid="templates-seed-defaults"
                className="w-fit"
              >
                {seeding ? tt("seeding") : tt("seedDefaults")}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {tt("emptyReadOnly")}
            </p>
          )}
        </div>
      );
    }
    return (
      <ul className="flex flex-col gap-1" data-testid="templates-list">
        {templates.map((template) => (
          <li
            key={template.name}
            data-testid={`templates-row-${template.name}`}
            className="flex items-start justify-between gap-3 rounded-md border border-border bg-elevated px-3 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">
                {template.label}{" "}
                <code className="ml-1 text-xs text-muted-foreground">
                  {template.name}
                </code>
              </p>
              {template.description && (
                <p className="text-xs text-muted-foreground">
                  {template.description}
                </p>
              )}
            </div>
            {canEdit ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => startEdit(template)}
                  disabled={saving || deleting}
                  data-testid={`templates-edit-${template.name}`}
                >
                  {c("edit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void confirmDelete(template)}
                  disabled={saving || deleting}
                  data-testid={`templates-delete-${template.name}`}
                >
                  {c("delete")}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => startEdit(template)}
                data-testid={`templates-view-${template.name}`}
              >
                {c("view")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (!vaultLoading && !vault) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="templates-section-no-vault"
      >
        {tt("noVault")}
      </p>
    );
  }

  if (query.error) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive"
        data-testid="templates-section-load-error"
      >
        {tt("loadError")} {query.error.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="templates-section">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{tt("shared")}</p>
        {editor === null && canEdit && (
          <Button
            type="button"
            size="sm"
            onClick={startCreate}
            disabled={saving || deleting}
            data-testid="templates-new-button"
          >
            {tt("newTemplate")}
          </Button>
        )}
      </div>

      {renderList()}

      {editor !== null && (
        <div
          className="flex flex-col gap-4 border-t border-border-subtle pt-4"
          data-testid="templates-editor"
        >
          <p className="text-sm font-medium text-foreground">
            {!canEdit
              ? tt("templateDetails")
              : editor.originalName === null
                ? tt("newTemplate")
                : tt("editTemplate")}
          </p>

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold text-foreground">
              {tt("basics")}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 text-xs">
                <label
                  htmlFor="templates-name"
                  className="text-muted-foreground"
                >
                  {tt("name")} <span className="text-destructive">*</span>
                </label>
                <Input
                  id="templates-name"
                  data-testid="templates-name-input"
                  value={editor.draft.name}
                  onChange={(e) => updateDraft("name", e.target.value)}
                  placeholder="bug-report" // i18n-exempt: example slug token
                  disabled={editor.originalName !== null || editDisabled}
                />
                <span className="text-muted-foreground/70">
                  {tt("nameHint")}
                </span>
              </div>

              <div className="flex flex-col gap-1 text-xs">
                <label
                  htmlFor="templates-label"
                  className="text-muted-foreground"
                >
                  {tt("label")} <span className="text-destructive">*</span>
                </label>
                <Input
                  id="templates-label"
                  data-testid="templates-label-input"
                  value={editor.draft.label}
                  onChange={(e) => updateDraft("label", e.target.value)}
                  placeholder="Bug report" // i18n-exempt: example seed label
                  disabled={editDisabled}
                />
              </div>

              <div className="flex flex-col gap-1 text-xs sm:col-span-2">
                <label
                  htmlFor="templates-description"
                  className="text-muted-foreground"
                >
                  {fieldNames.description}
                </label>
                <Input
                  id="templates-description"
                  data-testid="templates-description-input"
                  value={editor.draft.description}
                  onChange={(e) => updateDraft("description", e.target.value)}
                  placeholder={tt("descriptionHint")}
                  disabled={editDisabled}
                />
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold text-foreground">
              {tt("defaults")}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 text-xs">
                <label
                  htmlFor="templates-title-prefix"
                  className="text-muted-foreground"
                >
                  {tt("titlePrefix")}
                </label>
                <Input
                  id="templates-title-prefix"
                  data-testid="templates-title-prefix-input"
                  value={editor.draft.title_prefix ?? ""}
                  onChange={(e) =>
                    updateDraft(
                      "title_prefix",
                      e.target.value.length > 0 ? e.target.value : undefined,
                    )
                  }
                  placeholder="Bug: " // i18n-exempt: example seed title prefix
                  disabled={editDisabled}
                />
              </div>

              <div className="flex flex-col gap-1 text-xs">
                <span
                  id="templates-priority-label"
                  className="text-muted-foreground"
                >
                  {fieldNames.priority}
                </span>
                <Select
                  value={editor.draft.priority ?? NO_SELECTION}
                  onValueChange={(v) =>
                    updateDraft(
                      "priority",
                      v === NO_SELECTION ? undefined : (v as Priority),
                    )
                  }
                  disabled={editDisabled}
                >
                  <SelectTrigger
                    data-testid="templates-priority-trigger"
                    aria-labelledby="templates-priority-label"
                  >
                    <SelectValue placeholder={empty.noPriority} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SELECTION}>
                      {empty.noPriority}
                    </SelectItem>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1 text-xs sm:col-span-2">
                <label
                  htmlFor="templates-labels"
                  className="text-muted-foreground"
                >
                  {tt("defaultLabels")}
                </label>
                <LabelChipInput
                  id="templates-labels"
                  data-testid="templates-labels-input"
                  value={defaultLabels}
                  onChange={setDefaultLabels}
                  placeholder={c("addLabelPlaceholder")}
                  disabled={editDisabled}
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-1 text-xs">
            <span id="templates-body-label" className="text-muted-foreground">
              {tt("body")}
            </span>
            <div aria-labelledby="templates-body-label">
              <MarkdownEditor
                value={editor.draft.body}
                onChange={(v) => updateDraft("body", v)}
                placeholder="## Steps to reproduce..." // i18n-exempt: example body scaffold
                readOnly={editDisabled}
              />
            </div>
          </section>

          {error && (
            <p
              role="alert"
              className="text-xs text-destructive"
              data-testid="templates-editor-error"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancel}
              disabled={saving}
              data-testid="templates-editor-cancel"
            >
              {canEdit ? c("cancel") : c("close")}
            </Button>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={saving}
                data-testid="templates-editor-save"
              >
                {saving ? tt("saving") : c("save")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

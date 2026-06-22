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
  type Priority,
  TEMPLATE_NAME_PATTERN,
  type Template,
} from "@reef/core";
import { NO_SELECTION, PRIORITY_OPTIONS } from "@reef/core/fields";
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
  const { vault, isLoading: vaultLoading } = useActiveVault();
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
      toast.success("Seeded default templates.");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to seed default templates.";
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
      setError("Name must be lowercase letters, digits, and hyphens only.");
      return;
    }
    if (draft.label.trim().length === 0) {
      setError("Label is required.");
      return;
    }
    if (editor.originalName === null) {
      if (templates.some((t) => t.name === draft.name)) {
        setError(
          `A template named "${draft.name}" already exists. Edit it or pick a different name.`,
        );
        return;
      }
    }

    try {
      await upsert.mutateAsync({ template: draft });
      toast.success(
        editor.originalName === null
          ? `Template "${draft.label}" created.`
          : `Template "${draft.label}" saved.`,
      );
      cancel();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save template.";
      setError(msg);
      toast.error(msg);
    }
  }

  async function confirmDelete(template: Template) {
    if (
      !window.confirm(
        `Delete template "${template.label}"? This removes it from the shared workspace.`,
      )
    ) {
      return;
    }
    try {
      await remove.mutateAsync({ name: template.name });
      toast.success(`Template "${template.label}" deleted.`);
      if (editor?.originalName === template.name) cancel();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete template.";
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
                No templates yet. Click <strong>New template</strong> to add
                one, or start with the six defaults (Epic, Story, Task, Bug,
                Spike, Chore).
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
                {seeding ? "Seeding…" : "Seed default templates"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No issue templates in this workspace yet.
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
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void confirmDelete(template)}
                  disabled={saving || deleting}
                  data-testid={`templates-delete-${template.name}`}
                >
                  Delete
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
                View
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
        Choose a workspace above before defining issue templates.
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
        Couldn't load templates: {query.error.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="templates-section">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Issue templates are shared with everyone using this workspace.
        </p>
        {editor === null && canEdit && (
          <Button
            type="button"
            size="sm"
            onClick={startCreate}
            disabled={saving || deleting}
            data-testid="templates-new-button"
          >
            New template
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
              ? "Template details"
              : editor.originalName === null
                ? "New template"
                : "Edit template"}
          </p>

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold text-foreground">Basics</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 text-xs">
                <label
                  htmlFor="templates-name"
                  className="text-muted-foreground"
                >
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="templates-name"
                  data-testid="templates-name-input"
                  value={editor.draft.name}
                  onChange={(e) => updateDraft("name", e.target.value)}
                  placeholder="bug-report"
                  disabled={editor.originalName !== null || editDisabled}
                />
                <span className="text-muted-foreground/70">
                  Lowercase letters, digits, and hyphens.
                </span>
              </div>

              <div className="flex flex-col gap-1 text-xs">
                <label
                  htmlFor="templates-label"
                  className="text-muted-foreground"
                >
                  Label <span className="text-destructive">*</span>
                </label>
                <Input
                  id="templates-label"
                  data-testid="templates-label-input"
                  value={editor.draft.label}
                  onChange={(e) => updateDraft("label", e.target.value)}
                  placeholder="Bug report"
                  disabled={editDisabled}
                />
              </div>

              <div className="flex flex-col gap-1 text-xs sm:col-span-2">
                <label
                  htmlFor="templates-description"
                  className="text-muted-foreground"
                >
                  Description
                </label>
                <Input
                  id="templates-description"
                  data-testid="templates-description-input"
                  value={editor.draft.description}
                  onChange={(e) => updateDraft("description", e.target.value)}
                  placeholder="One-line hint shown under the label."
                  disabled={editDisabled}
                />
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold text-foreground">Defaults</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 text-xs">
                <label
                  htmlFor="templates-title-prefix"
                  className="text-muted-foreground"
                >
                  Title prefix
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
                  placeholder="Bug: "
                  disabled={editDisabled}
                />
              </div>

              <div className="flex flex-col gap-1 text-xs">
                <span
                  id="templates-priority-label"
                  className="text-muted-foreground"
                >
                  Priority
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
                    <SelectValue placeholder="No priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SELECTION}>No priority</SelectItem>
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
                  Default labels
                </label>
                <LabelChipInput
                  id="templates-labels"
                  data-testid="templates-labels-input"
                  value={defaultLabels}
                  onChange={setDefaultLabels}
                  placeholder="Add a label and press Enter…"
                  disabled={editDisabled}
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-1 text-xs">
            <span id="templates-body-label" className="text-muted-foreground">
              Body
            </span>
            <div aria-labelledby="templates-body-label">
              <MarkdownEditor
                value={editor.draft.body}
                onChange={(v) => updateDraft("body", v)}
                placeholder="## Steps to reproduce..."
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
              {canEdit ? "Cancel" : "Close"}
            </Button>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={saving}
                data-testid="templates-editor-save"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

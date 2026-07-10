"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type {
  DevelopmentProfileCatalog,
  DevelopmentTargetConfig,
  DevelopmentTargetItem,
} from "@reef/core";
import {
  DevelopmentTargetConfigSchema,
  renderDevelopmentBranchTemplate,
} from "@reef/core";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  LockKeyhole,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useUpdateDevelopmentTarget } from "../hooks/useDevelopmentTargets";

const DEFAULT_TARGET = {
  enabled: false,
  recipe_path: ".reef/agent.yml",
  runner_profile: "default",
  permission_profile: ":workspace",
  branch_template: "agent/{issue_id}/{run_id}",
} satisfies Omit<DevelopmentTargetConfig, "github_id">;

interface Props {
  vault: string;
  item: DevelopmentTargetItem;
  catalog: DevelopmentProfileCatalog;
  canEdit: boolean;
}

function formFromItem(
  item: DevelopmentTargetItem,
): Omit<DevelopmentTargetConfig, "github_id"> {
  if (!item.config) return DEFAULT_TARGET;
  return {
    enabled: item.config.enabled,
    recipe_path: item.config.recipe_path,
    runner_profile: item.config.runner_profile,
    permission_profile: item.config.permission_profile,
    branch_template: item.config.branch_template,
  };
}

export function DevelopmentTargetCard({
  vault,
  item,
  catalog,
  canEdit,
}: Props) {
  const t = useTranslations("settings.routes.execution");
  const mutation = useUpdateDevelopmentTarget(vault);
  const [draft, setDraft] = useState(() => formFromItem(item));
  const [message, setMessage] = useState<"saved" | "failed" | null>(null);
  const repoName = `${item.repo.owner}/${item.repo.name}`;
  const fieldId = (field: string) =>
    `development-target-${item.repo.github_id}-${field}`;
  const editable = canEdit && !mutation.isPending;
  const currentUnavailable = item.eligibility.reason === "profile_unavailable";
  const branchPreview = draft.branch_template
    ? renderDevelopmentBranchTemplate(draft.branch_template, {
        issue_id: "REEF-381",
        run_id: "run-123",
      })
    : "—";
  const draftIsValid =
    DevelopmentTargetConfigSchema.safeParse({
      github_id: item.repo.github_id,
      ...draft,
    }).success &&
    (!draft.enabled ||
      (catalog.runner_profiles.some(
        (profile) => profile.id === draft.runner_profile,
      ) &&
        catalog.permission_profiles.some(
          (profile) => profile.id === draft.permission_profile,
        )));

  const update = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  async function save() {
    setMessage(null);
    try {
      await mutation.mutateAsync({
        githubId: item.repo.github_id,
        target: draft,
      });
      setMessage("saved");
    } catch {
      setMessage("failed");
    }
  }

  return (
    <article
      className="overflow-hidden rounded-xl border border-border bg-elevated shadow-sm shadow-foreground/[0.03]"
      data-testid={`development-target-${item.repo.github_id}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle bg-surface/60 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch aria-hidden="true" className="size-4 text-brand" />
            <h3 className="truncate font-display text-sm font-semibold text-foreground">
              {repoName}
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("stableIdentity", { id: item.repo.github_id })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              draft.enabled
                ? "text-xs font-medium text-brand"
                : "text-xs text-muted-foreground"
            }
          >
            {draft.enabled ? t("available") : t("notAvailable")}
          </span>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(checked) => update("enabled", checked)}
            aria-label={t("enableLabel", { repo: repoName })}
            disabled={!editable}
          />
        </div>
      </header>

      <div className="grid gap-5 p-5 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 text-xs text-foreground">
          <label htmlFor={fieldId("recipe-path")} className="font-medium">
            {t("recipePath")}
          </label>
          <Input
            id={fieldId("recipe-path")}
            aria-describedby={fieldId("recipe-help")}
            value={draft.recipe_path ?? ""}
            onChange={(event) =>
              update("recipe_path", event.target.value || null)
            }
            placeholder={t("recipePlaceholder")}
            disabled={!editable}
          />
          <span
            id={fieldId("recipe-help")}
            className="font-normal text-muted-foreground"
          >
            {t("recipeHelp")}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 text-xs text-foreground">
          <label htmlFor={fieldId("branch-template")} className="font-medium">
            {t("branchTemplate")}
          </label>
          <Input
            id={fieldId("branch-template")}
            aria-describedby={`${fieldId("branch-help")} ${fieldId("branch-preview")}`}
            value={draft.branch_template ?? ""}
            onChange={(event) =>
              update("branch_template", event.target.value || null)
            }
            placeholder={t("branchPlaceholder", {
              issue_id: "{issue_id}",
              run_id: "{run_id}",
            })}
            disabled={!editable}
          />
          <span
            id={fieldId("branch-help")}
            className="font-normal text-muted-foreground"
          >
            {t("branchHelp")}
          </span>
          <span
            id={fieldId("branch-preview")}
            className="font-mono text-[11px] font-normal text-brand"
          >
            {t("branchPreview", { branch: branchPreview })}
          </span>
        </div>

        <label
          htmlFor={fieldId("runner-profile")}
          className="flex flex-col gap-1.5 text-xs font-medium text-foreground"
        >
          {t("runnerProfile")}
          <select
            id={fieldId("runner-profile")}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-[13px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-50"
            value={draft.runner_profile ?? ""}
            onChange={(event) =>
              update("runner_profile", event.target.value || null)
            }
            disabled={!editable}
          >
            {draft.runner_profile &&
            !catalog.runner_profiles.some(
              (profile) => profile.id === draft.runner_profile,
            ) ? (
              <option value={draft.runner_profile}>
                {t("unavailableProfile", { id: draft.runner_profile })}
              </option>
            ) : null}
            {catalog.runner_profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>

        <label
          htmlFor={fieldId("permission-profile")}
          className="flex flex-col gap-1.5 text-xs font-medium text-foreground"
        >
          {t("permissionProfile")}
          <select
            id={fieldId("permission-profile")}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-[13px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-50"
            value={draft.permission_profile ?? ""}
            onChange={(event) =>
              update("permission_profile", event.target.value || null)
            }
            disabled={!editable}
          >
            {draft.permission_profile &&
            !catalog.permission_profiles.some(
              (profile) => profile.id === draft.permission_profile,
            ) ? (
              <option value={draft.permission_profile}>
                {t("unavailableProfile", { id: draft.permission_profile })}
              </option>
            ) : null}
            {catalog.permission_profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {currentUnavailable ? (
            <AlertTriangle
              aria-hidden="true"
              className="size-3.5 text-warning"
            />
          ) : (
            <LockKeyhole aria-hidden="true" className="size-3.5" />
          )}
          <span>
            {currentUnavailable ? t("profileAction") : t("accessSummary")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {message === "saved" ? (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="size-3.5" />
              {t("saved")}
            </span>
          ) : null}
          {message === "failed" ? (
            <span role="alert" className="text-xs text-destructive">
              {t("saveFailed")}
            </span>
          ) : null}
          {!draftIsValid && canEdit ? (
            <span role="alert" className="text-xs text-destructive">
              {t("invalidTarget")}
            </span>
          ) : null}
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!editable || !draftIsValid}
          >
            {mutation.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </footer>
    </article>
  );
}

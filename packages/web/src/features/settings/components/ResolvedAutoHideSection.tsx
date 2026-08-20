"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  useProjectConfig,
  useUpdateProjectConfig,
} from "@/features/settings/hooks/useProjectConfig";
import { DEFAULT_CONFIG } from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReadOnlyValue } from "./ReadOnlyValue";

interface ParsedDays {
  completed: number;
  canceled: number;
}

function parseDaysInput(
  value: string,
  label: string,
  currentValue: number,
): { value: number } | { error: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { value: currentValue };

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { error: `${label} must be a whole number of days, zero or more.` };
  }
  return { value: parsed };
}

function daysLabel(value: number): string {
  return `${value} days`;
}

export function ResolvedAutoHideSection({
  canEdit = true,
}: {
  canEdit?: boolean;
}) {
  const t = useTranslations("settings.config");
  const { vault: activeVault, isLoading: vaultLoading } = useActiveVault();
  const configQuery = useProjectConfig(activeVault);
  const updateConfig = useUpdateProjectConfig(activeVault);
  const queryClient = useQueryClient();
  const [saveMessage, setSaveMessage] = useState("");

  const completedDays =
    configQuery.data?.config.stale_hide_completed_days ??
    DEFAULT_CONFIG.stale_hide_completed_days;
  const canceledDays =
    configQuery.data?.config.stale_hide_canceled_days ??
    DEFAULT_CONFIG.stale_hide_canceled_days;

  const isLoading = vaultLoading || configQuery.isPending;

  if (!vaultLoading && !activeVault) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="resolved-auto-hide-no-vault"
      >
        {t("resolvedAutoHide.noVault")}
      </p>
    );
  }

  if (configQuery.error) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive-text"
        data-testid="resolved-auto-hide-load-error"
      >
        {t("loadError")} {configQuery.error.message}
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="resolved-auto-hide-section"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground/90">
          {t("resolvedAutoHide.label")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("resolvedAutoHide.description")}
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-8 w-52" />
        </div>
      ) : canEdit ? (
        <ResolvedAutoHideEditor
          key={`${completedDays}:${canceledDays}`}
          activeVault={activeVault}
          completedDays={completedDays}
          canceledDays={canceledDays}
          saving={updateConfig.isPending}
          onSave={async (next) => {
            await updateConfig.mutateAsync({
              patch: {
                stale_hide_completed_days: next.completed,
                stale_hide_canceled_days: next.canceled,
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["issues"] });
            setSaveMessage(t("saved"));
          }}
          saveMessage={saveMessage}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("resolvedAutoHide.hideCompletedLabel")}
            </p>
            <ReadOnlyValue
              value={daysLabel(completedDays)}
              testId="resolved-auto-hide-completed-readonly"
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("resolvedAutoHide.hideCanceledLabel")}
            </p>
            <ReadOnlyValue
              value={daysLabel(canceledDays)}
              testId="resolved-auto-hide-canceled-readonly"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ResolvedAutoHideEditor({
  activeVault,
  completedDays,
  canceledDays,
  saving,
  onSave,
  saveMessage,
}: {
  activeVault: string;
  completedDays: number;
  canceledDays: number;
  saving: boolean;
  onSave: (days: ParsedDays) => Promise<void>;
  saveMessage: string;
}) {
  const t = useTranslations("settings.config");
  const [completedDraft, setCompletedDraft] = useState(String(completedDays));
  const [canceledDraft, setCanceledDraft] = useState(String(canceledDays));
  const [completedError, setCompletedError] = useState<string | null>(null);
  const [canceledError, setCanceledError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty =
    completedDraft.trim() !== String(completedDays) ||
    canceledDraft.trim() !== String(canceledDays);

  async function handleSave() {
    setCompletedError(null);
    setCanceledError(null);
    setSaveError(null);
    if (!activeVault) {
      setSaveError(t("resolvedAutoHide.selectWorkspaceFirst"));
      return;
    }

    const completed = parseDaysInput(
      completedDraft,
      t("resolvedAutoHide.hideCompletedLabel"),
      completedDays,
    );
    if ("error" in completed) {
      setCompletedError(
        t("resolvedAutoHide.invalid", {
          label: t("resolvedAutoHide.hideCompletedLabel"),
        }),
      );
      return;
    }

    const canceled = parseDaysInput(
      canceledDraft,
      t("resolvedAutoHide.hideCanceledLabel"),
      canceledDays,
    );
    if ("error" in canceled) {
      setCanceledError(
        t("resolvedAutoHide.invalid", {
          label: t("resolvedAutoHide.hideCanceledLabel"),
        }),
      );
      return;
    }

    try {
      await onSave({ completed: completed.value, canceled: canceled.value });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("resolvedAutoHide.saveError");
      setSaveError(msg);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label
          htmlFor="resolved-auto-hide-completed-input"
          className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
        >
          {t("resolvedAutoHide.hideCompletedLabel")}
          <Input
            id="resolved-auto-hide-completed-input"
            data-testid="resolved-auto-hide-completed-input"
            value={completedDraft}
            onChange={(e) => {
              setCompletedDraft(e.target.value);
              setCompletedError(null);
              setSaveError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty && !saving) {
                e.preventDefault();
                void handleSave();
              }
            }}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className="w-52"
            disabled={saving}
            aria-invalid={completedError != null}
            aria-describedby={
              completedError ? "resolved-auto-hide-completed-error" : undefined
            }
          />
          {completedError && (
            <span
              id="resolved-auto-hide-completed-error"
              data-testid="resolved-auto-hide-completed-error"
              role="alert"
              className="text-xs font-normal text-destructive-text"
            >
              {completedError}
            </span>
          )}
        </label>
        <label
          htmlFor="resolved-auto-hide-canceled-input"
          className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
        >
          {t("resolvedAutoHide.hideCanceledLabel")}
          <Input
            id="resolved-auto-hide-canceled-input"
            data-testid="resolved-auto-hide-canceled-input"
            value={canceledDraft}
            onChange={(e) => {
              setCanceledDraft(e.target.value);
              setCanceledError(null);
              setSaveError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty && !saving) {
                e.preventDefault();
                void handleSave();
              }
            }}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className="w-52"
            disabled={saving}
            aria-invalid={canceledError != null}
            aria-describedby={
              canceledError ? "resolved-auto-hide-canceled-error" : undefined
            }
          />
          {canceledError && (
            <span
              id="resolved-auto-hide-canceled-error"
              data-testid="resolved-auto-hide-canceled-error"
              role="alert"
              className="text-xs font-normal text-destructive-text"
            >
              {canceledError}
            </span>
          )}
        </label>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          data-testid="resolved-auto-hide-save"
        >
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground"
        data-testid="resolved-auto-hide-save-status"
      >
        {saving ? t("saving") : saveMessage}
      </p>
      {saveError && (
        <p
          role="alert"
          className="text-xs text-destructive-text"
          data-testid="resolved-auto-hide-error"
        >
          {saveError}
        </p>
      )}
    </>
  );
}

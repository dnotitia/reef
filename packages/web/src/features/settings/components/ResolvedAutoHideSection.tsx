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
  const { vault: activeVault, isLoading: vaultLoading } = useActiveVault();
  const configQuery = useProjectConfig(activeVault);
  const updateConfig = useUpdateProjectConfig(activeVault);
  const queryClient = useQueryClient();

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
        Choose a workspace above before configuring completed issue visibility.
      </p>
    );
  }

  if (configQuery.error) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive"
        data-testid="resolved-auto-hide-load-error"
      >
        Couldn't load workspace config: {configQuery.error.message}
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
          Completed issues
        </p>
        <p className="text-xs text-muted-foreground">
          Controls when resolved issues leave the default board and list.
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
          }}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              Hide completed after N days
            </p>
            <ReadOnlyValue
              value={daysLabel(completedDays)}
              testId="resolved-auto-hide-completed-readonly"
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              Hide canceled after N days
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
}: {
  activeVault: string;
  completedDays: number;
  canceledDays: number;
  saving: boolean;
  onSave: (days: ParsedDays) => Promise<void>;
}) {
  const [completedDraft, setCompletedDraft] = useState(String(completedDays));
  const [canceledDraft, setCanceledDraft] = useState(String(canceledDays));
  const [error, setError] = useState<string | null>(null);

  const dirty =
    completedDraft.trim() !== String(completedDays) ||
    canceledDraft.trim() !== String(canceledDays);

  async function handleSave() {
    setError(null);
    if (!activeVault) {
      setError("Select a workspace in Settings first.");
      return;
    }

    const completed = parseDaysInput(
      completedDraft,
      "Hide completed after N days",
      completedDays,
    );
    if ("error" in completed) {
      setError(completed.error);
      return;
    }

    const canceled = parseDaysInput(
      canceledDraft,
      "Hide canceled after N days",
      canceledDays,
    );
    if ("error" in canceled) {
      setError(canceled.error);
      return;
    }

    try {
      await onSave({ completed: completed.value, canceled: canceled.value });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to save completed issue visibility.";
      setError(msg);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label
          htmlFor="resolved-auto-hide-completed-input"
          className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
        >
          Hide completed after N days
          <Input
            id="resolved-auto-hide-completed-input"
            data-testid="resolved-auto-hide-completed-input"
            value={completedDraft}
            onChange={(e) => {
              setCompletedDraft(e.target.value);
              setError(null);
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
            aria-invalid={error != null}
          />
        </label>
        <label
          htmlFor="resolved-auto-hide-canceled-input"
          className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
        >
          Hide canceled after N days
          <Input
            id="resolved-auto-hide-canceled-input"
            data-testid="resolved-auto-hide-canceled-input"
            value={canceledDraft}
            onChange={(e) => {
              setCanceledDraft(e.target.value);
              setError(null);
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
            aria-invalid={error != null}
          />
        </label>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          data-testid="resolved-auto-hide-save"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="resolved-auto-hide-error"
        >
          {error}
        </p>
      )}
    </>
  );
}

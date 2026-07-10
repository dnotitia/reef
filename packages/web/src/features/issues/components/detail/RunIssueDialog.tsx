"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequestIssueRun } from "@/features/issues/hooks/mutations/useRequestIssueRun";
import type { IssueRunTargetOption } from "@reef/core";
import { GitBranch, LockKeyhole, Play, Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export function RunIssueDialog({
  issueId,
  vault,
  open,
  options,
  selectedGithubId,
  onSelectedGithubIdChange,
  onOpenChange,
}: {
  issueId: string;
  vault: string;
  open: boolean;
  options: readonly IssueRunTargetOption[];
  selectedGithubId: number | null;
  onSelectedGithubIdChange: (githubId: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("issues.run");
  const mutation = useRequestIssueRun(vault, issueId);
  const selected = options.find(
    (option) => option.github_id === selectedGithubId,
  );

  async function requestRun() {
    if (!selected) return;
    try {
      const result = await mutation.mutateAsync({
        githubId: selected.github_id,
        requestId: crypto.randomUUID(),
      });
      toast.success(
        result.conflict ? t("alreadyQueuedToast") : t("requestedToast"),
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("requestFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-md bg-brand/10 text-brand">
              <Play className="size-4 fill-current" />
            </span>
            {t("dialogTitle")}
          </DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="issue-run-target"
            >
              {t("repository")}
            </label>
            {options.length === 1 && selected ? (
              <div
                id="issue-run-target"
                data-testid="issue-run-single-target"
                className="flex min-h-10 items-center gap-2 rounded-md border bg-surface-subtle px-3 text-sm"
              >
                <Server className="size-4 text-brand" />
                <span className="font-medium">{selected.repo}</span>
              </div>
            ) : (
              <Select
                value={selectedGithubId == null ? "" : String(selectedGithubId)}
                onValueChange={(value) =>
                  onSelectedGithubIdChange(Number(value))
                }
              >
                <SelectTrigger
                  id="issue-run-target"
                  data-testid="issue-run-target-select"
                >
                  <SelectValue placeholder={t("selectRepository")} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem
                      key={option.github_id}
                      value={String(option.github_id)}
                    >
                      {option.repo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selected ? (
            <div className="grid gap-2 rounded-md border border-brand/20 bg-brand/[0.04] p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <GitBranch className="size-3.5 text-brand" />
                <span>{selected.runner_profile.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <LockKeyhole className="size-3.5 text-brand" />
                <span>{selected.permission_profile.label}</span>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            data-testid="request-issue-run"
            className="bg-brand text-white hover:bg-brand/90"
            disabled={!selected || mutation.isPending}
            onClick={() => void requestRun()}
          >
            <Play className="size-3.5 fill-current" />
            {mutation.isPending ? t("requesting") : t("requestRun")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

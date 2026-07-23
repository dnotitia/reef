"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateSavedIssueView } from "@/features/issues/hooks/mutations/useSavedIssueViewMutations";
import { createSavedIssueViewPayload } from "@/features/issues/lib/issueViewCodec";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function SaveIssueViewDialog() {
  const { vault } = useActiveVault();
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") ?? "board";
  const payload = createSavedIssueViewPayload(filter, searchQuery, view);
  const hasState = Object.keys(payload.query).length > 0;
  const mutation = useCreateSavedIssueView(vault);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const t = useTranslations("issues.savedViews");
  const c = useTranslations("common");
  if (!hasState || !vault) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await mutation.mutateAsync({ name, payload });
      setOpen(false);
      setName("");
    } catch {
      // The mutation error is rendered inline and remains editable.
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
        >
          <Save className="size-3.5" aria-hidden="true" />
          {t("save")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm" data-testid="save-view-dialog">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("saveTitle")}</DialogTitle>
            <DialogDescription>{t("saveDescription")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label
              htmlFor="saved-view-name"
              className="mb-1.5 block text-xs font-medium"
            >
              {t("name")}
            </label>
            <Input
              id="saved-view-name"
              name="saved-view-name"
              autoComplete="off"
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={mutation.isError}
            />
            {mutation.error ? (
              <p className="mt-1.5 text-xs text-destructive" role="alert">
                {mutation.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {c("cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

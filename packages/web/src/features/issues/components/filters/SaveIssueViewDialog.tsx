"use client";

import { Button } from "@/components/ui/button";
import {
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "@/components/ui/comboboxChrome";
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
import { Spinner } from "@/components/ui/spinner";
import { useCreateSavedIssueView } from "@/features/issues/hooks/mutations/useSavedIssueViewMutations";
import {
  SAVED_ISSUE_VIEW_CONTEXT_PARAM,
  createSavedIssueViewPayload,
  hasSavableIssueViewState,
} from "@/features/issues/lib/issueViewCodec";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { cn } from "@/lib/utils";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function SaveIssueViewDialog() {
  const { vault } = useActiveVault();
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const view = searchParams?.get("view") ?? "board";
  const payload = createSavedIssueViewPayload(filter, searchQuery, view);
  const mutation = useCreateSavedIssueView(vault);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const t = useTranslations("issues.savedViews");
  const c = useTranslations("common");
  if (!vault || !hasSavableIssueViewState(payload, searchParams)) return null;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) mutation.reset();
    if (!nextOpen && !mutation.isPending) setName("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await mutation.mutateAsync({ name, payload });
      const params = new URLSearchParams(searchParams);
      params.set(SAVED_ISSUE_VIEW_CONTEXT_PARAM, created.id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      setOpen(false);
      setName("");
      toast.success(t("created"));
    } catch {
      // The mutation error is rendered inline and remains editable.
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(CBX_TRIGGER_CHIP, CBX_TRIGGER_CHIP_INACTIVE, "gap-1.5")}
        >
          <Save className="size-3.5" aria-hidden="true" />
          {t("save")}
        </button>
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
              size="sm"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              {c("cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!name.trim() || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Spinner className="size-3.5" aria-hidden="true" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

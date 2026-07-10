"use client";

import { Button } from "@/components/ui/button";
import { withVault } from "@/lib/workspaceHref";
import { ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

interface BoardBulkEditShortcutProps {
  vault: string;
}

/**
 * The board stays a drag-and-scan surface. This task-oriented shortcut hands
 * bulk work to List while preserving the active filter/search/sort URL state.
 */
export function BoardBulkEditShortcut({ vault }: BoardBulkEditShortcutProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bulk = useTranslations("issues.bulk");
  const [isPending, startTransition] = useTransition();

  const openList = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set("view", "list");
    startTransition(() => {
      router.push(withVault(vault, `/issues?${next.toString()}`), {
        scroll: false,
      });
    });
  }, [router, searchParams, vault]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      aria-busy={isPending}
      aria-label={bulk("editInList")}
      title={bulk("editInList")}
      data-testid="board-bulk-edit-shortcut"
      onClick={openList}
    >
      <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden xl:inline">{bulk("editInList")}</span>
    </Button>
  );
}

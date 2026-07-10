"use client";

import { Button } from "@/components/ui/button";
import { withVault } from "@/lib/workspaceHref";
import { ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

interface BoardBulkEditShortcutProps {
  vault: string;
}

/**
 * The board stays a drag-and-scan surface. This task-oriented shortcut hands
 * bulk work to List while preserving the active filter/search/sort URL state.
 */
export function BoardBulkEditShortcut({ vault }: BoardBulkEditShortcutProps) {
  const searchParams = useSearchParams();
  const bulk = useTranslations("issues.bulk");
  const href = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.set("view", "list");
    return withVault(vault, `/issues?${next.toString()}`);
  }, [searchParams, vault]);

  return (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <Link
        href={href}
        scroll={false}
        aria-label={bulk("editInList")}
        title={bulk("editInList")}
        data-testid="board-bulk-edit-shortcut"
      >
        <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{bulk("editInList")}</span>
      </Link>
    </Button>
  );
}

"use client";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ISSUE_LIST_OPTIONAL_COLUMNS,
  type IssueListOptionalColumnKey,
} from "@/features/issues/components/shared/issueTableContract";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { Columns3, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

interface IssueListColumnsControlProps {
  selectedColumns: readonly IssueListOptionalColumnKey[];
  onToggle: (column: IssueListOptionalColumnKey) => void;
}

export function IssueListColumnsControl({
  selectedColumns,
  onToggle,
}: IssueListColumnsControlProps) {
  const t = useTranslations("issues.list");
  const fieldNames = useFieldNameLabels();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="h-8 gap-1.5 rounded-md border border-border bg-elevated px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
        aria-label={t("columns")}
        data-testid="issue-list-columns-control"
      >
        <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t("columns")}</span>
        <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="issue-list-columns-menu">
        <DropdownMenuLabel>{t("columnsOptions")}</DropdownMenuLabel>
        {ISSUE_LIST_OPTIONAL_COLUMNS.map((column) => {
          const checked = selectedColumns.includes(column);
          return (
            <DropdownMenuCheckboxItem
              key={column}
              checked={checked}
              data-testid={`issue-list-column-${column}`}
              onCheckedChange={() => onToggle(column)}
            >
              {fieldNames[column]}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import {
  CBX_CHEVRON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "@/components/ui/comboboxChrome";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenu,
} from "@/components/ui/dropdown-menu";
import type { IssueFilter } from "@/features/issues/stores/useIssueStore";
import { cn } from "@/lib/utils";
import { Archive, ChevronDown, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";

interface DisplayOptionsFilterProps {
  backlogScope: boolean;
  filter: Pick<IssueFilter, "showArchived" | "showStale">;
  setFilter: (patch: Partial<IssueFilter>) => void;
}

function DisplayOptionsTrigger({ active }: { active: boolean }) {
  const t = useTranslations("issues.filters");
  const { open } = useDropdownMenu();

  return (
    <DropdownMenuTrigger
      aria-label={t("displayOptions")}
      className={cn(
        CBX_TRIGGER_CHIP,
        active ? CBX_TRIGGER_CHIP_ACTIVE : CBX_TRIGGER_CHIP_INACTIVE,
      )}
      data-testid="display-options-trigger"
    >
      {t("display")}
      <ChevronDown
        data-open={open}
        aria-hidden="true"
        className={CBX_CHEVRON}
      />
    </DropdownMenuTrigger>
  );
}

export function DisplayOptionsFilter({
  backlogScope,
  filter,
  setFilter,
}: DisplayOptionsFilterProps) {
  const t = useTranslations("issues.filters");

  return (
    <DropdownMenu>
      <DisplayOptionsTrigger
        active={Boolean(filter.showArchived || filter.showStale)}
      />
      <DropdownMenuContent
        align="start"
        className="min-w-[13rem]"
        data-testid="display-options-content"
      >
        <DropdownMenuLabel>{t("displayOptions")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={Boolean(filter.showArchived)}
          keepOpen
          data-testid="show-archived-toggle"
          leading={<Archive className="size-3.5" />}
          onCheckedChange={(checked) =>
            setFilter({ showArchived: checked ? true : undefined })
          }
        >
          {t("showArchived")}
        </DropdownMenuCheckboxItem>
        {!backlogScope ? (
          <DropdownMenuCheckboxItem
            checked={Boolean(filter.showStale)}
            keepOpen
            data-testid="show-stale-toggle"
            leading={<CircleCheck className="size-3.5" />}
            onCheckedChange={(checked) =>
              setFilter({ showStale: checked ? true : undefined })
            }
          >
            {t("showCompleted")}
          </DropdownMenuCheckboxItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

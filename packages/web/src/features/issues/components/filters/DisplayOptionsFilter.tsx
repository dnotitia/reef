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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenu,
} from "@/components/ui/dropdown-menu";
import type { IssueFilter } from "@/features/issues/stores/useIssueStore";
import {
  defaultIssueGroupBy,
  issueGroupByOptions,
  type IssueGroupBy,
  type IssueWorkspaceView,
} from "../../lib/groupBy";
import type { IssueScope } from "../../lib/viewMode";
import { cn } from "@/lib/utils";
import { Archive, ChevronDown, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";

interface DisplayOptionsFilterProps {
  backlogScope: boolean;
  scope?: IssueScope;
  filter: Pick<IssueFilter, "showArchived" | "showStale">;
  setFilter: (patch: Partial<IssueFilter>) => void;
  view?: IssueWorkspaceView;
  groupBy?: IssueGroupBy;
  setGroupBy?: (groupBy: IssueGroupBy) => void;
}

function DisplayOptionsTrigger({
  active,
  summary,
}: {
  active: boolean;
  summary: string;
}) {
  const t = useTranslations("issues.filters");
  const { open } = useDropdownMenu();

  return (
    <DropdownMenuTrigger
      aria-label={summary}
      className={cn(
        CBX_TRIGGER_CHIP,
        active ? CBX_TRIGGER_CHIP_ACTIVE : CBX_TRIGGER_CHIP_INACTIVE,
      )}
      data-testid="display-options-trigger"
    >
      {summary}
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
  scope = backlogScope ? "backlog" : "active",
  filter,
  setFilter,
  view,
  groupBy,
  setGroupBy,
}: DisplayOptionsFilterProps) {
  const t = useTranslations("issues.filters");
  const supportsGrouping = view === "board" || view === "list";
  const groupingActive =
    supportsGrouping &&
    groupBy !== undefined &&
    view !== undefined &&
    groupBy !== defaultIssueGroupBy(scope, view);
  const groupOptions = supportsGrouping ? issueGroupByOptions(scope, view) : [];
  const groupSummary =
    backlogScope && groupBy
      ? t("groupSummary", { group: t(`group.${groupBy}`) })
      : t("display");

  return (
    <DropdownMenu>
      <DisplayOptionsTrigger
        summary={groupSummary}
        active={
          Boolean(filter.showArchived || filter.showStale) || groupingActive
        }
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
        {supportsGrouping && groupBy && setGroupBy ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("groupBy")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={groupBy}
              onValueChange={(value) => {
                if (groupOptions.includes(value as IssueGroupBy)) {
                  setGroupBy(value as IssueGroupBy);
                }
              }}
            >
              {groupOptions.map((value) => (
                <DropdownMenuRadioItem
                  key={value}
                  value={value}
                  data-testid={`group-by-${value}`}
                >
                  {t(`group.${value}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

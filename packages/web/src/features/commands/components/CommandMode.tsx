"use client";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import type {
  BoundAppAction,
  CommandIssueTarget,
  CommandRegistry,
} from "@/features/commands/hooks/useCommandRegistry";
import type {
  CommandPage,
  PaletteFocusPolicy,
} from "@/features/commands/lib/appActionCatalog";
import type { CommandPageState } from "@/features/commands/lib/commandPageStack";
import {
  formatShortcut,
  getShortcutKeys,
  isMacLike,
} from "@/features/shortcuts/lib/shortcuts";
import type { Priority, Status } from "@reef/core";
import {
  Check,
  ChevronRight,
  Languages,
  LayoutDashboard,
  Map as MapIcon,
  Palette,
  Plus,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { CommandAssigneePage } from "./CommandAssigneePage";

interface CommandModeProps {
  state: CommandPageState;
  vault: string;
  target: CommandIssueTarget | null;
  registry: CommandRegistry;
  onPushPage: (page: Exclude<CommandPage, "root">) => void;
  onExecute: (policy: PaletteFocusPolicy, run: () => void) => void;
}

const PAGE_ICONS = {
  navigation: MapIcon,
  view: LayoutDashboard,
  theme: Palette,
  locale: Languages,
  status: LayoutDashboard,
  assignee: UserRound,
  priority: LayoutDashboard,
} as const;

export function CommandMode({
  state,
  vault,
  target,
  registry,
  onPushPage,
  onExecute,
}: CommandModeProps) {
  const t = useTranslations("commands");
  const page = state.pages.at(-1) ?? "root";
  const actions = registry.paletteActions(target);

  const executeAction = (action: BoundAppAction) =>
    onExecute(action.descriptor.focusPolicy, action.run);

  if (page === "assignee" && target) {
    return (
      <CommandAssigneePage
        query={state.query}
        vault={vault}
        target={target}
        registry={registry}
        onExecute={(run) => onExecute("restore", run)}
      />
    );
  }

  if (page !== "root") {
    const pageActions = actions.filter(
      (action) => action.descriptor.parentPage === page,
    );
    return (
      <>
        <CommandEmpty>{t("noCommands")}</CommandEmpty>
        <CommandGroup heading={t(`pages.${page}`)}>
          {pageActions.map((action) => (
            <ActionRow
              key={action.descriptor.id}
              action={action}
              onSelect={() => executeAction(action)}
            />
          ))}
        </CommandGroup>
      </>
    );
  }

  if (state.query.trim()) {
    return (
      <>
        <CommandEmpty>{t("noCommands")}</CommandEmpty>
        {(["navigation", "views", "issues", "preferences"] as const).map(
          (group) => {
            const groupActions = actions.filter(
              (action) => action.descriptor.group === group,
            );
            return groupActions.length > 0 ? (
              <CommandGroup key={group} heading={t(`groups.${group}`)}>
                {groupActions.map((action) => (
                  <ActionRow
                    key={action.descriptor.id}
                    action={action}
                    onSelect={() => executeAction(action)}
                  />
                ))}
              </CommandGroup>
            ) : null;
          },
        )}
      </>
    );
  }

  const newIssue = actions.find(
    (action) => action.descriptor.id === "issue.new",
  );
  const pages: Array<{
    page: Exclude<CommandPage, "root">;
    contextual?: boolean;
  }> = [
    { page: "navigation" },
    { page: "view" },
    { page: "theme" },
    { page: "locale" },
    ...(target
      ? ([
          { page: "status", contextual: true },
          { page: "assignee", contextual: true },
          { page: "priority", contextual: true },
        ] as const)
      : []),
  ];

  return (
    <CommandGroup heading={t("commandsHeading")}>
      {newIssue ? (
        <ActionRow action={newIssue} onSelect={() => executeAction(newIssue)} />
      ) : null}
      {pages.map(({ page: nextPage, contextual }) => {
        const Icon = PAGE_ICONS[nextPage];
        return (
          <CommandItem
            key={nextPage}
            value={`${t(`pages.${nextPage}`)} ${target?.issueId ?? ""}`}
            data-testid="command-page-entry"
            data-command-page={nextPage}
            onSelect={() => onPushPage(nextPage)}
          >
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {t(`pages.${nextPage}`)}
            </span>
            {contextual && target ? (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {target.issueId}
              </span>
            ) : null}
            <ChevronRight
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

function ActionRow({
  action,
  onSelect,
}: {
  action: BoundAppAction;
  onSelect: () => void;
}) {
  const t = useTranslations("commands");
  const { descriptor } = action;
  const value = `${action.label} ${action.keywords.join(" ")} ${
    action.target?.issueId ?? ""
  }`;
  const status = descriptor.id.startsWith("status.")
    ? (descriptor.id.slice("status.".length) as Status)
    : null;
  const priorityValue = descriptor.id.startsWith("priority.")
    ? descriptor.id.slice("priority.".length)
    : null;
  const priority =
    priorityValue && priorityValue !== "none"
      ? (priorityValue as Priority)
      : null;

  return (
    <CommandItem
      value={value}
      keywords={[...action.keywords]}
      data-testid="command-action"
      data-command-id={descriptor.id}
      onSelect={onSelect}
    >
      {descriptor.id === "issue.new" ? (
        <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
      ) : null}
      {status ? (
        <StatusBadge status={status} />
      ) : priority ? (
        <PriorityBadge priority={priority} />
      ) : (
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
      )}
      {status || priority ? (
        <span className="sr-only">{action.label}</span>
      ) : null}
      {action.current ? (
        <Check
          className="ml-auto size-4 text-brand"
          aria-label={t("current")}
        />
      ) : descriptor.shortcut ? (
        <CommandShortcut>
          {formatShortcut(getShortcutKeys(descriptor.shortcut), isMacLike())}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
}

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
  CommandParentPage,
  PaletteFocusPolicy,
} from "@/features/commands/lib/appActionCatalog";
import { getCommandPageDescriptor } from "@/features/commands/lib/appActionCatalog";
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
import type { MouseEvent as ReactMouseEvent } from "react";
import { CommandAssigneePage } from "./CommandAssigneePage";

interface CommandModeProps {
  state: CommandPageState;
  vault: string;
  target: CommandIssueTarget | null;
  registry: CommandRegistry;
  onPushPage: (page: Exclude<CommandPage, "root">) => void;
  onExecute: (
    policy: PaletteFocusPolicy,
    run: () => void,
    runBeforeClose?: boolean,
  ) => void;
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

const GLOBAL_COMMAND_PAGES: ReadonlyArray<CommandParentPage> = [
  "navigation",
  "view",
  "theme",
  "locale",
];

const CONTEXTUAL_COMMAND_PAGES: ReadonlyArray<CommandParentPage> = [
  "status",
  "assignee",
  "priority",
];

function preserveCommandInputFocus(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault();
}

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
  const pages = [
    ...GLOBAL_COMMAND_PAGES,
    ...(target ? CONTEXTUAL_COMMAND_PAGES : []),
  ];

  const executeAction = (action: BoundAppAction) =>
    onExecute(
      action.descriptor.focusPolicy,
      action.run,
      action.descriptor.id === "status.closed",
    );

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
        <CommandGroup heading={t("commandsHeading")}>
          {pages.map((nextPage) => (
            <PageRow
              key={nextPage}
              page={nextPage}
              targetId={
                CONTEXTUAL_COMMAND_PAGES.includes(nextPage)
                  ? target?.issueId
                  : undefined
              }
              onSelect={() => onPushPage(nextPage)}
            />
          ))}
        </CommandGroup>
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

  return (
    <CommandGroup heading={t("commandsHeading")}>
      {newIssue ? (
        <ActionRow action={newIssue} onSelect={() => executeAction(newIssue)} />
      ) : null}
      {pages.map((nextPage) => (
        <PageRow
          key={nextPage}
          page={nextPage}
          targetId={
            CONTEXTUAL_COMMAND_PAGES.includes(nextPage)
              ? target?.issueId
              : undefined
          }
          onSelect={() => onPushPage(nextPage)}
        />
      ))}
    </CommandGroup>
  );
}

function PageRow({
  page,
  targetId,
  onSelect,
}: {
  page: CommandParentPage;
  targetId?: string;
  onSelect: () => void;
}) {
  const t = useTranslations("commands");
  const Icon = PAGE_ICONS[page];
  const { searchAliases } = getCommandPageDescriptor(page);
  const label = t(`pages.${page}`);

  return (
    <CommandItem
      value={`page.${page}`}
      keywords={[label, ...searchAliases, ...(targetId ? [targetId] : [])]}
      data-testid="command-page-entry"
      data-command-page={page}
      onMouseDown={preserveCommandInputFocus}
      onSelect={onSelect}
    >
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {targetId ? (
        <span className="shrink-0 type-mono-value text-muted-foreground">
          {targetId}
        </span>
      ) : null}
      <ChevronRight
        className="size-4 text-muted-foreground"
        aria-hidden="true"
      />
    </CommandItem>
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
      value={descriptor.id}
      keywords={[
        action.label,
        ...action.keywords,
        ...(action.target ? [action.target.issueId] : []),
      ]}
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
          className="ml-auto size-4 text-brand-text"
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

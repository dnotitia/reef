"use client";

import {
  Archive,
  ArchiveRestore,
  CalendarRange,
  Copy,
  Link2,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/fields/PersonAvatar";
import { PersonOption } from "@/components/fields/PersonOption";
import { PlanningOption } from "@/components/fields/PlanningOption";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useArchiveIssue } from "@/features/issues/hooks/mutations/useArchiveIssue";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import { buildStatusPatch } from "@/features/issues/lib/statusPatch";
import {
  kanbanToastId,
  notifyRetryableError,
  notifyUndoableSuccess,
} from "@/components/ui/toastFeedback";
import type {
  Collaborator,
  ClosedReason,
  IssueListItem,
  IssueUpdatePatch,
  PlanningCatalog,
  Priority,
  Status,
} from "@reef/core";
import {
  NO_SELECTION,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
} from "@reef/core/fields";
import { CloseIssueDialog } from "../detail/CloseIssueDialog";

interface IssueContextMenuProps {
  issue: IssueListItem;
  vault: string;
  currentLogin: string | null;
  planningCatalog?: PlanningCatalog;
  assignees?: readonly Collaborator[];
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

interface SprintOption {
  id: string;
  name: string;
  status: string | null;
}

function NoneOption({ label }: { label: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <PersonAvatar identityKey={null} size="sm" decorative />
      <span>{label}</span>
    </span>
  );
}

export function IssueContextMenu({
  issue,
  vault,
  currentLogin,
  planningCatalog,
  assignees,
  onOpenChange,
  children,
}: IssueContextMenuProps) {
  const menu = useTranslations("issues.contextMenu");
  const detail = useTranslations("issues.detail");
  const toasts = useTranslations("toasts");
  const board = useTranslations("board");
  const updateMutation = useUpdateIssue();
  const archiveMutation = useArchiveIssue();
  const flashIssue = useFlashStore((state) => state.flashIssue);
  const [pendingClose, setPendingClose] = useState(false);

  const assigneeOptions = useMemo(() => {
    const options = [...(assignees ?? [])];
    if (
      issue.assigned_to &&
      !options.some((collaborator) => collaborator.login === issue.assigned_to)
    ) {
      options.unshift({
        login: issue.assigned_to,
        avatar_url: null,
        name: null,
      });
    }
    return options;
  }, [assignees, issue.assigned_to]);

  const sprintOptions = useMemo<SprintOption[]>(() => {
    const options: SprintOption[] = (planningCatalog?.sprints ?? []).map(
      (sprint) => ({
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
      }),
    );
    if (
      issue.sprint_id &&
      !options.some((sprint) => sprint.id === issue.sprint_id)
    ) {
      options.unshift({
        id: issue.sprint_id,
        name: issue.sprint_id,
        status: null,
      });
    }
    return options;
  }, [issue.sprint_id, planningCatalog]);

  function commitPatch(patch: IssueUpdatePatch) {
    updateMutation.mutateAsync({ id: issue.id, vault, patch }).then(
      () => {
        toast.dismiss(kanbanToastId(issue.id));
        flashIssue(issue.id);
      },
      (error: unknown) => {
        notifyRetryableError({
          id: kanbanToastId(issue.id),
          title:
            error instanceof Error && error.message
              ? error.message
              : board("updateErrorTitle"),
          description: board("updateErrorDescription"),
          onRetry: () => commitPatch(patch),
        });
      },
    );
  }

  function commitStatus(nextStatus: Status) {
    if (nextStatus === issue.status) return;
    if (nextStatus === "closed") {
      setPendingClose(true);
      return;
    }
    commitPatch(buildStatusPatch(issue, nextStatus));
  }

  function confirmClose(reason: ClosedReason) {
    setPendingClose(false);
    commitPatch(buildStatusPatch(issue, "closed", undefined, reason));
  }

  function commitAssignee(value: string) {
    const next = value === NO_SELECTION ? null : value;
    if ((issue.assigned_to ?? null) === next) return;
    commitPatch({ assigned_to: next });
  }

  function commitPriority(value: string) {
    const next = value === NO_SELECTION ? null : (value as Priority);
    if ((issue.priority ?? null) === next) return;
    commitPatch({ priority: next });
  }

  function commitSprint(value: string) {
    const next = value === NO_SELECTION ? null : value;
    if ((issue.sprint_id ?? null) === next) return;
    commitPatch({ sprint_id: next });
  }

  async function copyText(
    value: string,
    successMessage: string,
    errorMessage: string,
  ) {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(errorMessage);
    }
  }

  function copyLink() {
    const path = buildOpenIssueHref(vault, issue.id, new URLSearchParams());
    const url = `${window.location.origin}${path}`;
    return copyText(url, toasts("linkCopied"), toasts("copyLinkError"));
  }

  function copyId() {
    return copyText(issue.id, toasts("idCopied"), toasts("copyIdError"));
  }

  async function toggleArchive() {
    if (archiveMutation.isPending) return;
    const archived = issue.archived_at != null;
    try {
      if (archived) {
        await archiveMutation.unarchive({ id: issue.id, vault });
        notifyUndoableSuccess({
          id: `archive:${issue.id}`,
          message: detail("unarchived", { id: issue.id }),
          onUndo: () =>
            void archiveMutation
              .archive({ id: issue.id, vault })
              .catch((error: unknown) =>
                toast.error(
                  error instanceof Error ? error.message : toasts("undoError"),
                ),
              ),
        });
      } else {
        await archiveMutation.archive({ id: issue.id, vault });
        notifyUndoableSuccess({
          id: `archive:${issue.id}`,
          message: detail("archived", { id: issue.id }),
          onUndo: () =>
            void archiveMutation
              .unarchive({ id: issue.id, vault })
              .catch((error: unknown) =>
                toast.error(
                  error instanceof Error ? error.message : toasts("undoError"),
                ),
              ),
        });
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : toasts("archiveStateError"),
      );
    }
  }

  const assignedValue = issue.assigned_to ?? NO_SELECTION;
  const priorityValue = issue.priority ?? NO_SELECTION;
  const sprintValue = issue.sprint_id ?? NO_SELECTION;
  const contentLabel = menu("ariaLabel", { id: issue.id });
  const menuDisabled = updateMutation.isPending || archiveMutation.isPending;

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild portal>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={contentLabel}
        data-testid="issue-context-menu-content"
      >
        <ContextMenuSub>
          <ContextMenuSubTrigger
            leading={<StatusBadge status={issue.status} />}
            disabled={menuDisabled}
          >
            {menu("status")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={issue.status}
              onValueChange={(value) => commitStatus(value as Status)}
            >
              {STATUS_OPTIONS.map((status) => (
                <ContextMenuRadioItem
                  key={status}
                  value={status}
                  data-testid={`issue-context-menu-status-${status}`}
                  disabled={menuDisabled}
                >
                  <StatusBadge status={status} />
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger
            leading={<UserRound className="size-3.5" />}
            disabled={menuDisabled}
          >
            {menu("assignee")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={assignedValue}
              onValueChange={commitAssignee}
            >
              <ContextMenuRadioItem
                value={NO_SELECTION}
                data-testid="issue-context-menu-assignee-none"
                disabled={menuDisabled}
              >
                <NoneOption label={menu("none")} />
              </ContextMenuRadioItem>
              {assignees === undefined && (
                <ContextMenuItem disabled>{menu("loading")}</ContextMenuItem>
              )}
              {assignees?.length === 0 && assigneeOptions.length === 0 && (
                <ContextMenuItem disabled>{menu("noMembers")}</ContextMenuItem>
              )}
              {assigneeOptions.map((assignee) => (
                <ContextMenuRadioItem
                  key={assignee.login}
                  value={assignee.login}
                  data-testid={`issue-context-menu-assignee-${assignee.login}`}
                  disabled={menuDisabled}
                >
                  <PersonOption
                    login={assignee.login}
                    name={assignee.name}
                    avatarUrl={assignee.avatar_url}
                    currentLogin={currentLogin}
                  />
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger
            leading={<PriorityBadge priority={issue.priority ?? null} />}
            disabled={menuDisabled}
          >
            {menu("priority")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={priorityValue}
              onValueChange={commitPriority}
            >
              <ContextMenuRadioItem
                value={NO_SELECTION}
                data-testid="issue-context-menu-priority-none"
                disabled={menuDisabled}
              >
                <PriorityBadge priority={null} />
              </ContextMenuRadioItem>
              {PRIORITY_OPTIONS.map((priority) => (
                <ContextMenuRadioItem
                  key={priority}
                  value={priority}
                  data-testid={`issue-context-menu-priority-${priority}`}
                  disabled={menuDisabled}
                >
                  <PriorityBadge priority={priority} />
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger
            leading={<CalendarRange className="size-3.5" />}
            disabled={menuDisabled}
          >
            {menu("sprint")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={sprintValue}
              onValueChange={commitSprint}
            >
              <ContextMenuRadioItem
                value={NO_SELECTION}
                data-testid="issue-context-menu-sprint-none"
                disabled={menuDisabled}
              >
                {menu("none")}
              </ContextMenuRadioItem>
              {planningCatalog === undefined && (
                <ContextMenuItem disabled>{menu("loading")}</ContextMenuItem>
              )}
              {planningCatalog && sprintOptions.length === 0 && (
                <ContextMenuItem disabled>{menu("noSprints")}</ContextMenuItem>
              )}
              {sprintOptions.map((sprint) => (
                <ContextMenuRadioItem
                  key={sprint.id}
                  value={sprint.id}
                  data-testid={`issue-context-menu-sprint-${sprint.id}`}
                  disabled={menuDisabled}
                >
                  <PlanningOption
                    kind="sprints"
                    name={sprint.name}
                    status={sprint.status}
                  />
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />
        <ContextMenuItem
          leading={<Link2 className="size-3.5" />}
          data-testid="issue-context-menu-copy-link"
          onSelect={() => void copyLink()}
        >
          {menu("copyLink")}
        </ContextMenuItem>
        <ContextMenuItem
          leading={<Copy className="size-3.5" />}
          data-testid="issue-context-menu-copy-id"
          onSelect={() => void copyId()}
        >
          {menu("copyId")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          leading={
            issue.archived_at != null ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )
          }
          data-testid="issue-context-menu-archive"
          disabled={menuDisabled}
          onSelect={() => void toggleArchive()}
        >
          {issue.archived_at != null ? menu("unarchive") : menu("archive")}
        </ContextMenuItem>
      </ContextMenuContent>
      <CloseIssueDialog
        open={pendingClose}
        issueId={issue.id}
        disabled={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingClose(false);
        }}
        onConfirm={confirmClose}
      />
    </ContextMenu>
  );
}

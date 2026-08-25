"use client";

import {
  kanbanToastId,
  notifyRetryableError,
} from "@/components/ui/toastFeedback";
import {
  APP_ACTION_CATALOG,
  type AppActionDescriptor,
  getCommandPageDescriptor,
  getPaletteActions,
  getShortcutActions,
} from "@/features/commands/lib/appActionCatalog";
import {
  type CommandIssueTarget,
  resolveCommandTarget,
} from "@/features/commands/lib/commandContext";
import {
  buildNavigationHref,
  buildViewHref,
  resolveCurrentIssueView,
} from "@/features/commands/lib/commandNavigation";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { buildStatusPatch } from "@/features/issues/lib/statusPatch";
import { getIssueEntity } from "@/features/issues/stores/issueEntityStore";
import {
  type IssueKeyboardScope,
  type IssueQuickEditField,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useLocalePreference } from "@/features/preferences/hooks/useLocalePreference";
import { useTheme } from "@/features/preferences/hooks/useTheme";
import {
  type ShortcutBinding,
  isFirefoxLike,
} from "@/features/shortcuts/lib/shortcuts";
import type { Locale } from "@/i18n/locales";
import type { ThemePreference } from "@/lib/storage/config";
import type {
  ClosedReason,
  IssueDocument,
  IssueMetadata,
  IssueUpdatePatch,
  Priority,
  Status,
} from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

export interface BoundAppAction {
  descriptor: AppActionDescriptor;
  label: string;
  keywords: ReadonlyArray<string>;
  current: boolean;
  target?: CommandIssueTarget;
  run: () => void;
}

interface RegistryOptions {
  vault: string;
  togglePalette: () => void;
  toggleShortcuts: () => void;
  openNewIssue: () => void;
  toggleAskAi: () => void;
  startChord: (prefix: string) => void;
  clearChord: () => void;
  focusDestination: () => void;
  clearSelection: () => void;
  moveIssueFocus: (scope: IssueKeyboardScope, delta: 1 | -1) => void;
  openFocusedIssue: (scope: IssueKeyboardScope) => void;
  editFocusedIssue: (
    scope: IssueKeyboardScope,
    field: IssueQuickEditField,
  ) => void;
}

const NAVIGATION_HREFS: Readonly<Record<string, string>> = {
  "navigation.issues": "/issues",
  "navigation.myWork": "/my-work",
  "navigation.reports": "/reports",
  "navigation.planning": "/planning",
  "navigation.settings": "/settings",
  "navigation.backlog": "/issues?scope=backlog&view=list",
};

function actionValue(id: string): string {
  return id.slice(id.indexOf(".") + 1);
}

export function useCommandRegistry({
  vault,
  togglePalette,
  toggleShortcuts,
  openNewIssue,
  toggleAskAi,
  startChord,
  clearChord,
  focusDestination,
  clearSelection,
  moveIssueFocus,
  openFocusedIssue,
  editFocusedIssue,
}: RegistryOptions) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useUpdateIssue();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocalePreference();
  const commandsTranslator = useTranslations("commands") as unknown as (
    key: string,
    values?: Record<string, string>,
  ) => string;
  const toasts = useTranslations("toasts");
  const [pendingClose, setPendingClose] = useState<CommandIssueTarget | null>(
    null,
  );

  const getFreshIssue = useCallback(
    (issueId: string): IssueMetadata | undefined => {
      const entity = getIssueEntity(vault, issueId);
      if (entity) return entity as IssueMetadata;
      return queryClient.getQueryData<IssueDocument>([
        "issues",
        "detail",
        vault,
        issueId,
      ])?.issue;
    },
    [queryClient, vault],
  );

  const captureContext = useCallback((): CommandIssueTarget | null => {
    if (typeof window === "undefined") return null;
    const keyboard = useIssueKeyboardStore.getState();
    return resolveCommandTarget({
      pathname: window.location.pathname,
      search: window.location.search,
      selectionActive: useIssueSelectionStore.getState().selectedIds.size > 0,
      focusedIssueId: keyboard.focusedIssueId,
      lookupIssue: getFreshIssue,
    });
  }, [getFreshIssue]);

  const commitIssuePatch = useCallback(
    (
      target: CommandIssueTarget,
      buildPatch: (issue: IssueMetadata) => IssueUpdatePatch | null,
    ) => {
      const attempt = () => {
        const latest = getFreshIssue(target.issueId);
        if (!latest) return;
        const patch = buildPatch(latest);
        if (!patch) return;
        mutation.mutateAsync({ id: target.issueId, vault, patch }).then(
          () => toast.dismiss(kanbanToastId(target.issueId)),
          (error: unknown) => {
            notifyRetryableError({
              id: kanbanToastId(target.issueId),
              title:
                error instanceof Error && error.message
                  ? error.message
                  : commandsTranslator("mutation.errorTitle"),
              description: commandsTranslator("mutation.errorDescription"),
              labels: {
                retry: toasts("retry"),
                retrying: toasts("retrying"),
              },
              onRetry: attempt,
            });
          },
        );
      };
      attempt();
    },
    [commandsTranslator, getFreshIssue, mutation, toasts, vault],
  );

  const executeStatus = useCallback(
    (target: CommandIssueTarget, next: Status) => {
      const latest = getFreshIssue(target.issueId);
      if (!latest || latest.status === next) return;
      if (next === "closed") {
        setPendingClose(target);
        return;
      }
      commitIssuePatch(target, (issue) =>
        issue.status === next ? null : buildStatusPatch(issue, next),
      );
    },
    [commitIssuePatch, getFreshIssue],
  );

  const executePriority = useCallback(
    (target: CommandIssueTarget, next: Priority | null) => {
      commitIssuePatch(target, (issue) =>
        (issue.priority ?? null) === next ? null : { priority: next },
      );
    },
    [commitIssuePatch],
  );

  const executeAssignee = useCallback(
    (target: CommandIssueTarget, next: string | null) => {
      commitIssuePatch(target, (issue) =>
        (issue.assigned_to ?? null) === next ? null : { assigned_to: next },
      );
    },
    [commitIssuePatch],
  );

  const confirmPendingClose = useCallback(
    (reason: ClosedReason) => {
      const target = pendingClose;
      setPendingClose(null);
      if (!target) return;
      commitIssuePatch(target, (issue) =>
        issue.status === "closed"
          ? null
          : buildStatusPatch(issue, "closed", undefined, reason),
      );
    },
    [commitIssuePatch, pendingClose],
  );

  const navigate = useCallback(
    (href: string) => {
      clearChord();
      focusDestination();
      startTransition(() => router.push(href));
    },
    [clearChord, focusDestination, router],
  );

  const executeAction = useCallback(
    (descriptor: AppActionDescriptor, target?: CommandIssueTarget) => {
      const { id } = descriptor;
      if (id in NAVIGATION_HREFS) {
        navigate(buildNavigationHref(vault, NAVIGATION_HREFS[id] ?? "/issues"));
        return;
      }
      if (id.startsWith("view.")) {
        if (typeof window === "undefined") return;
        navigate(
          buildViewHref({
            vault,
            pathname: window.location.pathname,
            search: window.location.search,
            view: actionValue(id) as "board" | "list" | "timeline",
          }),
        );
        return;
      }
      if (id === "issue.new") {
        openNewIssue();
        return;
      }
      if (id.startsWith("theme.")) {
        const next = actionValue(id) as ThemePreference;
        if (theme !== next) void setTheme(next);
        return;
      }
      if (id.startsWith("locale.")) {
        const next = actionValue(id) as Locale;
        if (locale !== next) {
          focusDestination();
          void setLocale(next).then(() => {
            // Persisting the preference resolves before the App Router refresh
            // commits the new locale; leave the destination handoff armed for
            // the shell's locale-settle effect as well.
            focusDestination();
          });
        }
        return;
      }
      if (!target) return;
      if (id.startsWith("status.")) {
        executeStatus(target, actionValue(id) as Status);
      } else if (id.startsWith("priority.")) {
        const value = actionValue(id);
        executePriority(target, value === "none" ? null : (value as Priority));
      }
    },
    [
      executePriority,
      executeStatus,
      focusDestination,
      locale,
      navigate,
      openNewIssue,
      setLocale,
      setTheme,
      theme,
      vault,
    ],
  );

  const resolveLabel = useCallback(
    (descriptor: AppActionDescriptor) =>
      commandsTranslator(`actions.${descriptor.labelKey}`),
    [commandsTranslator],
  );

  const paletteActions = useCallback(
    (target: CommandIssueTarget | null): ReadonlyArray<BoundAppAction> => {
      const currentView =
        typeof window === "undefined"
          ? null
          : resolveCurrentIssueView({
              pathname: window.location.pathname,
              search: window.location.search,
            });
      return getPaletteActions().flatMap((descriptor) => {
        const needsTarget = descriptor.scopes.some(
          (scope) => scope !== "global",
        );
        if (needsTarget && !target) return [];
        const value = actionValue(descriptor.id);
        const current =
          (descriptor.id.startsWith("theme.") && theme === value) ||
          (descriptor.id.startsWith("locale.") && locale === value) ||
          (descriptor.id.startsWith("view.") && currentView === value) ||
          (descriptor.id.startsWith("status.") &&
            target !== null &&
            getFreshIssue(target.issueId)?.status === value) ||
          (descriptor.id.startsWith("priority.") &&
            target !== null &&
            (getFreshIssue(target.issueId)?.priority ?? "none") === value);
        return [
          {
            descriptor,
            label: resolveLabel(descriptor),
            keywords: [
              ...new Set([
                ...(descriptor.searchAliases ?? []),
                ...(descriptor.parentPage
                  ? getCommandPageDescriptor(descriptor.parentPage)
                      .searchAliases
                  : []),
                ...descriptor.aliasKeys.map((key) =>
                  commandsTranslator(`aliases.${key}`),
                ),
              ]),
            ],
            current,
            target: target ?? undefined,
            run: () => executeAction(descriptor, target ?? undefined),
          },
        ];
      });
    },
    [
      commandsTranslator,
      executeAction,
      getFreshIssue,
      locale,
      resolveLabel,
      theme,
    ],
  );

  const handlerFor = useCallback(
    (id: string): (() => void) | null => {
      if (id === "palette.open") return togglePalette;
      if (id === "shortcuts.open") return toggleShortcuts;
      if (id === "navigation.chord") return () => startChord("g");
      if (id in NAVIGATION_HREFS) {
        return () =>
          navigate(
            buildNavigationHref(vault, NAVIGATION_HREFS[id] ?? "/issues"),
          );
      }
      if (id === "issue.new") return openNewIssue;
      if (id === "ai.toggle") return toggleAskAi;
      if (id === "misc.escape") return clearSelection;
      return null;
    },
    [
      clearSelection,
      navigate,
      openNewIssue,
      startChord,
      toggleAskAi,
      togglePalette,
      toggleShortcuts,
      vault,
    ],
  );

  const shortcutBindings = useMemo<ReadonlyArray<ShortcutBinding>>(() => {
    const bindings: ShortcutBinding[] = [];
    for (const descriptor of getShortcutActions()) {
      const shortcut = descriptor.shortcut;
      if (!shortcut) continue;

      if (descriptor.id.startsWith("issue.focus")) {
        for (const scope of ["list", "board", "backlog"] as const) {
          bindings.push({
            labelKey: descriptor.id,
            scope,
            keys: shortcut.bindings[0]?.keys ?? [],
            handler: () =>
              moveIssueFocus(
                scope,
                descriptor.id === "issue.focusNext" ? 1 : -1,
              ),
          });
        }
        continue;
      }
      if (descriptor.id === "issue.openFocused") {
        for (const scope of ["list", "board", "backlog"] as const) {
          bindings.push({
            labelKey: descriptor.id,
            scope,
            keys: shortcut.bindings[0]?.keys ?? [],
            handler: () => openFocusedIssue(scope),
          });
        }
        continue;
      }
      const quickField: Partial<Record<string, IssueQuickEditField>> = {
        "issue.editStatus": "status",
        "issue.editAssignee": "assignee",
        "issue.editPriority": "priority",
        "issue.editLabels": "labels",
      };
      const field = quickField[descriptor.id];
      if (field) {
        for (const scope of ["list", "board", "backlog"] as const) {
          // Backlog exposes the three triage fields; labels remain a List
          // surface even though the shared keyboard catalog covers all rows.
          if (scope === "backlog" && field === "labels") continue;
          bindings.push({
            labelKey: descriptor.id,
            scope,
            keys: shortcut.bindings[0]?.keys ?? [],
            handler: () => editFocusedIssue(scope, field),
          });
        }
        continue;
      }

      const handler = handlerFor(descriptor.id);
      if (!handler) continue;
      for (const binding of shortcut.bindings) {
        const firefoxNewIssue =
          descriptor.id === "issue.new" && isFirefoxLike();
        bindings.push({
          labelKey: descriptor.id,
          scope: descriptor.id === "misc.escape" ? "list" : shortcut.scope,
          keys: firefoxNewIssue
            ? [
                {
                  key: "n",
                  code: "KeyN",
                  primaryModKey: true,
                  altKey: true,
                },
              ]
            : binding.keys,
          chordPrefix: binding.chordPrefix,
          allowEditableTarget: binding.allowEditableTarget,
          allowInteractiveTarget: binding.allowInteractiveTarget,
          handler,
        });
      }
    }
    return bindings;
  }, [editFocusedIssue, handlerFor, moveIssueFocus, openFocusedIssue]);

  return {
    actions: APP_ACTION_CATALOG,
    captureContext,
    getFreshIssue,
    paletteActions,
    shortcutBindings,
    executeAssignee,
    mutationPending: mutation.isPending,
    pendingClose,
    setPendingClose,
    confirmPendingClose,
  };
}

export type CommandRegistry = ReturnType<typeof useCommandRegistry>;
export type { CommandIssueTarget };

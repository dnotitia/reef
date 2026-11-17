import { Button } from "@/components/ui/button";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { withVault } from "@/lib/workspaceHref";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useId } from "react";
import type { BoardQueryState } from "../lib/boardQueryState";

export function BoardQueryFeedback({
  state,
  vault,
  manualOrder,
  retrying,
  onRetry,
}: {
  state: BoardQueryState;
  vault: string;
  manualOrder: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("board");
  const common = useTranslations("common");
  const id = useId();
  const failed = state === "initial-error" || state === "refresh-error";
  const transient = state === "updating" || state === "refreshing";
  const terminal =
    state === "initial-error" ||
    state === "no-match" ||
    state === "empty-active";
  if (!failed && !transient && !terminal) return null;

  if (!terminal) {
    return (
      <div
        data-testid="kanban-query-feedback"
        role={failed ? "alert" : "status"}
        aria-live={failed ? "assertive" : "polite"}
        aria-atomic="true"
        className="pointer-events-auto absolute right-6 bottom-4 z-20 max-w-sm rounded-md border border-border-subtle bg-surface-page/95 px-3 py-2 text-xs text-muted-foreground shadow-sm"
      >
        {failed
          ? t("refreshError")
          : state === "updating"
            ? common("updatingResults")
            : t("refreshing")}
        {(transient || retrying) && manualOrder ? (
          <p className="mt-1">{t("refreshingReorderPaused")}</p>
        ) : null}
        {failed ? (
          <Button
            type="button"
            variant="link"
            className="ml-2 h-auto p-0"
            aria-busy={retrying ? true : undefined}
            aria-disabled={retrying ? true : undefined}
            onClick={() => {
              if (!retrying) onRetry();
            }}
          >
            {common("retry")}
          </Button>
        ) : null}
      </div>
    );
  }

  const title =
    state === "initial-error"
      ? t("initialError")
      : state === "no-match"
        ? t("noMatchTitle")
        : t("emptyActiveTitle");
  const description =
    state === "initial-error"
      ? null
      : state === "no-match"
        ? t("noMatchDescription")
        : t("emptyActiveDescription");
  return (
    <div className="pointer-events-none absolute inset-x-6 top-16 z-10 flex justify-center">
      <div className="pointer-events-none flex max-w-md flex-col items-center rounded-lg border border-border-subtle bg-surface-page/95 px-5 py-4 text-center backdrop-blur-sm">
        <section
          data-testid={
            state === "no-match"
              ? "kanban-no-matches"
              : state === "empty-active"
                ? "kanban-empty-active"
                : "kanban-query-feedback"
          }
          role={failed ? "alert" : undefined}
          className="pointer-events-none flex flex-col items-center"
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-description` : undefined}
        >
          <h2
            id={`${id}-title`}
            className="text-sm font-semibold text-foreground"
          >
            {title}
          </h2>
          {description ? (
            <p
              id={`${id}-description`}
              className="mt-1 text-xs text-muted-foreground"
            >
              {description}
            </p>
          ) : null}
        </section>
        {state === "empty-active" ? (
          <Button
            asChild
            className="pointer-events-auto mt-3"
            variant="outline"
            size="sm"
          >
            <Link href={withVault(vault, "/issues?scope=backlog&view=board")}>
              {t("viewBacklog")}
            </Link>
          </Button>
        ) : (
          <Button
            className="pointer-events-auto mt-3"
            type="button"
            variant="outline"
            size="sm"
            aria-busy={failed && retrying ? true : undefined}
            aria-disabled={failed && retrying ? true : undefined}
            onClick={() => {
              if (failed) {
                if (!retrying) onRetry();
              } else {
                useIssueStore.getState().clearFilter();
              }
            }}
          >
            {failed ? common("retry") : common("clearFilters")}
          </Button>
        )}
        {failed && retrying ? (
          <span role="status" className="mt-2 text-xs text-muted-foreground">
            {t("loading")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

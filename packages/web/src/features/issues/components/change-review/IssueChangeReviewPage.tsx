"use client";

import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/fields/DatePickerField";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useIssueTypeLabels,
  usePriorityLabels,
  useStatusLabels,
} from "@/i18n/fieldLabels";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { PageBody } from "@/features/ui/components/PageBody";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useIssueChangeReview } from "@/features/issues/hooks/queries/useIssueChangeReview";
import { parseIsoDate } from "@/features/issues/lib/dateHelpers";
import {
  getIssueChangeReviewPeriod,
  setIssueChangeReviewPeriod,
} from "@/lib/storage/config";
import { withVault } from "@/lib/workspaceHref";
import type {
  IssueChange,
  IssueChangeReviewGroup,
  IssueChangeReviewRange,
} from "@reef/core";
import { ChevronDown, Link2, MoreHorizontal, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

const DEFAULT_DAYS = 7;
const RELATIVE_DAYS = [1, 3, 7, 14, 30] as const;
const DAY_MS = 86_400_000;
type ChangeReviewTranslator = ReturnType<
  typeof useTranslations<"issues.changeReview">
>;

type ChangeValueLabels = {
  status: Record<string, string>;
  priority: Record<string, string>;
  issueType: Record<string, string>;
};

type CopyFeedback = "success" | "error";

type ReviewPeriod = IssueChangeReviewRange & {
  relativeDays?: number;
  timezone: string;
};

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function relativePeriod(
  days: number,
  timezone = localTimezone(),
): ReviewPeriod {
  const end = new Date();
  return {
    start_at: new Date(end.getTime() - days * DAY_MS).toISOString(),
    end_at: end.toISOString(),
    relativeDays: days,
    timezone,
  };
}

interface ExplicitPeriodRead {
  period: ReviewPeriod | null;
  invalid: boolean;
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function readExplicitPeriod(searchParams: URLSearchParams): ExplicitPeriodRead {
  const start = searchParams.get("start_at");
  const end = searchParams.get("end_at");
  const rawTimezone = searchParams.get("tz");
  const hasExplicitRange =
    start !== null || end !== null || rawTimezone !== null;
  if (!hasExplicitRange) return { period: null, invalid: false };
  if (!start || !end) return { period: null, invalid: true };
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const timezone = rawTimezone ?? localTimezone();
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs >= endMs ||
    !timezone ||
    !isValidTimezone(timezone)
  ) {
    return { period: null, invalid: true };
  }
  return {
    invalid: false,
    period: {
      start_at: new Date(startMs).toISOString(),
      end_at: new Date(endMs).toISOString(),
      timezone,
    },
  };
}

function dateInTimezone(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function periodDisplayDates(period: ReviewPeriod): {
  start: string;
  end: string;
} {
  return {
    start: dateInTimezone(period.start_at, period.timezone),
    end: dateInTimezone(
      new Date(Date.parse(period.end_at) - 1).toISOString(),
      period.timezone,
    ),
  };
}

function localDateStart(value: string): Date | null {
  const date = parseIsoDate(value);
  return date ? new Date(date.year, date.month, date.day) : null;
}

function changeValue(
  value: unknown,
  eventType: string,
  labels: ChangeValueLabels,
  t: ChangeReviewTranslator,
): string {
  if (value == null) return "—";
  if (Array.isArray(value)) {
    return value.length > 0
      ? value.map((item) => changeValue(item, eventType, labels, t)).join(", ")
      : "—";
  }
  if (typeof value === "boolean" && eventType === "archived_change") {
    return t(value ? "values.archived" : "values.active");
  }
  const valueLabels =
    eventType === "status_change"
      ? labels.status
      : eventType === "priority_change"
        ? labels.priority
        : eventType === "issue_type_change"
          ? labels.issueType
          : undefined;
  if (typeof value === "string") return valueLabels?.[value] ?? value;
  if (typeof value === "object") return JSON.stringify(value) ?? "—";
  return String(value);
}

function formatChangeTime(
  iso: string,
  locale: string,
  timezone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}

function fieldName(
  change: Extract<IssueChange, { kind: "field_change" }>,
  t: ChangeReviewTranslator,
): string {
  const key =
    change.event_type === "impl_ref_linked"
      ? "implementation_refs"
      : change.event_type === "planning_link" ||
          change.event_type === "relation_change"
        ? change.field
        : change.event_type;
  return t(`fields.${key}` as never);
}

function ChangeDetails({
  change,
  t,
  valueLabels,
}: {
  change: IssueChange;
  t: ChangeReviewTranslator;
  valueLabels: ChangeValueLabels;
}): ReactNode {
  switch (change.kind) {
    case "created":
      return <p>{t("created", { title: change.title })}</p>;
    case "field_change":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-medium">{fieldName(change, t)}</span>
          <span className="break-words tabular-nums text-muted-foreground">
            {changeValue(change.from, change.event_type, valueLabels, t)}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <span className="break-words font-medium tabular-nums">
            {changeValue(change.to, change.event_type, valueLabels, t)}
          </span>
        </div>
      );
    case "body_update":
      return (
        <details className="group min-w-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-sm font-medium [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40">
            <ChevronDown
              className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
            {t("bodyUpdated")}
          </summary>
          {change.diff ? (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words border-l-2 border-brand-fill bg-surface-subtle px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
              {change.diff}
            </pre>
          ) : null}
        </details>
      );
    case "comment_added":
      return (
        <details className="min-w-0">
          <summary className="cursor-pointer rounded-md px-1 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40">
            {t("commentAdded")}
          </summary>
          <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words border-l-2 border-border-subtle pl-3 text-sm leading-relaxed text-foreground">
            {change.body}
          </p>
        </details>
      );
    case "attachment_added":
      return <p>{t("attachmentAdded", { filename: change.filename })}</p>;
    case "attachment_removed":
      return <p>{t("attachmentRemoved", { filename: change.filename })}</p>;
  }
}

function ChangeRow({
  change,
  t,
  locale,
  timezone,
  valueLabels,
}: {
  change: IssueChange;
  t: ChangeReviewTranslator;
  locale: string;
  timezone: string;
  valueLabels: ChangeValueLabels;
}) {
  return (
    <li
      className="flex min-w-0 flex-col gap-1.5 border-t border-border-subtle px-3 py-3 first:border-t-0"
      data-testid="issue-change-row"
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 80px" }}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t(`kinds.${change.kind}` as never)}</span>
        <time
          className="whitespace-nowrap tabular-nums"
          dateTime={change.at}
          title={change.at}
        >
          {formatChangeTime(change.at, locale, timezone)}
        </time>
      </div>
      <div className="min-w-0 text-sm text-foreground">
        <ChangeDetails change={change} t={t} valueLabels={valueLabels} />
      </div>
      <div className="text-xs text-muted-foreground">
        {change.actor ? (
          <span translate="no">{t("by", { actor: change.actor })}</span>
        ) : (
          t("system")
        )}
      </div>
    </li>
  );
}

function ChangeReviewBodySkeleton({ label }: { label: string }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-testid="issue-change-review-loading"
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-3" aria-hidden="true">
        {["summary", "group", "group-short"].map((key) => (
          <div
            key={key}
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-card px-3 py-3"
          >
            <Skeleton tone="secondary" className="h-4 w-2/3 max-w-72" />
            <Skeleton className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function IssueChangeReviewLoading() {
  const nav = useTranslations("nav");
  const t = useTranslations("issues.changeReview");
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title={nav("changeReview")} />
      <PageBody width="wide" pad="compact">
        <ChangeReviewBodySkeleton label={t("loading")} />
      </PageBody>
    </div>
  );
}

function ChangeReviewActions({
  canCopy,
  onCopy,
  t,
}: {
  canCopy: boolean;
  onCopy: () => void | Promise<void>;
  t: ChangeReviewTranslator;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        data-testid="issue-change-review-actions"
        aria-label={t("actions")}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          data-testid="issue-change-review-copy-link"
          disabled={!canCopy}
          leading={<Link2 className="size-3.5" />}
          onSelect={() => void onCopy()}
        >
          {t("copyLink")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChangeGroup({
  group,
  t,
  locale,
  timezone,
  vault,
  valueLabels,
}: {
  group: IssueChangeReviewGroup;
  t: ChangeReviewTranslator;
  locale: string;
  timezone: string;
  vault: string;
  valueLabels: ChangeValueLabels;
}) {
  const latestChange = group.changes[group.changes.length - 1];
  return (
    <details
      className="group min-w-0 overflow-hidden rounded-lg border border-border-subtle bg-surface-card"
      data-testid="issue-change-group"
    >
      <summary
        className="flex min-w-0 flex-wrap cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus/40"
        data-testid="issue-change-group-summary"
      >
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span
            className="block min-w-0 break-words font-medium text-foreground"
            data-testid="issue-change-group-title"
          >
            {group.issue.title}
          </span>
          <span
            className="font-mono text-xs tabular-nums text-muted-foreground"
            translate="no"
          >
            {group.issue.id}
          </span>
        </span>
        <span className="shrink-0 text-right text-xs text-muted-foreground max-[639px]:basis-full max-[639px]:pl-7 max-[639px]:text-left">
          <span className="block tabular-nums">
            {t("changeCount", { count: group.changes.length })}
          </span>
          {latestChange ? (
            <time
              className="mt-0.5 block whitespace-nowrap tabular-nums"
              dateTime={latestChange.at}
              title={latestChange.at}
            >
              {t("lastChange", {
                time: formatChangeTime(latestChange.at, locale, timezone),
              })}
            </time>
          ) : null}
        </span>
      </summary>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-3 py-2">
        <span className="text-xs text-muted-foreground">{t("details")}</span>
        <Link
          href={withVault(
            vault,
            `/issues/${encodeURIComponent(group.issue.id)}`,
          )}
          className="text-xs font-medium text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
          data-testid="issue-change-issue-link"
        >
          {t("openIssue")}
        </Link>
      </div>
      <ol className="m-0 list-none p-0">
        {group.changes.map((change) => (
          <ChangeRow
            key={change.id}
            change={change}
            t={t}
            locale={locale}
            timezone={timezone}
            valueLabels={valueLabels}
          />
        ))}
      </ol>
    </details>
  );
}

export function IssueChangeReviewPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = useLocale();
  const nav = useTranslations("nav");
  const t = useTranslations("issues.changeReview");
  const statusLabels = useStatusLabels();
  const priorityLabels = usePriorityLabels();
  const issueTypeLabels = useIssueTypeLabels();
  const [period, setPeriod] = useState<ReviewPeriod | null>(null);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [rangeError, setRangeError] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);

  const explicitQuery = searchParams.toString();
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    const explicit = readExplicitPeriod(new URLSearchParams(explicitQuery));
    if (explicit.invalid) {
      setPeriod(null);
      setDraftStart("");
      setDraftEnd("");
      setRangeError(true);
      return;
    }
    if (explicit.period) {
      setRangeError(false);
      setPeriod(explicit.period);
      const displayDates = periodDisplayDates(explicit.period);
      setDraftStart(displayDates.start);
      setDraftEnd(displayDates.end);
      return;
    }
    void getIssueChangeReviewPeriod(vault).then((days) => {
      if (cancelled) return;
      const next = relativePeriod(days ?? DEFAULT_DAYS);
      setRangeError(false);
      setPeriod(next);
      setDraftStart(dateInTimezone(next.start_at, next.timezone));
      setDraftEnd(dateInTimezone(next.end_at, next.timezone));
    });
    return () => {
      cancelled = true;
    };
  }, [vault, explicitQuery]);

  const range = period
    ? { start_at: period.start_at, end_at: period.end_at }
    : null;
  const review = useIssueChangeReview(vault, range);

  const valueLabels = {
    status: statusLabels,
    priority: priorityLabels,
    issueType: issueTypeLabels,
  };

  const selectRelative = useCallback(
    (days: number) => {
      const next = relativePeriod(days);
      setRangeError(false);
      setCopyFeedback(null);
      setPeriod(next);
      setDraftStart(dateInTimezone(next.start_at, next.timezone));
      setDraftEnd(dateInTimezone(next.end_at, next.timezone));
      void setIssueChangeReviewPeriod(vault, days).catch(() => undefined);
      // A relative preference is intentionally not put in the URL. The
      // overflow action makes copied links explicit, while reopening
      // recomputes this range.
      if (new URLSearchParams(explicitQuery).size > 0) {
        router.replace(withVault(vault, "/issues/changes"));
      }
    },
    [explicitQuery, router, vault],
  );

  function applyCustomRange() {
    setCopyFeedback(null);
    const preserveFixedPeriod =
      period !== null &&
      period.relativeDays === undefined &&
      (() => {
        const displayDates = periodDisplayDates(period);
        return (
          draftStart === displayDates.start && draftEnd === displayDates.end
        );
      })();
    let next: ReviewPeriod;
    if (preserveFixedPeriod && period) {
      next = period;
    } else {
      const start = localDateStart(draftStart);
      const end = localDateStart(draftEnd);
      if (!start || !end || end.getTime() < start.getTime()) {
        setRangeError(true);
        return;
      }
      const endExclusive = new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate() + 1,
      );
      next = {
        start_at: start.toISOString(),
        end_at: endExclusive.toISOString(),
        timezone: localTimezone(),
      };
    }
    setRangeError(false);
    setPeriod(next);
    const nextUrl = new URL(window.location.href);
    nextUrl.search = "";
    nextUrl.searchParams.set("start_at", next.start_at);
    nextUrl.searchParams.set("end_at", next.end_at);
    nextUrl.searchParams.set("tz", next.timezone);
    router.replace(`${nextUrl.pathname}${nextUrl.search}`, { scroll: false });
  }

  async function sharePeriod() {
    if (!period) return;
    setCopyFeedback(null);
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("start_at", period.start_at);
    url.searchParams.set("end_at", period.end_at);
    url.searchParams.set("tz", period.timezone);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyFeedback("success");
      toast.success(t("shareSuccess"));
    } catch {
      setCopyFeedback("error");
      toast.error(t("shareError"));
    }
  }

  const groups = review.data?.groups ?? [];
  const rangeLabel = useMemo(() => {
    if (!period) return "";
    return t("range", {
      start: new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: period.timezone,
      }).format(new Date(period.start_at)),
      end: new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: period.timezone,
      }).format(new Date(Date.parse(period.end_at) - 1)),
      timezone: period.timezone,
    });
  }, [locale, period, t]);

  if (!vault && !vaultLoading) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title={nav("changeReview")}
        description={vault || undefined}
        actions={
          <ChangeReviewActions
            canCopy={period !== null}
            onCopy={sharePeriod}
            t={t}
          />
        }
      />

      <PageBody width="wide" pad="compact" className="flex flex-col gap-4">
        <section
          className="rounded-lg border border-border-subtle bg-surface-card p-3"
          aria-labelledby="issue-change-review-period"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                id="issue-change-review-period"
                className="text-sm font-semibold text-foreground"
              >
                {t("periodTitle")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {period ? rangeLabel : t("loading")}
              </p>
            </div>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label={t("relativeGroupLabel")}
            >
              {RELATIVE_DAYS.map((days) => (
                <Button
                  key={days}
                  type="button"
                  size="sm"
                  aria-pressed={period?.relativeDays === days}
                  variant={
                    period?.relativeDays === days ? "default" : "outline"
                  }
                  onClick={() => selectRelative(days)}
                  data-testid={`issue-change-review-relative-${days}`}
                >
                  {t("lastDays", { days })}
                </Button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <label
                htmlFor="issue-change-review-start"
                className="mb-1 block text-xs text-muted-foreground"
              >
                {t("start")}
              </label>
              <DatePickerField
                id="issue-change-review-start"
                value={draftStart}
                label={t("start")}
                onChange={setDraftStart}
              />
            </div>
            <div className="min-w-0">
              <label
                htmlFor="issue-change-review-end"
                className="mb-1 block text-xs text-muted-foreground"
              >
                {t("end")}
              </label>
              <DatePickerField
                id="issue-change-review-end"
                value={draftEnd}
                label={t("end")}
                onChange={setDraftEnd}
              />
            </div>
            <Button
              type="button"
              size="default"
              hitTarget="compact"
              onClick={applyCustomRange}
              data-testid="issue-change-review-apply"
            >
              {t("apply")}
            </Button>
          </div>
          {rangeError ? (
            <p className="mt-2 text-xs text-destructive-text" role="alert">
              {t("invalidRange")}
            </p>
          ) : null}
        </section>

        {copyFeedback ? (
          <p
            className={
              copyFeedback === "error"
                ? "text-xs text-destructive-text"
                : "text-xs text-brand-text"
            }
            data-testid="issue-change-review-copy-feedback"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {copyFeedback === "error" ? t("shareError") : t("shareSuccess")}
          </p>
        ) : null}

        {!period && rangeError ? null : review.isPending ? (
          <ChangeReviewBodySkeleton label={t("loading")} />
        ) : review.isError ? (
          <section
            className="rounded-lg border border-destructive-text/30 bg-surface-card p-6"
            role="alert"
            data-testid="issue-change-review-error"
          >
            <p className="text-sm text-destructive-text">{t("loadError")}</p>
            <Button
              className="mt-3"
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void review.refetch()}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t("retry")}
            </Button>
          </section>
        ) : groups.length === 0 ? (
          <EmptyState
            className="rounded-lg border border-border-subtle bg-surface-card p-8 text-center"
            data-testid="issue-change-review-empty"
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <section
            className="flex min-w-0 flex-col gap-3"
            aria-label={t("resultsLabel")}
            data-testid="issue-change-review-results"
          >
            <p className="text-xs text-muted-foreground">
              {t("resultCount", { issues: groups.length })}
            </p>
            {groups.map((group) => (
              <ChangeGroup
                key={group.issue.id}
                group={group}
                t={t}
                locale={locale}
                timezone={period?.timezone ?? "UTC"}
                vault={vault}
                valueLabels={valueLabels}
              />
            ))}
          </section>
        )}
      </PageBody>
    </div>
  );
}

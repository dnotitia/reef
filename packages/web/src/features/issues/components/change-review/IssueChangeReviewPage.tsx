"use client";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useIssueChangeReview } from "@/features/issues/hooks/queries/useIssueChangeReview";
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
import { ChevronDown, Clipboard, RotateCcw } from "lucide-react";
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

const KIND_KEYS = {
  created: "kinds.created",
  field_change: "kinds.field_change",
  body_update: "kinds.body_update",
  comment_added: "kinds.comment_added",
  attachment_added: "kinds.attachment_added",
  attachment_removed: "kinds.attachment_removed",
} as const;

type ReviewPeriod = IssueChangeReviewRange & {
  mode: "relative" | "custom";
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
    mode: "relative",
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
      mode: "custom",
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

function localDateStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : null;
}

function changeValue(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
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
  const key = change.event_type;
  const known: Record<string, string> = {
    status_change: "status",
    assignee_change: "assignee",
    priority_change: "priority",
    planning_link: change.field,
    impl_ref_linked: "implementation_refs",
    title_change: "title",
    labels_change: "labels",
    due_date_change: "due_date",
    estimate_change: "estimate_points",
    parent_change: "parent_id",
    relation_change: change.field,
    archived_change: "archived_at",
    issue_type_change: "issue_type",
    start_date_change: "start_date",
  };
  return t(`fields.${known[key] ?? "status_change"}` as never);
}

function ChangeDetails({
  change,
  t,
}: {
  change: IssueChange;
  t: ChangeReviewTranslator;
}): ReactNode {
  switch (change.kind) {
    case "created":
      return <p>{t("created", { title: change.title })}</p>;
    case "field_change":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-medium">{fieldName(change, t)}</span>
          <span className="break-words text-muted-foreground">
            {changeValue(change.from)}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <span className="break-words font-medium">
            {changeValue(change.to)}
          </span>
        </div>
      );
    case "body_update":
      return (
        <details className="min-w-0 rounded-md border border-border-subtle bg-surface-subtle px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-3.5 text-muted-foreground transition-transform [[open]>&]:rotate-180"
              aria-hidden="true"
            />
            {t("bodyUpdated")}
          </summary>
          {change.diff ? (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border-subtle bg-surface-page p-2 font-mono text-xs text-foreground">
              {change.diff}
            </pre>
          ) : null}
        </details>
      );
    case "comment_added":
      return (
        <details className="min-w-0 rounded-md border border-border-subtle bg-surface-subtle px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            {t("commentAdded")}
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">
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
}: {
  change: IssueChange;
  t: ChangeReviewTranslator;
  locale: string;
  timezone: string;
}) {
  return (
    <li
      className="flex min-w-0 flex-col gap-1.5 border-t border-border-subtle px-3 py-3 first:border-t-0"
      data-testid="issue-change-row"
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 80px" }}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t(KIND_KEYS[change.kind])}</span>
        <time dateTime={change.at} title={change.at}>
          {formatChangeTime(change.at, locale, timezone)}
        </time>
      </div>
      <div className="min-w-0 text-sm text-foreground">
        <ChangeDetails change={change} t={t} />
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

function ChangeGroup({
  group,
  t,
  locale,
  timezone,
  vault,
}: {
  group: IssueChangeReviewGroup;
  t: ChangeReviewTranslator;
  locale: string;
  timezone: string;
  vault: string;
}) {
  return (
    <article
      className="min-w-0 overflow-hidden rounded-lg border border-border-subtle bg-surface-card"
      data-testid="issue-change-group"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle px-3 py-3">
        <div className="min-w-0">
          <Link
            href={withVault(
              vault,
              `/issues/${encodeURIComponent(group.issue.id)}`,
            )}
            className="font-medium text-foreground underline-offset-2 hover:underline"
            data-testid="issue-change-issue-link"
          >
            {group.issue.title}
          </Link>
          <span
            className="ml-2 font-mono text-xs text-muted-foreground"
            translate="no"
          >
            {group.issue.id}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("changeCount", { count: group.changes.length })}
        </span>
      </div>
      <ol className="m-0 list-none p-0">
        {group.changes.map((change) => (
          <ChangeRow
            key={change.id}
            change={change}
            t={t}
            locale={locale}
            timezone={timezone}
          />
        ))}
      </ol>
    </article>
  );
}

export function IssueChangeReviewPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = useLocale();
  const nav = useTranslations("nav");
  const t = useTranslations("issues.changeReview");
  const [period, setPeriod] = useState<ReviewPeriod | null>(null);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [rangeError, setRangeError] = useState(false);

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
      setDraftStart(
        dateInTimezone(explicit.period.start_at, explicit.period.timezone),
      );
      setDraftEnd(
        dateInTimezone(
          new Date(Date.parse(explicit.period.end_at) - 1).toISOString(),
          explicit.period.timezone,
        ),
      );
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

  const selectRelative = useCallback(
    (days: number) => {
      const next = relativePeriod(days);
      setRangeError(false);
      setPeriod(next);
      setDraftStart(dateInTimezone(next.start_at, next.timezone));
      setDraftEnd(dateInTimezone(next.end_at, next.timezone));
      void setIssueChangeReviewPeriod(vault, days).catch(() => undefined);
      // A relative preference is intentionally not put in the URL. A copied
      // link is made explicit by `share`, while reopening recomputes this range.
      if (new URLSearchParams(explicitQuery).size > 0) {
        router.replace(withVault(vault, "/issues/changes"));
      }
    },
    [explicitQuery, router, vault],
  );

  function applyCustomRange() {
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
    const next: ReviewPeriod = {
      start_at: start.toISOString(),
      end_at: endExclusive.toISOString(),
      mode: "custom",
      timezone: localTimezone(),
    };
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
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("start_at", period.start_at);
    url.searchParams.set("end_at", period.end_at);
    url.searchParams.set("tz", period.timezone);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success(t("shareSuccess"));
    } catch {
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void sharePeriod()}
            disabled={!period}
            data-testid="issue-change-review-share"
          >
            <Clipboard className="size-3.5" aria-hidden="true" />
            {t("share")}
          </Button>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-4">
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
                    variant={
                      period?.mode === "relative" &&
                      period.relativeDays === days
                        ? "default"
                        : "outline"
                    }
                    onClick={() => selectRelative(days)}
                    data-testid={`issue-change-review-relative-${days}`}
                  >
                    {t("lastDays", { days })}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                {t("start")}
                <input
                  className="h-9 rounded-md border border-border bg-surface-page px-2 text-sm text-foreground"
                  type="date"
                  value={draftStart}
                  onChange={(event) => setDraftStart(event.target.value)}
                  data-testid="issue-change-review-start"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                {t("end")}
                <input
                  className="h-9 rounded-md border border-border bg-surface-page px-2 text-sm text-foreground"
                  type="date"
                  value={draftEnd}
                  onChange={(event) => setDraftEnd(event.target.value)}
                  data-testid="issue-change-review-end"
                />
              </label>
              <Button
                type="button"
                size="sm"
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

          {!period && rangeError ? null : review.isPending ? (
            <p
              className="rounded-lg border border-border-subtle bg-surface-card p-6 text-sm text-muted-foreground"
              role="status"
              data-testid="issue-change-review-loading"
            >
              {t("loading")}
            </p>
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
            <section
              className="rounded-lg border border-border-subtle bg-surface-card p-8 text-center"
              data-testid="issue-change-review-empty"
            >
              <h2 className="text-sm font-semibold text-foreground">
                {t("emptyTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("emptyDescription")}
              </p>
            </section>
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
                />
              ))}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

"use client";

import { formatTimestampMonthDay } from "@/features/issues/lib/dateHelpers";
import { cn } from "@/lib/utils";
import { useLocale } from "next-intl";
import { WEEK_MS } from "../lib/aggregate";
import type {
  CompletionForecast,
  CountForecast,
  MonteCarloForecast,
} from "../lib/monteCarlo";
import { MAX_FORECAST_WEEKS } from "../lib/monteCarlo";
import { Card } from "./ReportLayout";
import { RowEmpty } from "./ReportSummarySections";

/** Resolve a whole-week offset from `now` to a short month/day label. */
function weekDate(now: number, weeks: number, locale: string): string | null {
  return formatTimestampMonthDay(
    new Date(now + weeks * WEEK_MS).toISOString(),
    locale,
  );
}

/**
 * Monte Carlo delivery forecast (REEF-190). Two dual reads of the same
 * bootstrap over the period's weekly throughput: when the remaining open work
 * finishes, and how many of it finish by a near-term date. Count-based and
 * forward-looking, it sits with the Risk map / Throughput row.
 *
 * The population is open work (the active statuses), named like the Risk map and
 * Deadlines cards so it does not read as the in-scope total. The window is the one
 * the Period control already selects, so no new control is introduced — a thin
 * window simply renders the forecast with a low-confidence caption.
 */
export function ForecastCard({
  forecast,
  now,
  periodLabel,
}: {
  forecast: MonteCarloForecast;
  now: number;
  /** The Period control's label, naming the throughput window the forecast
   *  samples (e.g. "Last 12 weeks"). */
  periodLabel: string;
}) {
  const { remaining, horizonWeeks, insufficient, lowConfidence } = forecast;
  const locale = useLocale();

  const targetDate = weekDate(now, horizonWeeks, locale);
  const subtitle = insufficient
    ? `Open work · ${periodLabel}`
    : `Open work · ${remaining} remaining`;

  return (
    <Card title="Delivery forecast" subtitle={subtitle}>
      {remaining === 0 ? (
        <RowEmpty label="No open work in scope — nothing left to forecast." />
      ) : insufficient ? (
        <RowEmpty
          label={`No completions in ${periodLabel.toLowerCase()} — not enough history to forecast.`}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {lowConfidence && (
            <p
              data-testid="forecast-low-confidence"
              className="text-[11px] text-priority-high"
            >
              Thin sample — treat these as rough.
            </p>
          )}
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <ForecastColumn
              heading="When done"
              caption={`all ${remaining} open`}
            >
              {forecast.completion.map((row) => (
                <CompletionRow key={row.confidence} row={row} now={now} />
              ))}
            </ForecastColumn>
            <ForecastColumn
              heading={targetDate ? `By ${targetDate}` : "By date"}
              caption={`${horizonWeeks}w out`}
            >
              {forecast.byDate.map((row) => (
                <CountRow key={row.confidence} row={row} />
              ))}
            </ForecastColumn>
          </div>
        </div>
      )}
    </Card>
  );
}

function ForecastColumn({
  heading,
  caption,
  children,
}: {
  heading: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium text-foreground/90">{heading}</h4>
        <span className="text-[11px] text-muted-foreground">{caption}</span>
      </header>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

/** Shared row scaffold: confidence on the left, the forecast value mono-right.
 *  Each value is encoded once — the confidence is the repeated axis. */
function ForecastRow({
  confidence,
  value,
  testId,
}: {
  confidence: number;
  value: React.ReactNode;
  testId: string;
}) {
  return (
    <li
      data-testid={testId}
      className="flex items-baseline justify-between gap-3"
    >
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {confidence}%
      </span>
      <span className="min-w-0 truncate text-right text-xs text-foreground">
        {value}
      </span>
    </li>
  );
}

function CompletionRow({
  row,
  now,
}: {
  row: CompletionForecast;
  now: number;
}) {
  const locale = useLocale();
  // A capped trial did not reach the target within the hard week ceiling, so
  // there is no honest date — show it as a floor instead of a false promise.
  if (row.capped) {
    return (
      <ForecastRow
        confidence={row.confidence}
        testId={`forecast-completion-${row.confidence}`}
        value={
          <span className="font-mono tabular-nums text-muted-foreground">
            &gt;{MAX_FORECAST_WEEKS}w
          </span>
        }
      />
    );
  }
  const date = weekDate(now, row.weeks, locale);
  return (
    <ForecastRow
      confidence={row.confidence}
      testId={`forecast-completion-${row.confidence}`}
      value={
        <>
          {date && <span className="text-foreground">by {date}</span>}
          <span
            className={cn(
              "font-mono tabular-nums text-muted-foreground",
              date && "ml-1.5",
            )}
          >
            {row.weeks}w
          </span>
        </>
      }
    />
  );
}

function CountRow({ row }: { row: CountForecast }) {
  return (
    <ForecastRow
      confidence={row.confidence}
      testId={`forecast-bydate-${row.confidence}`}
      value={
        <span className="font-mono tabular-nums text-foreground">
          ≥ {row.count}
        </span>
      }
    />
  );
}

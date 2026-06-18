/**
 * Monte Carlo delivery forecasting (REEF-190).
 *
 * Turns the weekly completion throughput the reports dashboard already
 * aggregates into a probabilistic delivery forecast — without any new data,
 * event log, or cycle-time tracking (the deliberate quick-win scope). Two dual
 * questions are answered from one bootstrap over historical weekly throughput:
 *
 *   - "When will it be done?"  → weeks until all `remaining` open items finish.
 *   - "How many by date?"      → items finished within a fixed week horizon.
 *
 * Both are count-based (issue counts, does not story points) and run entirely in
 * the browser. The forecast is **deterministic by default**: the RNG is seeded
 * from the inputs, so identical data yields an identical forecast (a feature for
 * a number a PM may quote) while still drawing a representative random sample.
 * Callers may inject their own `rng` (tests do, for fully controlled streams).
 */

/** The confidence levels every forecast reports, low → high (REEF-190 AC3). */
export const FORECAST_CONFIDENCES = [50, 70, 85, 95] as const;
export type ForecastConfidence = (typeof FORECAST_CONFIDENCES)[number];

/** Default trial count. 10k keeps the bootstrap tail stable and stays well
 *  under a millisecond for reef-sized inputs. */
const DEFAULT_FORECAST_TRIALS = 10_000;

/** Near-term horizon (weeks) for the "how many by date" forecast — a sprint-ish
 *  month out. A fixed default rather than a new date control: "by date" stays
 *  meaningful without widening the scope bar (REEF-190). */
export const DEFAULT_FORECAST_HORIZON_WEEKS = 4;

/** Per-trial week cap so a sample dominated by zero-throughput weeks does not
 *  spin the "when done" loop unboundedly. A trial that hits it records the cap
 *  (≈10 years) rather than diverging. */
export const MAX_FORECAST_WEEKS = 520;

/** A sample window shorter than this doesn't support a trustworthy 95th-percentile
 *  tail, so the forecast is flagged low-confidence (REEF-190 sample-window
 *  decision: reuse the period control, default 12w, guard thin history). */
const MIN_RELIABLE_SAMPLE_WEEKS = 8;

/** …and even a long window is thin if a couple of weeks ever saw a
 *  completion — a young project on a 12-week window. Fewer productive weeks
 *  than this also trips the low-confidence flag. */
const MIN_PRODUCTIVE_WEEKS = 3;

export interface ForecastInput {
  /** Open (committed, not-yet-resolved) items left in scope — the active
   *  statuses todo/in_progress/in_review, excluding backlog and resolved. */
  remaining: number;
  /** One completed-count sample per window week, oldest first. Zero weeks are
   *  kept on purpose: a week with no completions is real signal that the
   *  forecast should not discard. */
  weeklyThroughput: ReadonlyArray<number>;
  /** Whole-week horizon for the "how many by date" forecast. */
  horizonWeeks: number;
}

export interface ForecastOptions {
  trials?: number;
  /** Uniform [0, 1) source. Defaults to a deterministic PRNG seeded from the
   *  input, so the forecast is reproducible. */
  rng?: () => number;
  maxWeeks?: number;
}

/** Weeks until all `remaining` items finish, at one confidence level. Higher
 *  confidence ⇒ more weeks (you finish *by* a later week with more certainty). */
export interface CompletionForecast {
  confidence: ForecastConfidence;
  weeks: number;
  /** True when the trial hit `MAX_FORECAST_WEEKS` — the estimate is a floor. */
  capped: boolean;
}

/** Items finished within the horizon, at one confidence level. Higher
 *  confidence ⇒ *fewer* items (you finish *at least* this many more surely). */
export interface CountForecast {
  confidence: ForecastConfidence;
  count: number;
}

export interface MonteCarloForecast {
  remaining: number;
  horizonWeeks: number;
  sampleWeeks: number;
  totalThroughput: number;
  /** Window weeks with at least one completion. */
  productiveWeeks: number;
  /** Sample too thin to trust the tail (short window or thin history). The
   *  forecast still renders; the caller labels it as low-confidence. */
  lowConfidence: boolean;
  /** No forecast possible: there is work left but zero historical throughput. */
  insufficient: boolean;
  /** Empty when `insufficient`; all-zero when `remaining` is 0. */
  completion: CompletionForecast[];
  byDate: CountForecast[];
}

/** mulberry32 — a small, fast, well-distributed 32-bit PRNG. Used instead of
 *  `Math.random` so a given seed consistently produces the same stream. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Create a seeded uniform [0, 1) RNG — exported so callers/tests can pin a
 *  stream explicitly. */
export function createSeededRng(seed: number): () => number {
  return mulberry32(seed);
}

/** Fold the input into a 32-bit seed (FNV-1a over the shape and the samples) so
 *  the same data deterministically reproduces the same forecast. */
function deriveSeed(input: ForecastInput): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => {
    h ^= n | 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(input.remaining);
  mix(input.horizonWeeks);
  for (const sample of input.weeklyThroughput) mix(sample);
  return h >>> 0;
}

/** Nearest-rank quantile of an ascending-sorted array, `q` in [0, 1]. */
function quantile(sortedAsc: ReadonlyArray<number>, q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sortedAsc[idx];
}

/**
 * Bootstrap a delivery forecast from weekly throughput samples.
 *
 * Each trial draws weekly throughput with replacement: the "when done" leg
 * keeps drawing weeks until cumulative completions reach `remaining` (capped),
 * while the "by date" leg sums `horizonWeeks` draws and caps at `remaining`
 * (produced counts are capped at the remaining item count). Percentiles then map confidence to
 * a value, accounting for the opposite direction of the two questions.
 */
export function computeForecast(
  input: ForecastInput,
  options: ForecastOptions = {},
): MonteCarloForecast {
  const { weeklyThroughput, horizonWeeks } = input;
  const remaining = Math.max(0, Math.floor(input.remaining));
  const sampleWeeks = weeklyThroughput.length;
  const totalThroughput = weeklyThroughput.reduce((sum, n) => sum + n, 0);
  const productiveWeeks = weeklyThroughput.reduce(
    (n, week) => (week > 0 ? n + 1 : n),
    0,
  );
  const lowConfidence =
    sampleWeeks < MIN_RELIABLE_SAMPLE_WEEKS ||
    productiveWeeks < MIN_PRODUCTIVE_WEEKS;

  const base = {
    remaining,
    horizonWeeks,
    sampleWeeks,
    totalThroughput,
    productiveWeeks,
    lowConfidence,
  };

  // Nothing left in scope: a real, fully-determined "done now" answer.
  if (remaining === 0) {
    return {
      ...base,
      insufficient: false,
      completion: FORECAST_CONFIDENCES.map((confidence) => ({
        confidence,
        weeks: 0,
        capped: false,
      })),
      byDate: FORECAST_CONFIDENCES.map((confidence) => ({
        confidence,
        count: 0,
      })),
    };
  }

  // Work remains but there is no throughput to extrapolate from — refuse to
  // invent a forecast.
  if (sampleWeeks === 0 || totalThroughput === 0) {
    return { ...base, insufficient: true, completion: [], byDate: [] };
  }

  const trials = Math.max(1, options.trials ?? DEFAULT_FORECAST_TRIALS);
  const maxWeeks = options.maxWeeks ?? MAX_FORECAST_WEEKS;
  const rng = options.rng ?? mulberry32(deriveSeed(input));
  const draw = () => weeklyThroughput[Math.floor(rng() * sampleWeeks)] ?? 0;

  const weekTrials = new Array<number>(trials);
  const cappedTrials = new Array<boolean>(trials);
  const countTrials = new Array<number>(trials);

  for (let t = 0; t < trials; t++) {
    let done = 0;
    let weeks = 0;
    while (done < remaining && weeks < maxWeeks) {
      done += draw();
      weeks++;
    }
    weekTrials[t] = weeks;
    cappedTrials[t] = done < remaining;

    let produced = 0;
    for (let w = 0; w < horizonWeeks; w++) produced += draw();
    countTrials[t] = Math.min(remaining, produced);
  }

  // Sorting the week trials by value (carrying their original index) lets us
  // read both the percentile week and whether that trial diverged (capped).
  const weekOrder = Array.from({ length: trials }, (_, i) => i).sort(
    (a, b) => weekTrials[a] - weekTrials[b],
  );
  const sortedWeeks = weekOrder.map((i) => weekTrials[i]);
  const sortedCounts = [...countTrials].sort((a, b) => a - b);

  const completion: CompletionForecast[] = FORECAST_CONFIDENCES.map(
    (confidence) => {
      const q = confidence / 100;
      const idx = Math.min(trials - 1, Math.max(0, Math.ceil(q * trials) - 1));
      return {
        confidence,
        weeks: sortedWeeks[idx],
        capped: cappedTrials[weekOrder[idx]],
      };
    },
  );

  // "How many by date" runs the other way: more confidence ⇒ a lower count you
  // can promise to *at least* reach, i.e. the (1 − c) quantile.
  const byDate: CountForecast[] = FORECAST_CONFIDENCES.map((confidence) => ({
    confidence,
    count: quantile(sortedCounts, 1 - confidence / 100),
  }));

  return { ...base, insufficient: false, completion, byDate };
}

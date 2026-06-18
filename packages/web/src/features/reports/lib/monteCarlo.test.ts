// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  FORECAST_CONFIDENCES,
  MAX_FORECAST_WEEKS,
  computeForecast,
  createSeededRng,
} from "./monteCarlo";

describe("computeForecast — AC1: when will it be done", () => {
  it("returns an exact week count when throughput is constant", () => {
    // A perfectly steady 2/week with 10 remaining always finishes in 5 weeks,
    // independent of the RNG — a deterministic floor for the simulation.
    const forecast = computeForecast({
      remaining: 10,
      weeklyThroughput: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      horizonWeeks: 4,
    });
    for (const c of forecast.completion) {
      expect(c.weeks).toBe(5);
      expect(c.capped).toBe(false);
    }
  });

  it("rounds partial weeks up — a week is the unit of completion", () => {
    // 3/week, 10 remaining → 4 weeks (ceil of 3.33), never 3.
    const forecast = computeForecast({
      remaining: 10,
      weeklyThroughput: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      horizonWeeks: 4,
    });
    expect(forecast.completion.every((c) => c.weeks === 4)).toBe(true);
  });

  it("widens the week estimate as confidence rises (later ⇒ surer)", () => {
    const forecast = computeForecast({
      remaining: 30,
      weeklyThroughput: [0, 1, 5, 2, 0, 4, 1, 3, 6, 0, 2, 4],
      horizonWeeks: 4,
    });
    const weeks = forecast.completion.map((c) => c.weeks);
    // Monotonic non-decreasing across 50 → 70 → 85 → 95.
    expect(weeks).toEqual([...weeks].sort((a, b) => a - b));
    expect(weeks[3]).toBeGreaterThanOrEqual(weeks[0]);
  });

  it("caps a divergent (all-zero-but-one) sample instead of looping forever", () => {
    const forecast = computeForecast(
      {
        remaining: 100,
        weeklyThroughput: [0, 0, 0, 0, 0, 0, 0, 1],
        horizonWeeks: 4,
      },
      { maxWeeks: 20, trials: 200 },
    );
    expect(forecast.insufficient).toBe(false);
    // Most trials never reach 100 within 20 weeks → capped floors at 20.
    expect(forecast.completion.every((c) => c.weeks <= 20)).toBe(true);
    expect(forecast.completion.at(-1)?.capped).toBe(true);
  });
});

describe("computeForecast — AC2: how many by date", () => {
  it("returns an exact count when throughput is constant", () => {
    // 2/week over a 3-week horizon = 6, and 6 < 20 remaining so it is not
    // clamped by the remaining cap.
    const forecast = computeForecast({
      remaining: 20,
      weeklyThroughput: [2, 2, 2, 2, 2, 2, 2, 2],
      horizonWeeks: 3,
    });
    expect(forecast.byDate.every((b) => b.count === 6)).toBe(true);
  });

  it("never forecasts more completed than remain in scope", () => {
    // 5/week over 4 weeks = 20 produced, but only 3 items remain.
    const forecast = computeForecast({
      remaining: 3,
      weeklyThroughput: [5, 5, 5, 5, 5, 5, 5, 5],
      horizonWeeks: 4,
    });
    expect(forecast.byDate.every((b) => b.count === 3)).toBe(true);
  });

  it("lowers the at-least count as confidence rises (fewer ⇒ surer)", () => {
    const forecast = computeForecast({
      remaining: 50,
      weeklyThroughput: [0, 1, 5, 2, 0, 4, 1, 3, 6, 0, 2, 4],
      horizonWeeks: 6,
    });
    const counts = forecast.byDate.map((b) => b.count);
    // Monotonic non-increasing across 50 → 70 → 85 → 95.
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts[3]).toBeLessThanOrEqual(counts[0]);
  });
});

describe("computeForecast — AC3: the 50/70/85/95 percentiles", () => {
  it("reports exactly those four confidence levels on both forecasts", () => {
    const forecast = computeForecast({
      remaining: 12,
      weeklyThroughput: [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
      horizonWeeks: 4,
    });
    expect(forecast.completion.map((c) => c.confidence)).toEqual([
      ...FORECAST_CONFIDENCES,
    ]);
    expect(forecast.byDate.map((b) => b.confidence)).toEqual([
      ...FORECAST_CONFIDENCES,
    ]);
  });
});

describe("computeForecast — guards", () => {
  it("flags insufficient when work remains but throughput is all zero", () => {
    const forecast = computeForecast({
      remaining: 8,
      weeklyThroughput: [0, 0, 0, 0, 0, 0, 0, 0],
      horizonWeeks: 4,
    });
    expect(forecast.insufficient).toBe(true);
    expect(forecast.completion).toEqual([]);
    expect(forecast.byDate).toEqual([]);
  });

  it("treats an empty scope as done now, not insufficient", () => {
    const forecast = computeForecast({
      remaining: 0,
      weeklyThroughput: [1, 2, 3, 1, 2, 3, 1, 2],
      horizonWeeks: 4,
    });
    expect(forecast.insufficient).toBe(false);
    expect(forecast.completion.every((c) => c.weeks === 0)).toBe(true);
    expect(forecast.byDate.every((b) => b.count === 0)).toBe(true);
  });

  it("flags low confidence for a short sample window (< 8 weeks)", () => {
    const forecast = computeForecast({
      remaining: 10,
      weeklyThroughput: [2, 2, 2, 2],
      horizonWeeks: 4,
    });
    expect(forecast.lowConfidence).toBe(true);
    expect(forecast.insufficient).toBe(false);
  });

  it("flags low confidence when only a couple of weeks were productive", () => {
    // 12-week window, but only 2 weeks ever saw a completion.
    const forecast = computeForecast({
      remaining: 10,
      weeklyThroughput: [0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 6],
      horizonWeeks: 4,
    });
    expect(forecast.sampleWeeks).toBe(12);
    expect(forecast.productiveWeeks).toBe(2);
    expect(forecast.lowConfidence).toBe(true);
  });

  it("does not flag low confidence for a full, productive window", () => {
    const forecast = computeForecast({
      remaining: 10,
      weeklyThroughput: [1, 2, 1, 3, 2, 1, 2, 3, 1, 2, 1, 2],
      horizonWeeks: 4,
    });
    expect(forecast.lowConfidence).toBe(false);
  });
});

describe("computeForecast — determinism", () => {
  it("reproduces the same forecast for the same input (seeded by default)", () => {
    const input = {
      remaining: 25,
      weeklyThroughput: [0, 1, 5, 2, 0, 4, 1, 3, 6, 0, 2, 4],
      horizonWeeks: 4,
    } as const;
    const a = computeForecast(input);
    const b = computeForecast(input);
    expect(a.completion).toEqual(b.completion);
    expect(a.byDate).toEqual(b.byDate);
  });

  it("honors an injected RNG stream", () => {
    const input = {
      remaining: 25,
      weeklyThroughput: [0, 1, 5, 2, 0, 4, 1, 3, 6, 0, 2, 4],
      horizonWeeks: 4,
    } as const;
    const a = computeForecast(input, { rng: createSeededRng(1) });
    const b = computeForecast(input, { rng: createSeededRng(1) });
    const c = computeForecast(input, { rng: createSeededRng(2) });
    expect(a.completion).toEqual(b.completion);
    // A different seed should (almost surely) shift at least one percentile.
    expect(c.completion).not.toEqual(a.completion);
  });

  it("never exceeds the hard week cap", () => {
    const forecast = computeForecast({
      remaining: 10_000,
      weeklyThroughput: [0, 0, 0, 1, 0, 0, 0, 0],
      horizonWeeks: 4,
    });
    expect(
      forecast.completion.every((c) => c.weeks <= MAX_FORECAST_WEEKS),
    ).toBe(true);
  });
});

import { performance } from "node:perf_hooks";

export interface JiraMigrationProfileMetric {
  name: string;
  calls: number;
  errors: number;
  total_ms: number;
  average_ms: number;
  max_ms: number;
}

export interface JiraMigrationProfile {
  elapsed_ms: number;
  metrics: JiraMigrationProfileMetric[];
  active: Array<{
    name: string;
    calls: number;
    oldest_elapsed_ms: number;
  }>;
}

interface MutableMetric {
  calls: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

const roundedMilliseconds = (value: number): number =>
  Math.round(value * 100) / 100;

export class JiraMigrationProfiler {
  readonly #startedAt = performance.now();
  readonly #metrics = new Map<string, MutableMetric>();
  readonly #active = new Map<string, Map<number, number>>();
  #nextCallId = 0;

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const call = this.#begin(name);
    let failed = false;
    try {
      return await operation();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      this.#finish(name, call, failed);
    }
  }

  measureCall<T>(name: string, operation: () => T): T {
    const call = this.#begin(name);
    let result: T;
    try {
      result = operation();
    } catch (error) {
      this.#finish(name, call, true);
      throw error;
    }
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      return Promise.resolve(result).then(
        (value) => {
          this.#finish(name, call, false);
          return value;
        },
        (error) => {
          this.#finish(name, call, true);
          throw error;
        },
      ) as T;
    }
    this.#finish(name, call, false);
    return result;
  }

  snapshot(): JiraMigrationProfile {
    const now = performance.now();
    return {
      elapsed_ms: roundedMilliseconds(now - this.#startedAt),
      metrics: [...this.#metrics]
        .map(([name, metric]) => ({
          name,
          calls: metric.calls,
          errors: metric.errors,
          total_ms: roundedMilliseconds(metric.totalMs),
          average_ms: roundedMilliseconds(metric.totalMs / metric.calls),
          max_ms: roundedMilliseconds(metric.maxMs),
        }))
        .sort(
          (left, right) =>
            right.total_ms - left.total_ms ||
            left.name.localeCompare(right.name),
        ),
      active: [...this.#active]
        .map(([name, calls]) => ({
          name,
          calls: calls.size,
          oldest_elapsed_ms: roundedMilliseconds(
            now - Math.min(...calls.values()),
          ),
        }))
        .sort(
          (left, right) =>
            right.oldest_elapsed_ms - left.oldest_elapsed_ms ||
            left.name.localeCompare(right.name),
        ),
    };
  }

  #begin(name: string): { id: number; startedAt: number } {
    const call = {
      id: this.#nextCallId++,
      startedAt: performance.now(),
    };
    const active = this.#active.get(name) ?? new Map<number, number>();
    active.set(call.id, call.startedAt);
    this.#active.set(name, active);
    return call;
  }

  #finish(
    name: string,
    call: { id: number; startedAt: number },
    failed: boolean,
  ): void {
    const active = this.#active.get(name);
    active?.delete(call.id);
    if (active?.size === 0) this.#active.delete(name);
    this.#record(name, performance.now() - call.startedAt, failed);
  }

  #record(name: string, elapsedMs: number, failed: boolean): void {
    const metric = this.#metrics.get(name) ?? {
      calls: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
    };
    metric.calls += 1;
    metric.errors += failed ? 1 : 0;
    metric.totalMs += elapsedMs;
    metric.maxMs = Math.max(metric.maxMs, elapsedMs);
    this.#metrics.set(name, metric);
  }
}

export const profileMethods = <T extends object>(
  value: T,
  profiler: JiraMigrationProfiler,
  prefix: string,
): T =>
  new Proxy(value, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) =>
        profiler.measureCall(`${prefix}.${String(property)}`, () =>
          Reflect.apply(member, target, args),
        );
    },
  });

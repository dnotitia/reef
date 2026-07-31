import { describe, expect, it } from "vitest";
import { JiraMigrationProfiler, profileMethods } from "./profiler.js";

describe("JiraMigrationProfiler", () => {
  it("aggregates successful and failed asynchronous calls", async () => {
    const profiler = new JiraMigrationProfiler();

    await profiler.measure("jira.comments", async () => "first");
    await profiler.measure("jira.comments", async () => "second");
    await expect(
      profiler.measure("jira.comments", async () => {
        throw new Error("read_failed");
      }),
    ).rejects.toThrow("read_failed");

    const metric = profiler
      .snapshot()
      .metrics.find((candidate) => candidate.name === "jira.comments");
    expect(metric).toMatchObject({
      calls: 3,
      errors: 1,
    });
    expect(metric?.total_ms).toBeGreaterThanOrEqual(0);
    expect(metric?.max_ms).toBeGreaterThanOrEqual(0);
  });

  it("profiles synchronous and asynchronous object methods without changing results", async () => {
    const profiler = new JiraMigrationProfiler();
    const subject = profileMethods(
      {
        add(left: number, right: number) {
          return left + right;
        },
        async double(value: number) {
          return value * 2;
        },
      },
      profiler,
      "target",
    );

    expect(subject.add(2, 3)).toBe(5);
    await expect(subject.double(4)).resolves.toBe(8);
    expect(profiler.snapshot().metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "target.add", calls: 1, errors: 0 }),
        expect.objectContaining({
          name: "target.double",
          calls: 1,
          errors: 0,
        }),
      ]),
    );
  });

  it("reports in-flight calls before they complete", async () => {
    const profiler = new JiraMigrationProfiler();
    let resolve: (() => void) | undefined;
    const pending = profiler.measure(
      "stage.plan_build",
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );

    expect(profiler.snapshot().active).toEqual([
      expect.objectContaining({
        name: "stage.plan_build",
        calls: 1,
      }),
    ]);
    resolve?.();
    await pending;
    expect(profiler.snapshot().active).toEqual([]);
  });
});

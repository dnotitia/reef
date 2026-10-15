interface Suite {
  title: string;
  specs?: {
    file: string;
    title: string;
    tests: { projectName: string; expectedStatus: string }[];
  }[];
  suites?: Suite[];
}
interface CollectedTest {
  selector: string;
  file: string;
  project: string;
  repeats: number;
  skipped: boolean;
}
interface DurationProfile {
  defaultDurationMs: number;
  files: Record<string, number>;
  tests: Record<string, number>;
}

/** Native Playwright selectors keep collection/filtering owned by Playwright. */
export function collectTests(report: { suites: Suite[] }) {
  const tests = new Map<string, CollectedTest>();
  function visit(suite: Suite, titles: string[]) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const selector = `[${test.projectName}] › ${spec.file} › ${[...titles, spec.title].join(" › ")}`;
        const existing = tests.get(selector);
        if (existing) existing.repeats += 1;
        else
          tests.set(selector, {
            selector,
            file: spec.file,
            project: test.projectName,
            repeats: 1,
            skipped: test.expectedStatus === "skipped",
          });
      }
    }
    for (const child of suite.suites ?? [])
      visit(child, [...titles, child.title]);
  }
  for (const file of report.suites) visit(file, []);
  return [...tests.values()];
}

/** Longest-first scheduling with deterministic ties across local and CI hosts. */
export function scheduleTests(
  tests: CollectedTest[],
  profile: DurationProfile,
  count: number,
) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("invalid shard count");
  const seen = new Set();
  const weighted = tests
    .map((test) => {
      if (seen.has(test.selector))
        throw new Error(`duplicate test: ${test.selector}`);
      seen.add(test.selector);
      const duration = test.skipped
        ? 1
        : (profile.tests[test.selector] ??
          profile.files[`${test.project}/${test.file}`] ??
          profile.defaultDurationMs);
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error(`invalid duration: ${test.selector}`);
      return { ...test, estimatedDurationMs: duration * test.repeats };
    })
    .sort(
      (a, b) =>
        b.estimatedDurationMs - a.estimatedDurationMs ||
        (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0),
    );
  const shards = Array.from({ length: count }, (_, index) => ({
    shard: index + 1,
    estimatedDurationMs: 0,
    tests: [] as typeof weighted,
  }));
  for (const test of weighted) {
    const shard = shards.reduce((lightest, current) =>
      current.estimatedDurationMs < lightest.estimatedDurationMs
        ? current
        : lightest,
    );
    shard.tests.push(test);
    shard.estimatedDurationMs += test.estimatedDurationMs;
  }
  return shards;
}

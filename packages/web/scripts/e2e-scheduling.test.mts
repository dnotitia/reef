// @vitest-environment node
import { expect, it } from "vitest";
import { collectTests, scheduleTests } from "./e2e-scheduling.mjs";

const profile = {
  defaultDurationMs: 100,
  files: { "chromium/heavy.ts": 1000 },
  tests: { special: 2000 },
};
const testCase = (
  selector: string,
  file = "new.ts",
  skipped = false,
  repeats = 1,
) => ({ selector, file, project: "chromium", skipped, repeats });

it("distributes long tests while assigning every collected case exactly once", () => {
  const tests = [
    testCase("special"),
    ...Array.from({ length: 4 }, (_, i) => testCase(`heavy-${i}`, "heavy.ts")),
    ...Array.from({ length: 12 }, (_, i) => testCase(`new-${i}`)),
  ];
  const plans = scheduleTests(tests, profile, 3);
  expect(plans.map((plan) => plan.estimatedDurationMs)).toEqual([
    2400, 2400, 2400,
  ]);
  expect(
    plans.flatMap((plan) => plan.tests.map((test) => test.selector)).sort(),
  ).toEqual(tests.map((test) => test.selector).sort());
  expect(scheduleTests([...tests].reverse(), profile, 3)).toEqual(plans);
});

it("uses only the collected subset and accounts for repetitions and skips", () => {
  const plans = scheduleTests(
    [testCase("new", "new.ts", false, 3), testCase("skip", "heavy.ts", true)],
    profile,
    3,
  );
  expect(plans.map((plan) => plan.estimatedDurationMs)).toEqual([300, 1, 0]);
  expect(plans.flatMap((plan) => plan.tests)).toHaveLength(2);
});

it("collects native selectors with nested titles, projects, and repetitions", () => {
  const report = {
    suites: [
      {
        title: "a.ts",
        suites: [
          {
            title: "outer",
            suites: [
              {
                title: "inner",
                specs: [
                  {
                    file: "a.ts",
                    title: "case",
                    tests: [
                      { projectName: "chromium", expectedStatus: "passed" },
                      { projectName: "chromium", expectedStatus: "passed" },
                      {
                        projectName: "visual-matrix",
                        expectedStatus: "skipped",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  expect(collectTests(report)).toEqual([
    {
      selector: "[chromium] › a.ts › outer › inner › case",
      file: "a.ts",
      project: "chromium",
      skipped: false,
      repeats: 2,
    },
    {
      selector: "[visual-matrix] › a.ts › outer › inner › case",
      file: "a.ts",
      project: "visual-matrix",
      skipped: true,
      repeats: 1,
    },
  ]);
});

it("rejects duplicate identities and invalid duration estimates", () => {
  expect(() =>
    scheduleTests([testCase("same"), testCase("same")], profile, 3),
  ).toThrow("duplicate test");
  expect(() =>
    scheduleTests([testCase("new")], { ...profile, defaultDurationMs: 0 }, 3),
  ).toThrow("invalid duration");
});

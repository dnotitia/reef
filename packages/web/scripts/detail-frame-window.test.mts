import { expect, it } from "vitest";
import { framesAtFirstContentfulPaint } from "../tests/e2e/harness/browser-observations";

const frame = (
  time: number,
  panelOnscreen: boolean,
  panelCount = 1,
  dialogCount = 1,
) => ({ time, panelOnscreen, panelCount, dialogCount });

it("keeps the sample before paint and every later frame", () => {
  const frames = [
    frame(195.3, false, 0, 0),
    frame(195.7, false, 0, 0),
    frame(201.2, false, 0, 0),
    frame(228.1, true),
  ];
  const result = framesAtFirstContentfulPaint(frames, 205.1);
  expect(result.map(({ time }) => time)).toEqual([201.2, 228.1]);
  expect(result.findIndex(({ panelOnscreen }) => panelOnscreen)).toBe(1);
});

it("does not hide missing, disappearing or duplicate panels after paint", () => {
  const delayed = framesAtFirstContentfulPaint(
    [frame(1, false), frame(2, false), frame(3, false), frame(4, true)],
    1.5,
  );
  expect(
    delayed.findIndex(({ panelOnscreen }) => panelOnscreen),
  ).toBeGreaterThan(1);
  const disappeared = framesAtFirstContentfulPaint(
    [frame(1, true), frame(2, true), frame(3, false)],
    1.5,
  );
  expect(disappeared.every(({ panelOnscreen }) => panelOnscreen)).toBe(false);
  const duplicate = framesAtFirstContentfulPaint(
    [frame(1, true), frame(2, true), frame(3, true, 2, 2)],
    1.5,
  );
  expect(
    duplicate.every(
      ({ panelCount, dialogCount }) => panelCount === 1 && dialogCount === 1,
    ),
  ).toBe(false);
});

it("handles paint before the first sample and exactly on a sample", () => {
  const frames = [frame(10, false), frame(20, true), frame(30, true)];
  expect(framesAtFirstContentfulPaint(frames, 5)).toEqual(frames);
  expect(framesAtFirstContentfulPaint(frames, 20)).toEqual(frames);
});

it("rejects missing, invalid or unobserved paint timing", () => {
  const frames = [frame(10, true), frame(20, true)];
  for (const paintTime of [undefined, 0, -1, NaN, Infinity, 21]) {
    expect(() => framesAtFirstContentfulPaint(frames, paintTime)).toThrow();
  }
});

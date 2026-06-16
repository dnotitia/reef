import { expect, test } from "vitest";

// Guards the environmentMatchGlobs rule in vitest.config.ts: every test under
// src/app/api should run in the node environment. If that glob is removed or the
// routes move, these tests silently fall back to jsdom (still passing, just
// slower and able to lean on DOM globals). Here `window` would become defined
// and this fails loudly instead.
test("api route tests run under the node environment", () => {
  expect(typeof window).toBe("undefined");
});

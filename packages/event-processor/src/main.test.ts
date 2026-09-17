import { describe, expect, it } from "vitest";
import { waitForDrain } from "./main.js";

describe("processor shutdown drain", () => {
  it("waits for bounded work to finish before returning", async () => {
    let finish: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const draining = waitForDrain(running, 100);
    finish();

    await expect(draining).resolves.toBe(true);
  });

  it("reports a handler that exceeds the shutdown grace", async () => {
    const running = new Promise<void>(() => undefined);
    await expect(waitForDrain(running, 10)).resolves.toBe(false);
  });
});

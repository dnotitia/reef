import { afterEach, describe, expect, it, vi } from "vitest";
import { E2E_WORKER_HEADER, e2eWorkerHeaders } from "./workerHeader";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("e2eWorkerHeaders", () => {
  it("forwards a validated worker id only when the E2E mock is configured", () => {
    vi.stubEnv("REEF_E2E_MOCK_URL", "http://127.0.0.1:7354");

    expect(
      e2eWorkerHeaders(new Headers({ [E2E_WORKER_HEADER]: "worker-2" })),
    ).toEqual({ [E2E_WORKER_HEADER]: "worker-2" });
  });

  it("ignores synthetic headers outside the E2E harness", () => {
    expect(
      e2eWorkerHeaders(new Headers({ [E2E_WORKER_HEADER]: "worker-2" })),
    ).toBeUndefined();
  });

  it("rejects malformed worker ids", () => {
    vi.stubEnv("REEF_E2E_MOCK_URL", "http://127.0.0.1:7354");

    expect(
      e2eWorkerHeaders(
        new Headers({ [E2E_WORKER_HEADER]: "worker/../../default" }),
      ),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  EventProcessorConfigurationError,
  parseEventProcessorConfig,
} from "./config.js";

const validEnvironment = {
  AKB_BACKEND_URL: "https://akb.example.test",
  REEF_EVENT_PROCESSOR_AKB_TOKEN: "processor-test-credential",
  REEF_EVENT_PROCESSOR_VAULT: "reef-test",
};

describe("event processor configuration", () => {
  it("applies documented internal listener and lifecycle defaults", () => {
    expect(parseEventProcessorConfig(validEnvironment)).toEqual({
      baseUrl: "https://akb.example.test",
      credential: "processor-test-credential",
      vault: "reef-test",
      host: "0.0.0.0",
      port: 9090,
      reconnectDelayMs: 1_000,
      reconciliationIntervalMs: 300_000,
      drainTimeoutMs: 20_000,
    });
  });

  it("requires an AKB URL, deployment credential, and explicit vault", () => {
    for (const name of [
      "AKB_BACKEND_URL",
      "REEF_EVENT_PROCESSOR_AKB_TOKEN",
      "REEF_EVENT_PROCESSOR_VAULT",
    ]) {
      const environment = { ...validEnvironment };
      delete environment[name as keyof typeof environment];
      expect(() => parseEventProcessorConfig(environment)).toThrow(
        expect.objectContaining({ variable: name }),
      );
    }
  });

  it("does not include credentials or endpoint values in configuration errors", () => {
    expect(() =>
      parseEventProcessorConfig({
        ...validEnvironment,
        REEF_EVENT_PROCESSOR_AKB_TOKEN: "test-value",
        AKB_BACKEND_URL: "http://public.example.test",
      }),
    ).toThrow(EventProcessorConfigurationError);
    try {
      parseEventProcessorConfig({
        ...validEnvironment,
        REEF_EVENT_PROCESSOR_AKB_TOKEN: "test-value",
        AKB_BACKEND_URL: "http://public.example.test",
      });
    } catch (error) {
      expect((error as Error).message).not.toContain("test-value");
      expect((error as Error).message).not.toContain("public.example.test");
    }
  });

  it("allows private AKB HTTP endpoints and validates numeric bounds", () => {
    expect(
      parseEventProcessorConfig({
        ...validEnvironment,
        AKB_BACKEND_URL: "http://akb-backend.akb.svc.cluster.local:8000",
        REEF_EVENT_PROCESSOR_RECONCILIATION_INTERVAL_MS: "60000",
        REEF_EVENT_PROCESSOR_DRAIN_TIMEOUT_MS: "30000",
        REEF_EVENT_PROCESSOR_PORT: "9191",
      }),
    ).toMatchObject({
      baseUrl: "http://akb-backend.akb.svc.cluster.local:8000",
      reconciliationIntervalMs: 60_000,
      drainTimeoutMs: 30_000,
      port: 9_191,
    });

    for (const [name, value] of [
      ["REEF_EVENT_PROCESSOR_PORT", "65536"],
      ["REEF_EVENT_PROCESSOR_RECONNECT_DELAY_MS", "99"],
      ["REEF_EVENT_PROCESSOR_RECONCILIATION_INTERVAL_MS", "1000"],
      ["REEF_EVENT_PROCESSOR_DRAIN_TIMEOUT_MS", "60001"],
    ]) {
      expect(() =>
        parseEventProcessorConfig({ ...validEnvironment, [name]: value }),
      ).toThrow(EventProcessorConfigurationError);
    }
  });

  it("rejects malformed vault names, URL credentials, and header-breaking tokens", () => {
    for (const environment of [
      { ...validEnvironment, REEF_EVENT_PROCESSOR_VAULT: "Uppercase" },
      {
        ...validEnvironment,
        AKB_BACKEND_URL: "https://user:pw@akb.example.test",
      },
      {
        ...validEnvironment,
        REEF_EVENT_PROCESSOR_AKB_TOKEN: "tok" + "en\r\nInjected: true",
      },
    ]) {
      expect(() => parseEventProcessorConfig(environment)).toThrow(
        EventProcessorConfigurationError,
      );
    }
  });
});

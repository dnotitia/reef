// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  AKB_REVISION,
  FAULT_KINDS,
  LIVE_SCENARIO,
  PASSWORD_ENV,
  buildDiscovery,
  buildReadyDescriptor,
  parseOptions,
} from "./live-notifications-runtime.mjs";

describe("live notification runtime contract", () => {
  it("accepts only the approved serve scenario and private paths", () => {
    expect(
      parseOptions(
        [
          "serve",
          "--scenario",
          LIVE_SCENARIO,
          "--runtime-root",
          "/tmp/reef-live-runtime",
          "--akb-checkout",
          "/tmp/akb-source",
        ],
        { NODE_ENV: "test" },
      ),
    ).toEqual({
      mode: "serve",
      scenario: LIVE_SCENARIO,
      runtimeRoot: "/tmp/reef-live-runtime",
      akbCheckout: "/tmp/akb-source",
    });
    expect(() =>
      parseOptions(["gate", "--scenario", LIVE_SCENARIO], {
        NODE_ENV: "test",
      }),
    ).toThrow(/usage/u);
    expect(() =>
      parseOptions(["serve", "--scenario", "notifications"], {
        NODE_ENV: "test",
      }),
    ).toThrow(/notifications-rbac/u);
  });

  it("publishes a schema-v2 descriptor for Reef, AKB, and fixture services", () => {
    const descriptor = buildReadyDescriptor({
      webOrigin: "http://127.0.0.1:41001",
      akbOrigin: "http://127.0.0.1:41002",
      fixtureOrigin: "http://127.0.0.1:41003",
      candidateRevision: "candidate-sha",
    });

    expect(descriptor).toMatchObject({
      schema_version: 2,
      status: "ready",
      scenario: LIVE_SCENARIO,
      services: {
        web: {
          health: { method: "GET", url: "http://127.0.0.1:41001/api/healthz" },
        },
        app: {
          health: { method: "GET", url: "http://127.0.0.1:41002/readyz" },
        },
        fixture: {
          reset: { method: "POST", body: { scenario: LIVE_SCENARIO } },
          discovery: { method: "GET", url: "http://127.0.0.1:41003/discover" },
        },
      },
      credentials: {
        password_env: PASSWORD_ENV,
        login_path: "/api/auth/akb/login",
      },
    });
    const serialized = JSON.stringify(descriptor);
    expect(serialized).not.toContain("password-value");
    expect(serialized).not.toContain("session-token");
    expect(serialized).not.toContain("administrator-credential");
    expect(descriptor.evidence).toMatchObject({
      akb_source_revision: AKB_REVISION,
      candidate_revision: "candidate-sha",
    });
  });

  it("discovers real role coordinates and credential-free fault controls", () => {
    const discovery = buildDiscovery({
      vault: "reef-live-vault",
      webOrigin: "http://127.0.0.1:41001",
      fixtureOrigin: "http://127.0.0.1:41003",
      roles: {
        reader: "reef-live-reader",
        writer: "reef-live-writer",
        owner: "reef-live-owner",
      },
      permissionChecks: {
        reader_select: 200,
        reader_update: 403,
        writer_update: 200,
      },
      candidateRevision: "candidate-sha",
    });

    expect(discovery.roles.reader).toMatchObject({
      username: "reef-live-reader",
      role: "reader",
      start_path: "/workspace/reef-live-vault/inbox",
      login: {
        method: "POST",
        path: "/api/auth/akb/login",
        password_env: PASSWORD_ENV,
      },
    });
    expect(discovery.permission_checks).toEqual({
      reader_select: 200,
      reader_update: 403,
      writer_update: 200,
    });
    expect(discovery.controls.fault.kinds).toEqual([...FAULT_KINDS]);
    expect(discovery.observability).toMatchObject({
      method: "GET",
      path: "/observe",
      credential_free: true,
    });
    const serialized = JSON.stringify(discovery);
    expect(serialized).not.toContain("password-value");
    expect(serialized).not.toContain("session-token");
    expect(serialized).not.toContain("akb_jwt");
  });
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { vi } from "vitest";
import { VALID_JWT } from "./jwt";

type RouteSpanMock = {
  setAttribute: () => void;
  recordException: () => void;
  setStatus: () => void;
  end: () => void;
};

type VitestMock = {
  mockResolvedValue: (value: unknown) => void;
  mockReturnValue: (value: unknown) => void;
};

export interface OwnedVaultRouteMocks {
  readonly mockCreateAkbAdapter: VitestMock;
  readonly mockGetCurrentActor: VitestMock;
  readonly mockListVaults: VitestMock;
}

export function mockRouteTelemetry(): void {
  vi.mock("@/lib/telemetry", () => ({
    tracer: {
      startActiveSpan: vi.fn(
        async (_name: string, fn: (span: RouteSpanMock) => Promise<unknown>) =>
          fn({
            setAttribute: () => {},
            recordException: () => {},
            setStatus: () => {},
            end: () => {},
          }),
      ),
    },
  }));
}

export function mockRouteLogger(): void {
  vi.mock("@/lib/logging/logger", () => ({
    logger: { error: vi.fn(), warn: vi.fn() },
  }));
}

export function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

export function vaultRouteContext(vault = "reef-acme") {
  return { params: Promise.resolve({ vault }) };
}

export function stubOwnedVaultRoute({
  mockCreateAkbAdapter,
  mockGetCurrentActor,
  mockListVaults,
}: OwnedVaultRouteMocks): void {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  mockGetCurrentActor.mockResolvedValue({ actor: "alice" });
  mockListVaults.mockResolvedValue({
    vaults: [{ name: "reef-acme", role: "owner" }],
  });
}

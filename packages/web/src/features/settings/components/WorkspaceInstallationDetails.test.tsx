import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: mockApiFetch,
  throwHttpError: vi.fn(async (response: Response) => {
    throw new Error(`HTTP ${response.status}`);
  }),
}));

import { WorkspaceInstallationDetails } from "./WorkspaceInstallationDetails";

const installation = {
  installationId: "33333333-3333-4333-8333-333333333333",
  appId: "11111111-1111-4111-8111-111111111111",
  vaultId: "22222222-2222-4222-8222-222222222222",
  lifecycle: "active",
  blockedReason: null,
  desiredRelease: {
    id: "44444444-4444-4444-8444-444444444444",
    version: "2.0.0",
  },
  currentRelease: {
    id: "55555555-5555-4555-8555-555555555555",
    version: "1.0.0",
  },
  observed: {
    generation: 4,
    observedAt: "2026-10-02T02:00:00.000Z",
    release: { id: "55555555-5555-4555-8555-555555555555", version: "1.0.0" },
    schemaFingerprint: "observed-fingerprint",
    grantGeneration: 3,
  },
  desiredGrantGeneration: 4,
  latestGrant: { generation: 4, status: "active", capabilities: [] },
  activeGrant: { generation: 3, status: "active", capabilities: [] },
  drift: {
    release: {
      status: "mismatch",
      desired: { id: "44444444-4444-4444-8444-444444444444", version: "2.0.0" },
      observed: {
        id: "55555555-5555-4555-8555-555555555555",
        version: "1.0.0",
      },
    },
    schema: {
      status: "unknown",
      expected: "target-fingerprint",
      observed: null,
    },
    grant: { status: "mismatch", desiredGeneration: 4, observedGeneration: 3 },
    overall: "drifted",
    reasons: ["release_mismatch", "grant_mismatch"],
    unknownDimensions: ["schema"],
  },
};

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("WorkspaceInstallationDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(
      response({ installation_status: "ready", installation }),
    );
  });

  it("loads privileged details only when the owner opens the disclosure", async () => {
    render(
      <IntlTestProvider>
        <WorkspaceInstallationDetails vault="reef-current" />
      </IntlTestProvider>,
    );

    const disclosure = screen.getByTestId("installation-details-disclosure");
    expect(disclosure).not.toHaveAttribute("open");
    expect(mockApiFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Technical details"));
    fireEvent(disclosure, new Event("toggle"));

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/vaults/reef-current/installation",
      { cache: "no-store" },
    );
    const details = await screen.findByTestId("installation-details");
    expect(details).toHaveAttribute("data-overall-drift", "drifted");
    expect(screen.getByText("2.0.0")).toBeVisible();
    expect(screen.getByTestId("installation-overall-drift")).toHaveTextContent(
      "Overall drift: Drift detected",
    );
    expect(screen.getByTestId("installation-observed-at")).toHaveAttribute(
      "datetime",
      installation.observed.observedAt,
    );
    expect(
      screen.getByTestId("installation-schema-expected"),
    ).toHaveTextContent("target-fingerprint");
  });

  it("keeps an unavailable observation unknown instead of claiming healthy", async () => {
    mockApiFetch.mockResolvedValue(
      response({
        installation_status: "ready",
        installation: {
          ...installation,
          observed: null,
          drift: {
            ...installation.drift,
            overall: "unknown",
          },
        },
      }),
    );
    render(
      <IntlTestProvider>
        <WorkspaceInstallationDetails vault="reef-current" />
      </IntlTestProvider>,
    );

    const disclosure = screen.getByTestId("installation-details-disclosure");
    fireEvent.click(screen.getByText("Technical details"));
    fireEvent(disclosure, new Event("toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("installation-overall-drift")).toHaveAttribute(
        "data-drift-status",
        "unknown",
      ),
    );
    expect(
      screen.getByText(
        "Workspace remains available. The latest installation check could not confirm all details.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("installation-observed-at")).toHaveTextContent(
      "Unknown",
    );
    expect(
      screen.queryByTestId("installation-overall-drift"),
    ).not.toHaveTextContent("In sync");
  });
});

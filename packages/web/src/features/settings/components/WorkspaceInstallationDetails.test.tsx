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
    expect(
      screen.getByText(
        "Workspace remains available. The latest installation check found a difference.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByTestId("installation-release-comparison-observed"),
    ).not.toBeInTheDocument();
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

  it("shows the release value used by canonical drift separately from its snapshot", async () => {
    const desiredRelease = {
      id: "44444444-4444-4444-8444-444444444444",
      version: "0.16.1",
    };
    const observedRelease = {
      id: "55555555-5555-4555-8555-555555555555",
      version: "0.16.1",
    };
    const comparedRelease = {
      id: "66666666-6666-4666-8666-666666666666",
      version: "0.15.0",
    };
    mockApiFetch.mockResolvedValue(
      response({
        installation_status: "blocked",
        installation: {
          ...installation,
          lifecycle: "blocked",
          desiredRelease,
          currentRelease: observedRelease,
          observed: { ...installation.observed, release: observedRelease },
          drift: {
            ...installation.drift,
            release: {
              status: "mismatch",
              desired: desiredRelease,
              observed: comparedRelease,
            },
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

    expect(await screen.findByTestId("installation-details")).toHaveAttribute(
      "data-overall-drift",
      "drifted",
    );
    expect(
      screen.getByTestId("installation-release-desired"),
    ).toHaveTextContent("0.16.1");
    expect(
      screen.getByTestId("installation-release-current"),
    ).toHaveTextContent("0.16.1");
    expect(
      screen.getByTestId("installation-release-observed"),
    ).toHaveTextContent("0.16.1");
    expect(
      screen.getByTestId("installation-release-comparison-observed"),
    ).toHaveTextContent("0.15.0");
  });

  it("keeps unknown canonical release comparison unknown when the snapshot has a version", async () => {
    mockApiFetch.mockResolvedValue(
      response({
        installation_status: "ready",
        installation: {
          ...installation,
          drift: {
            ...installation.drift,
            release: {
              status: "unknown",
              desired: installation.desiredRelease,
              observed: null,
            },
            overall: "unknown",
            reasons: ["grant_mismatch"],
            unknownDimensions: ["release", "schema"],
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

    await screen.findByTestId("installation-details");
    expect(
      screen.getByTestId("installation-release-observed"),
    ).toHaveTextContent("1.0.0");
    expect(
      screen.getByTestId("installation-release-comparison-observed"),
    ).toHaveTextContent("Unknown");
    expect(
      screen
        .getByTestId("installation-comparison-release")
        .querySelector('[data-drift-status="unknown"]'),
    ).not.toBeNull();
  });

  it("shows the release ID when comparison and snapshot versions match but IDs differ", async () => {
    const snapshotRelease = {
      id: "55555555-5555-4555-8555-555555555555",
      version: "0.16.1",
    };
    const comparedRelease = {
      id: "66666666-6666-4666-8666-666666666666",
      version: "0.16.1",
    };
    mockApiFetch.mockResolvedValue(
      response({
        installation_status: "blocked",
        installation: {
          ...installation,
          lifecycle: "blocked",
          desiredRelease: {
            id: "44444444-4444-4444-8444-444444444444",
            version: "0.16.1",
          },
          currentRelease: snapshotRelease,
          observed: { ...installation.observed, release: snapshotRelease },
          drift: {
            ...installation.drift,
            release: {
              status: "mismatch",
              desired: {
                id: "44444444-4444-4444-8444-444444444444",
                version: "0.16.1",
              },
              observed: comparedRelease,
            },
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

    await screen.findByTestId("installation-details");
    expect(
      screen.getByTestId("installation-release-observed"),
    ).toHaveTextContent("0.16.1");
    expect(
      screen.getByTestId("installation-release-comparison-observed"),
    ).toHaveTextContent("0.16.1 (ID: 66666666-6666-4666-8666-666666666666)");
  });

  it("disambiguates same-version canonical comparison IDs without repeating the snapshot value", async () => {
    const desiredRelease = {
      id: "44444444-4444-4444-8444-444444444444",
      version: "0.16.1",
    };
    const observedRelease = {
      id: "55555555-5555-4555-8555-555555555555",
      version: "0.16.1",
    };
    mockApiFetch.mockResolvedValue(
      response({
        installation_status: "blocked",
        installation: {
          ...installation,
          lifecycle: "blocked",
          desiredRelease,
          currentRelease: observedRelease,
          observed: { ...installation.observed, release: observedRelease },
          drift: {
            ...installation.drift,
            release: {
              status: "mismatch",
              desired: desiredRelease,
              observed: observedRelease,
            },
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

    await screen.findByTestId("installation-details");
    expect(
      screen.getByTestId("installation-release-desired"),
    ).toHaveTextContent("0.16.1 (ID: 44444444-4444-4444-8444-444444444444)");
    expect(
      screen.getByTestId("installation-release-observed"),
    ).toHaveTextContent("0.16.1 (ID: 55555555-5555-4555-8555-555555555555)");
    expect(
      screen.queryByTestId("installation-release-comparison-observed"),
    ).not.toBeInTheDocument();
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

  it.each(["drifted", "unknown"] as const)(
    "does not claim availability for blocked installations with %s drift",
    async (overall) => {
      mockApiFetch.mockResolvedValue(
        response({
          installation_status: "blocked",
          installation: {
            ...installation,
            lifecycle: "blocked",
            blockedReason: "worker_timeout",
            drift: { ...installation.drift, overall },
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
        expect(
          screen.getByTestId("installation-overall-drift"),
        ).toHaveAttribute("data-drift-status", overall),
      );
      expect(
        screen.queryByText(/Workspace remains available/),
      ).not.toBeInTheDocument();
    },
  );

  it.each(["installing", "upgrading", "unknown"] as const)(
    "does not infer availability from active lifecycle when canonical status is %s",
    async (installationStatus) => {
      mockApiFetch.mockResolvedValue(
        response({
          installation_status: installationStatus,
          installation,
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

      await screen.findByTestId("installation-details");
      expect(
        screen.queryByText(/Workspace remains available/),
      ).not.toBeInTheDocument();
    },
  );

  it("does not claim availability when the details lookup fails", async () => {
    mockApiFetch.mockRejectedValue(new Error("offline"));
    render(
      <IntlTestProvider>
        <WorkspaceInstallationDetails vault="reef-current" />
      </IntlTestProvider>,
    );

    const disclosure = screen.getByTestId("installation-details-disclosure");
    fireEvent.click(screen.getByText("Technical details"));
    fireEvent(disclosure, new Event("toggle"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not check the workspace status.",
    );
    expect(
      screen.queryByText(/Workspace remains available/),
    ).not.toBeInTheDocument();
  });
});

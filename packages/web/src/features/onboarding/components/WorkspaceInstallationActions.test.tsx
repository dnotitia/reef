import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch, mockThrowHttpError } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockThrowHttpError: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: mockApiFetch,
  throwHttpError: mockThrowHttpError,
}));

import { WorkspaceInstallationActions } from "./WorkspaceInstallationActions";

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
  latestGrant: {
    generation: 4,
    status: "active",
    capabilities: ["installation:read"],
  },
  activeGrant: {
    generation: 3,
    status: "active",
    capabilities: ["installation:read"],
  },
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
    grant: {
      status: "mismatch",
      desiredGeneration: 4,
      observedGeneration: 3,
    },
    overall: "drifted",
    reasons: ["release_mismatch", "grant_mismatch"],
    unknownDimensions: ["schema"],
  },
};

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function renderActions(
  canManage = true,
  initialStatus: "ready" | "management_required" = "ready",
  locale: "en" | "ko" = "en",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <IntlTestProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <WorkspaceInstallationActions
          vault="reef-acme"
          initialStatus={initialStatus}
          canManage={canManage}
        />
      </QueryClientProvider>
    </IntlTestProvider>,
  );
}

describe("WorkspaceInstallationActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(
      response({ installation_status: "ready", installation }),
    );
  });

  it("keeps an active workspace usable while technical drift details start collapsed", async () => {
    renderActions();

    expect(
      await screen.findByTestId("installation-details-disclosure"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText(
        "People can continue working. The latest installation check reported a difference; ask the AKB installation operator to review it.",
      ),
    ).toBeVisible();
    expect(await screen.findByTestId("installation-details")).toHaveAttribute(
      "data-overall-drift",
      "drifted",
    );
    expect(screen.getByTestId("installation-details")).not.toBeVisible();
    expect(screen.getByText("target-fingerprint")).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByTestId("installation-details")).toBeVisible();
    expect(
      screen.getByTestId("workspace-installation-reef-acme"),
    ).toHaveAttribute("data-status", "ready");
    expect(screen.getByTestId("workspace-installation-reef-acme")).toHaveClass(
      "text-left",
    );
    expect(
      screen.queryByTestId("installation-drift-warning"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/not a live check/i)).not.toBeInTheDocument();
    expect(screen.getByText("2.0.0")).toBeInTheDocument();
    expect(screen.getByText("target-fingerprint")).toBeInTheDocument();
    expect(screen.getByTestId("installation-comparison-release")).toBeVisible();
    expect(screen.getByTestId("installation-comparison-schema")).toBeVisible();
    expect(screen.getByTestId("installation-comparison-grant")).toBeVisible();
    expect(screen.getByText("Installation snapshot fingerprint")).toBeVisible();
    expect(screen.getByTestId("installation-observed-at")).toHaveAttribute(
      "datetime",
      installation.observed.observedAt,
    );
    expect(screen.queryByText(/could not confirm these areas/i)).toBeNull();
    expect(screen.getByTestId("installation-check-status-note")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Check status" }),
    ).toBeInTheDocument();
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/vaults/reef-acme/installation",
      { cache: "no-store" },
    );
  });

  it("renders a shared schema value once and preserves a distinct observed fingerprint", async () => {
    const matchingSchemaInstallation = {
      ...installation,
      drift: {
        ...installation.drift,
        schema: {
          ...installation.drift.schema,
          observed: "observed-fingerprint",
        },
      },
    };
    mockApiFetch.mockResolvedValue(
      response({
        installation_status: "ready",
        installation: matchingSchemaInstallation,
      }),
    );
    renderActions();

    const details = await screen.findByTestId("installation-details");
    fireEvent.click(screen.getByText("Technical details"));

    expect(
      screen.getByText("observed-fingerprint", { exact: true }),
    ).toBeVisible();
    expect(
      screen.getAllByText("observed-fingerprint", { exact: true }),
    ).toHaveLength(1);
    expect(
      details.querySelector(
        '[data-testid="installation-snapshot-fingerprint"]',
      ),
    ).toBeNull();
  });

  it("structures blocked recovery by owner and action without repeating the recheck note", async () => {
    mockApiFetch.mockResolvedValue(
      response({
        installation_status: "blocked",
        installation: {
          ...installation,
          lifecycle: "blocked",
          blockedReason: "worker_timeout",
        },
      }),
    );
    renderActions();

    await screen.findByTestId("installation-details");
    fireEvent.click(screen.getByText("Technical details"));

    const recovery = screen.getByTestId("installation-blocked-guidance");
    expect(
      within(recovery).getByRole("heading", {
        name: "Installation operator",
      }),
    ).toBeVisible();
    expect(within(recovery).getAllByRole("listitem")).toHaveLength(4);
    expect(recovery).toHaveTextContent(/Transition Plan preflight/);
    expect(recovery).toHaveTextContent(/same immutable release/);
    expect(recovery).toHaveTextContent(/new immutable release/);
    expect(recovery).toHaveTextContent(
      /does not confirm that recovery is complete/,
    );
    expect(
      screen.getAllByText(/Checking status refreshes this information only/i),
    ).toHaveLength(1);
    expect(recovery).not.toHaveTextContent(/Checking status refreshes/i);
  });

  it("shows the same ready-with-drift guidance in Korean", async () => {
    renderActions(true, "ready", "ko");

    expect(
      await screen.findByText(
        "사용자는 계속 작업할 수 있습니다. 최근 설치 확인에서 차이가 발견되었습니다. AKB 설치 운영자에게 확인을 요청하세요.",
      ),
    ).toBeVisible();
    expect(
      screen.getByTestId("installation-details-disclosure"),
    ).not.toHaveAttribute("open");
    expect(screen.getByTestId("installation-details")).not.toBeVisible();
    expect(screen.getByText("사용 준비 완료")).toBeVisible();
  });

  it("keeps an unconfirmed state generic and gives the owner a read-only next step", async () => {
    mockApiFetch.mockResolvedValue(
      response({ installation_status: "unknown" }),
    );
    renderActions();

    expect(
      await screen.findByText(
        "The setup status couldn't be confirmed. An owner or admin can check again shortly.",
      ),
    ).toBeVisible();
    expect(
      screen.getByTestId("workspace-installation-reef-acme"),
    ).toHaveAttribute("data-status", "unknown");
    expect(screen.getByTestId("installation-check-status-note")).toBeVisible();
    expect(
      screen.queryByTestId("installation-details-disclosure"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/deployment target|AKB/)).not.toBeInTheDocument();
  });

  it("drops cached manager details when the role changes to a member", async () => {
    const view = renderActions();
    await screen.findByTestId("installation-details");

    view.rerender(
      <IntlTestProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <WorkspaceInstallationActions
            vault="reef-acme"
            initialStatus="management_required"
            canManage={false}
          />
        </QueryClientProvider>
      </IntlTestProvider>,
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("installation-details"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("workspace-installation-reef-acme"),
    ).toHaveAttribute("data-status", "ready");
  });
});

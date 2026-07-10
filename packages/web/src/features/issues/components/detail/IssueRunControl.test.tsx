import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { apiFetch } from "@/lib/apiClient";
import type { IssueRunRequestEligibility } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueRunAvailabilityNotice, IssueRunControl } from "./IssueRunControl";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockApiFetch = vi.mocked(apiFetch);

const option = {
  github_id: 123,
  repo: "dnotitia/reef",
  recipe_path: ".agents/recipe.md",
  branch_template: "feat/{issue_id}-{run_id}",
  runner_profile: { id: "default", label: "Default runner" },
  permission_profile: { id: ":workspace", label: "Workspace access" },
};

const eligible: IssueRunRequestEligibility = {
  eligible: true,
  reasons: [],
  target_options: [option],
  default_target_github_id: 123,
  active_run: null,
};

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <IntlTestProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </IntlTestProvider>
  );
}

function renderControl(
  value: IssueRunRequestEligibility | undefined,
  options: { isPending?: boolean; isError?: boolean } = {},
) {
  return render(
    <>
      <IssueRunControl
        issueId="REEF-382"
        vault="reef-acme"
        eligibility={value}
        isPending={options.isPending ?? false}
        isError={options.isError ?? false}
        noticeId="run-notice"
      />
      <IssueRunAvailabilityNotice
        eligibility={value}
        isError={options.isError ?? false}
        noticeId="run-notice"
      />
    </>,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IssueRunControl", () => {
  it("keeps a fixed-width loading skeleton", () => {
    const { container } = renderControl(undefined, { isPending: true });
    expect(container.querySelector(".w-32")).not.toBeNull();
  });

  it("keeps a disabled reason visible and linked with aria-describedby", () => {
    renderControl({
      ...eligible,
      eligible: false,
      reasons: ["issue_status_not_todo"],
      default_target_github_id: 123,
    });
    const button = screen.getByTestId("issue-run-trigger");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-describedby", "run-notice");
    expect(
      screen.getByTestId("issue-run-unavailable-reason"),
    ).toHaveTextContent("Move the issue to Todo first");
  });

  it("shows a read-only single target and queues the request", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValueOnce(
      Response.json(
        { run_id: "run-request", status: "queued", created: true },
        { status: 202 },
      ),
    );
    renderControl(eligible);
    await user.click(screen.getByTestId("issue-run-trigger"));
    expect(await screen.findByText("Request agent run")).toBeInTheDocument();
    expect(screen.getByTestId("issue-run-single-target")).toHaveTextContent(
      "dnotitia/reef",
    );
    await user.click(screen.getByTestId("request-issue-run"));
    await waitFor(() =>
      expect(screen.queryByText("Request agent run")).not.toBeInTheDocument(),
    );
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-382/runs",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requires an explicit repository selection when multiple targets exist", async () => {
    const user = userEvent.setup();
    renderControl({
      ...eligible,
      target_options: [
        option,
        { ...option, github_id: 456, repo: "dnotitia/akb" },
      ],
      default_target_github_id: null,
    });
    await user.click(screen.getByTestId("issue-run-trigger"));
    expect(screen.getByTestId("request-issue-run")).toBeDisabled();
    await user.click(screen.getByTestId("issue-run-target-select"));
    await user.click(await screen.findByText("dnotitia/akb"));
    expect(screen.getByTestId("request-issue-run")).toBeEnabled();
  });

  it("absorbs a 409 as the existing queued run", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValueOnce(
      Response.json(
        { code: "run_already_active", run_id: "run-existing" },
        { status: 409 },
      ),
    );
    renderControl(eligible);
    await user.click(screen.getByTestId("issue-run-trigger"));
    await user.click(screen.getByTestId("request-issue-run"));
    await waitFor(() =>
      expect(screen.queryByText("Request agent run")).not.toBeInTheDocument(),
    );
  });
});

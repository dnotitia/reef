// fake-indexeddb/auto — the form sets the new vault active via Dexie.
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { getActiveVault } from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function setupMockApi(
  postBody: unknown = {
    name: "reef-new",
    config: { project_prefix: "REEF", monitored_repos: [] },
  },
) {
  mockApiFetch.mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.startsWith("/api/vaults") && init?.method === "POST") {
      return new Response(JSON.stringify(postBody), { status: 200 });
    }
    if (u.startsWith("/api/vaults")) {
      return new Response(JSON.stringify({ vaults: [] }), { status: 200 });
    }
    if (u.startsWith("/api/repos")) {
      return new Response(JSON.stringify({ repos: [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

function postVaultCall() {
  return mockApiFetch.mock.calls.find(
    ([url, init]) => String(url) === "/api/vaults" && init?.method === "POST",
  );
}

describe("CreateWorkspaceForm", () => {
  // Radix Select drives its popover with pointer-capture + scrollIntoView APIs
  // jsdom doesn't implement; stub them so the language picker can open.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPush.mockReset();
    window.localStorage.clear();
    await db.config.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("uses the given idPrefix for its field test ids", () => {
    setupMockApi();
    render(wrap(<CreateWorkspaceForm idPrefix="greenfield" />));
    expect(screen.getByTestId("greenfield-vault-name-input")).toBeVisible();
    expect(screen.getByTestId("greenfield-project-prefix-input")).toHaveValue(
      "REEF",
    );
  });

  it("creates the vault, sets it active, navigates to /issues, and fires onCreated (AC4)", async () => {
    setupMockApi();
    const onCreated = vi.fn();
    const user = userEvent.setup();

    render(
      wrap(
        <CreateWorkspaceForm
          idPrefix="create-workspace"
          onCreated={onCreated}
        />,
      ),
    );

    await user.type(
      screen.getByTestId("create-workspace-vault-name-input"),
      "reef-new",
    );
    await user.click(screen.getByTestId("create-workspace-create-btn"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/issues"));
    expect(await getActiveVault()).toBe("reef-new");
    expect(onCreated).toHaveBeenCalledWith("reef-new");

    const call = postVaultCall();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      name: "reef-new",
      project_prefix: "REEF",
      monitored_repos: [],
    });
  });

  it("renders a Cancel button only when onCancel is provided", async () => {
    setupMockApi();
    const onCancel = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      wrap(<CreateWorkspaceForm idPrefix="create-workspace" />),
    );
    expect(
      screen.queryByTestId("create-workspace-cancel-btn"),
    ).not.toBeInTheDocument();

    rerender(
      wrap(
        <CreateWorkspaceForm idPrefix="create-workspace" onCancel={onCancel} />,
      ),
    );
    await user.click(screen.getByTestId("create-workspace-cancel-btn"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("surfaces an invalid-name validation error without posting", async () => {
    setupMockApi();
    const user = userEvent.setup();

    render(wrap(<CreateWorkspaceForm idPrefix="create-workspace" />));

    // Uppercase is normalized to lowercase on input, so force an invalid value
    // through a character the name pattern rejects.
    await user.type(
      screen.getByTestId("create-workspace-vault-name-input"),
      "reef_bad",
    );
    await user.click(screen.getByTestId("create-workspace-create-btn"));

    expect(
      await screen.findByTestId("create-workspace-create-error"),
    ).toBeInTheDocument();
    expect(postVaultCall()).toBeUndefined();
  });

  it("renders the authoring-language picker unset by default, between description and repos (REEF-160 / AC2,3)", () => {
    setupMockApi();
    render(wrap(<CreateWorkspaceForm idPrefix="create-workspace" />));

    const trigger = screen.getByTestId(
      "create-workspace-authoring-language-select",
    );
    expect(trigger).toHaveTextContent(/not set/i);

    // One row between Description and Monitored repositories. The fixed-width
    // control reads identically in the wide onboarding page and the dialog.
    const description = screen.getByTestId(
      "create-workspace-description-input",
    );
    const reposLabel = screen.getByText(/monitored repositories/i);
    expect(
      description.compareDocumentPosition(trigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      trigger.compareDocumentPosition(reposLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("includes a selected authoring language in the POST body (REEF-160 / AC1)", async () => {
    setupMockApi();
    const user = userEvent.setup();

    render(wrap(<CreateWorkspaceForm idPrefix="create-workspace" />));

    await user.type(
      screen.getByTestId("create-workspace-vault-name-input"),
      "reef-new",
    );
    await user.click(
      screen.getByTestId("create-workspace-authoring-language-select"),
    );
    await user.click(await screen.findByRole("option", { name: "한국어" }));
    await user.click(screen.getByTestId("create-workspace-create-btn"));

    await waitFor(() => expect(postVaultCall()).toBeDefined());
    // Unset omits the key entirely (the "creates the vault…" test above proves
    // that shape); a chosen language rides along as its stable code.
    expect(JSON.parse(String(postVaultCall()?.[1]?.body))).toEqual({
      name: "reef-new",
      project_prefix: "REEF",
      authoring_language: "ko",
      monitored_repos: [],
    });
  });
});

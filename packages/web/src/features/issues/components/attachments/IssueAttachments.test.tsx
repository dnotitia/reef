// @vitest-environment jsdom
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { issueAttachmentsKey } from "@/features/issues/hooks/queries/useIssueAttachments";
import { IssueAttachments } from "./IssueAttachments";

const mockApiFetch = vi.mocked(apiFetch);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderWithProviders(
  children: ReactNode,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  const result = render(
    <IntlTestProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </IntlTestProvider>,
  );
  return { ...result, queryClient };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IssueAttachments", () => {
  it("announces an empty cold read without rendering a layout section", async () => {
    const response = deferred<Response>();
    mockApiFetch.mockReturnValue(response.promise);

    const { container } = renderWithProviders(
      <IssueAttachments issueId="REEF-001" vault="v" />,
    );

    expect(
      screen.queryByRole("heading", { name: "Attachments" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading attachments");
    expect(container.querySelector("section")).not.toBeInTheDocument();

    response.resolve(json({ attachments: [] }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps known files visible while a warm query is revalidating", async () => {
    const response = deferred<Response>();
    mockApiFetch.mockReturnValue(response.promise);
    const files = [
      {
        id: "file-1",
        reef_id: "REEF-001",
        file_uri: "akb://reef-test/issues/file/file-1",
        filename: "notes.pdf",
        mime_type: "application/pdf",
        size_bytes: 2048,
        author: "alice",
        created_at: "2026-07-09T01:00:00.000Z",
        source: "comment",
        inline: false,
        original_jira_attachment_id: null,
        meta: null,
      },
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(issueAttachmentsKey("v", "REEF-001"), files);

    renderWithProviders(
      <IssueAttachments issueId="REEF-001" vault="v" />,
      queryClient,
    );

    expect(screen.getByText("notes.pdf")).toBeInTheDocument();
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    response.resolve(json({ attachments: files }));
  });

  it("shows a retryable error and recovers after a failed read", async () => {
    mockApiFetch
      .mockResolvedValueOnce(json({ message: "Unavailable" }, 503))
      .mockResolvedValueOnce(
        json({
          attachments: [
            {
              id: "file-1",
              reef_id: "REEF-001",
              file_uri: "akb://reef-test/issues/file/file-1",
              filename: "notes.pdf",
              mime_type: "application/pdf",
              size_bytes: 2048,
              author: "alice",
              created_at: "2026-07-09T01:00:00.000Z",
              source: "comment",
              inline: false,
              original_jira_attachment_id: null,
              meta: null,
            },
          ],
        }),
      );
    const user = userEvent.setup();

    renderWithProviders(<IssueAttachments issueId="REEF-001" vault="v" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "load attachments",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("notes.pdf")).toBeInTheDocument();
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("hides inline images while showing downloadable attachments", async () => {
    mockApiFetch.mockResolvedValue(
      json({
        attachments: [
          {
            id: "image-1",
            reef_id: "REEF-001",
            file_uri: "akb://reef-test/issues/file/image-1",
            filename: "screen.png",
            mime_type: "image/png",
            size_bytes: 4,
            author: "alice",
            created_at: "2026-07-09T01:00:00.000Z",
            source: "issue_body",
            inline: true,
            original_jira_attachment_id: null,
            meta: null,
          },
          {
            id: "file-1",
            reef_id: "REEF-001",
            file_uri: "akb://reef-test/issues/file/file-1",
            filename: "notes.pdf",
            mime_type: "application/pdf",
            size_bytes: 2048,
            author: "alice",
            created_at: "2026-07-09T01:00:00.000Z",
            source: "comment",
            inline: false,
            original_jira_attachment_id: null,
            meta: null,
          },
        ],
      }),
    );

    renderWithProviders(<IssueAttachments issueId="REEF-001" vault="v" />);

    expect(await screen.findByText("notes.pdf")).toBeInTheDocument();
    expect(screen.queryByText("screen.png")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Download" });
    expect(link).toHaveAttribute(
      "href",
      "/api/issues/REEF-001/attachments/file-1?vault=v",
    );
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-001/attachments?vault=v",
    );
  });

  it("shows non-inline images as downloadable attachments", async () => {
    mockApiFetch.mockResolvedValue(
      json({
        attachments: [
          {
            id: "image-1",
            reef_id: "REEF-001",
            file_uri: "akb://reef-test/issues/file/image-1",
            filename: "diagram.png",
            mime_type: "image/png",
            size_bytes: 4096,
            author: "alice",
            created_at: "2026-07-09T01:00:00.000Z",
            source: "comment",
            inline: false,
            original_jira_attachment_id: null,
            meta: null,
          },
        ],
      }),
    );

    renderWithProviders(<IssueAttachments issueId="REEF-001" vault="v" />);

    expect(await screen.findByText("diagram.png")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Download" });
    expect(link).toHaveAttribute(
      "href",
      "/api/issues/REEF-001/attachments/image-1?vault=v",
    );
  });

  it("renders nothing after loading when only inline images exist", async () => {
    mockApiFetch.mockResolvedValue(
      json({
        attachments: [
          {
            id: "image-1",
            reef_id: "REEF-001",
            file_uri: "akb://reef-test/issues/file/image-1",
            filename: "screen.png",
            mime_type: "image/png",
            size_bytes: 4,
            author: "alice",
            created_at: "2026-07-09T01:00:00.000Z",
            source: "issue_body",
            inline: true,
            original_jira_attachment_id: null,
            meta: null,
          },
        ],
      }),
    );

    const { container } = renderWithProviders(
      <IssueAttachments issueId="REEF-001" vault="v" />,
    );

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

import { mockIssueDetail } from "@/__stories__/fixtures";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { IssueDetail } from "./IssueDetail";

// MSW handlers for GET /api/issues/[id] and PATCH /api/issues/[id]

const successHandlers = [
  http.get("/api/issues/*", () => {
    return HttpResponse.json(mockIssueDetail);
  }),
  http.patch("/api/issues/*", () => {
    return HttpResponse.json(mockIssueDetail);
  }),
];

const errorHandlers = [
  http.get("/api/issues/*", () => {
    return HttpResponse.json(
      { error: "Failed to load issue" },
      { status: 500 },
    );
  }),
];

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <div className="w-[480px] p-0">{children}</div>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof IssueDetail> = {
  title: "Features/Issues/IssueDetail",
  component: IssueDetail,
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof IssueDetail>;

export const Default: Story = {
  args: {
    issueId: mockIssueDetail.issue.id,
    vault: "reef-acme",
    onClose: () => {
      console.log("onClose called");
    },
  },
  parameters: {
    msw: { handlers: successHandlers },
  },
};

export const Loading: Story = {
  args: {
    issueId: mockIssueDetail.issue.id,
    vault: "reef-acme",
    onClose: () => {},
  },
  parameters: {
    msw: {
      handlers: [
        http.get("/api/issues/*", async () => {
          // does not resolves — keep loading state
          await new Promise(() => {});
        }),
      ],
    },
  },
};

export const ErrorState: Story = {
  args: {
    issueId: "REEF-999",
    vault: "reef-acme",
    onClose: () => {},
  },
  parameters: {
    msw: { handlers: errorHandlers },
  },
};

export const EditMode: Story = {
  args: {
    issueId: mockIssueDetail.issue.id,
    vault: "reef-acme",
    onClose: () => {},
  },
  parameters: {
    msw: { handlers: successHandlers },
    docs: {
      description: {
        story: "Issue loaded and ready for editing — all fields are editable.",
      },
    },
  },
};

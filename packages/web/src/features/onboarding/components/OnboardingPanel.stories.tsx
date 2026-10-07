import type { Meta, StoryObj } from "@storybook/react";
import { http, HttpResponse } from "msw";
import { DEFAULT_CONFIG } from "@reef/core";
import { OnboardingPanel } from "./OnboardingPanel";

function handlers({
  repos = [],
  createStatus = 200,
}: {
  repos?: ReadonlyArray<{ full_name: string; id: number }>;
  createStatus?: number;
} = {}) {
  return [
    http.get("/api/repos", () => HttpResponse.json({ repos })),
    http.post("/api/vaults", async () => {
      if (createStatus !== 200) {
        return HttpResponse.json(
          { error: "A workspace with that name is already configured." },
          { status: createStatus },
        );
      }
      return HttpResponse.json({
        vault_id: "33333333-3333-4333-8333-333333333333",
        name: "reef-new",
        config: DEFAULT_CONFIG,
      });
    }),
    http.post("/api/vaults/:vault/installation", () =>
      HttpResponse.json(
        {
          installation_active: true,
          command_status: "accepted",
          replayed: false,
        },
        { status: 202 },
      ),
    ),
    http.patch("/api/config", async ({ request }) => {
      const body = (await request.json()) as { patch: unknown };
      return HttpResponse.json({ config: body.patch });
    }),
  ];
}

const meta: Meta<typeof OnboardingPanel> = {
  title: "Features/Onboarding/OnboardingPanel",
  component: OnboardingPanel,
  args: {
    resumeState: { status: "empty", retry: () => {} },
  },
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof OnboardingPanel>;

export const Loading: Story = {
  args: {
    resumeState: { status: "pending", retry: () => {} },
  },
};

export const GreenfieldDefault: Story = {
  parameters: {
    msw: { handlers: handlers() },
  },
};

export const WithRepos: Story = {
  parameters: {
    msw: {
      handlers: handlers({
        repos: [
          { full_name: "octo/cat", id: 1 },
          { full_name: "octo/dog", id: 2 },
          { full_name: "reef/web", id: 3 },
        ],
      }),
    },
  },
};

export const NoGitHubToken: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/repos", () =>
          HttpResponse.json(
            { error: "Authentication required." },
            { status: 401 },
          ),
        ),
        http.post("/api/vaults", () =>
          HttpResponse.json({
            vault_id: "33333333-3333-4333-8333-333333333333",
            name: "reef-new",
            config: DEFAULT_CONFIG,
          }),
        ),
        http.post("/api/vaults/:vault/installation", () =>
          HttpResponse.json(
            {
              installation_active: true,
              command_status: "accepted",
              replayed: false,
            },
            { status: 202 },
          ),
        ),
        http.patch("/api/config", async ({ request }) => {
          const body = (await request.json()) as { patch: unknown };
          return HttpResponse.json({ config: body.patch });
        }),
      ],
    },
  },
};

export const CreateError: Story = {
  parameters: {
    msw: { handlers: handlers({ createStatus: 409 }) },
  },
};

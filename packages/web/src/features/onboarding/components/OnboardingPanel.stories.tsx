import type { Meta, StoryObj } from "@storybook/react";
import { http, HttpResponse } from "msw";
import { OnboardingPanel } from "./OnboardingPanel";

function vaultPayload(
  entries: ReadonlyArray<{ name: string; has_reef_config: boolean }>,
) {
  return {
    vaults: entries.map((e) => ({
      name: e.name,
      description: null,
      status: "active",
      role: "owner" as const,
      created_at: null,
      has_reef_config: e.has_reef_config,
    })),
  };
}

function handlers({
  vaults = [],
  repos = [],
  createStatus = 200,
}: {
  vaults?: ReadonlyArray<{ name: string; has_reef_config: boolean }>;
  repos?: ReadonlyArray<{ full_name: string; id: number }>;
  createStatus?: number;
} = {}) {
  return [
    http.get("/api/vaults", () => HttpResponse.json(vaultPayload(vaults))),
    http.get("/api/repos", () => HttpResponse.json({ repos })),
    http.post("/api/vaults", async () => {
      if (createStatus !== 200) {
        return HttpResponse.json(
          { error: "A workspace with that name is already configured." },
          { status: createStatus },
        );
      }
      return HttpResponse.json({
        name: "reef-new",
        config: { project_prefix: "REEF", monitored_repos: [] },
      });
    }),
  ];
}

const meta: Meta<typeof OnboardingPanel> = {
  title: "Features/Onboarding/OnboardingPanel",
  component: OnboardingPanel,
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof OnboardingPanel>;

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/vaults", async () => {
          await new Promise(() => {});
          return HttpResponse.json(vaultPayload([]));
        }),
        http.get("/api/repos", async () => {
          await new Promise(() => {});
          return HttpResponse.json({ repos: [] });
        }),
      ],
    },
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

export const ExistingWorkspaces: Story = {
  parameters: {
    msw: {
      handlers: handlers({
        vaults: [
          { name: "reef-acme", has_reef_config: true },
          { name: "reef-zen", has_reef_config: true },
          { name: "raw-personal", has_reef_config: false },
        ],
      }),
    },
  },
};

export const NoGitHubToken: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/vaults", () => HttpResponse.json(vaultPayload([]))),
        http.get("/api/repos", () =>
          HttpResponse.json(
            { error: "Authentication required." },
            { status: 401 },
          ),
        ),
        http.post("/api/vaults", () =>
          HttpResponse.json({
            name: "reef-new",
            config: { project_prefix: "REEF", monitored_repos: [] },
          }),
        ),
      ],
    },
  },
};

export const CreateError: Story = {
  parameters: {
    msw: { handlers: handlers({ createStatus: 409 }) },
  },
};

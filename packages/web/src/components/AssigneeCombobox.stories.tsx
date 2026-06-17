/**
 * Storybook stories for AssigneeCombobox.
 *
 * MSW handlers mock GET /api/vault-members responses.
 * Run: pnpm --filter @reef/web storybook
 */
import { mockCollaborators } from "@/__stories__/fixtures";
import type { Meta, StoryObj } from "@storybook/react";
import { http, HttpResponse } from "msw";
import { AssigneeCombobox } from "./AssigneeCombobox";

const meta = {
  title: "Components/AssigneeCombobox",
  component: AssigneeCombobox,
  parameters: {
    layout: "centered",
  },
  args: {
    value: "",
    onChange: () => {},
    vault: "reef-acme",
  },
} satisfies Meta<typeof AssigneeCombobox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No value set, empty initial state — loads members on open */
export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/vault-members", () =>
          HttpResponse.json({ users: mockCollaborators }),
        ),
      ],
    },
  },
  args: { value: "", vault: "reef-acme" },
};

/** Combobox with a pre-selected user */
export const WithValue: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/vault-members", () =>
          HttpResponse.json({ users: mockCollaborators }),
        ),
      ],
    },
  },
  args: { value: "alice", vault: "reef-acme" },
};

/** Loading state — MSW handler delays response */
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/vault-members", async () => {
          await new Promise(() => {});
          return HttpResponse.json({ users: [] });
        }),
      ],
    },
  },
  args: { value: "", vault: "reef-acme" },
};

/** Open popover with results (open the combobox to see the list) */
export const WithResults: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/vault-members", () =>
          HttpResponse.json({ users: mockCollaborators }),
        ),
      ],
    },
  },
  args: { value: "", vault: "reef-acme" },
};

/** Error fallback — MSW returns 500, falls back to plain Input */
export const ErrorFallback: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/vault-members", () =>
          HttpResponse.json(
            { error: "Internal server error" },
            { status: 500 },
          ),
        ),
      ],
    },
  },
  args: { value: "", vault: "reef-acme" },
};

/** No vault configured — renders plain Input immediately */
export const NoVault: Story = {
  parameters: {
    msw: {
      handlers: [],
    },
  },
  args: { value: "", vault: "" },
};

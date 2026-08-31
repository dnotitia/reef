import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, navigationState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  navigationState: { searchParams: new URLSearchParams("q=auth") },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "reef-acme", isLoading: false }),
}));

import { ScopeSwitcher } from "./ScopeSwitcher";

describe("ScopeSwitcher", () => {
  beforeEach(() => {
    mockPush.mockClear();
    navigationState.searchParams = new URLSearchParams("view=timeline&q=auth");
  });

  it("exposes independent scope semantics and keeps Backlog labels visible", () => {
    render(
      <IntlTestProvider>
        <ScopeSwitcher activeScope="active" activeLayout="timeline" />
      </IntlTestProvider>,
    );
    const group = screen.getByTestId("scope-switcher");
    expect(group).toHaveAttribute("role", "group");
    expect(screen.getByTestId("scope-switcher-active")).toHaveTextContent(
      "Active",
    );
    expect(screen.getByTestId("scope-switcher-backlog")).toHaveTextContent(
      "Backlog",
    );
    expect(screen.getByTestId("scope-switcher-active")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("scope-switcher-backlog")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("normalizes Timeline to List when entering Backlog", async () => {
    const user = userEvent.setup();
    render(
      <IntlTestProvider>
        <ScopeSwitcher activeScope="active" activeLayout="timeline" />
      </IntlTestProvider>,
    );
    await user.click(screen.getByTestId("scope-switcher-backlog"));
    const [href] = mockPush.mock.calls[0] ?? [];
    const params = new URLSearchParams(String(href).split("?")[1]);
    expect(params.get("scope")).toBe("backlog");
    expect(params.get("view")).toBe("list");
    expect(params.get("q")).toBe("auth");
  });
});

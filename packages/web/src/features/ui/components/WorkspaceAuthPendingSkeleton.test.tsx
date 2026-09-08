import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAuthPendingSkeleton } from "./WorkspaceAuthPendingSkeleton";

vi.mock("@/features/issues/hooks/view/useIssueDrill", () => ({
  useIssueDrill: () => () => ({}),
}));

afterEach(cleanup);

function renderPending(pathname: string) {
  return render(
    <IntlTestProvider>
      <WorkspaceAuthPendingSkeleton pathname={pathname} />
    </IntlTestProvider>,
  );
}

describe("WorkspaceAuthPendingSkeleton", () => {
  it("keeps the Issues page chrome while auth is pending", () => {
    renderPending("/workspace/reef-e2e/issues");
    const main = within(screen.getByTestId("app-shell-skeleton-main"));

    expect(main.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
    expect(
      main.getByRole("group", { name: "Issue scope" }),
    ).toBeInTheDocument();
    expect(main.getByRole("group", { name: "Issue view" })).toBeInTheDocument();
    expect(main.getByText("Status")).toBeInTheDocument();
    expect(screen.getByTestId("app-shell-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("keeps issue detail field and section labels without data controls", () => {
    renderPending("/workspace/reef-e2e/issues/REEF-001");
    const main = within(screen.getByTestId("app-shell-skeleton-main"));
    const dialog = within(main.getByRole("dialog", { name: "REEF-001" }));

    for (const label of [
      "Title",
      "Description",
      "Details",
      "People",
      "Planning",
      "Relationships",
      "Activity",
    ]) {
      expect(dialog.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(main.queryAllByRole("button")).toHaveLength(0);
    expect(main.queryAllByRole("link")).toHaveLength(0);
    expect(main.getByTestId("issue-detail-modal")).toHaveAttribute(
      "role",
      "dialog",
    );
    expect(main.getByTestId("issue-detail-modal")).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(main.getByTestId("issue-detail-modal")).toHaveAttribute(
      "aria-label",
      "REEF-001",
    );
    expect(main.getByTestId("issue-detail-modal")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(main.getByTestId("issues-skeleton").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("keeps Settings tabs and section labels without loading values", () => {
    renderPending("/workspace/reef-e2e/settings/workspace");
    const main = within(screen.getByTestId("app-shell-skeleton-main"));

    expect(main.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(
      main.getByRole("navigation", { name: "Settings sections" }),
    ).toBeInTheDocument();
    for (const label of [
      "Workspace",
      "Preferences",
      "Deployment",
      "Active Workspace",
      "General",
      "Monitored Repositories",
    ]) {
      expect(main.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(main.queryAllByRole("button")).toHaveLength(0);
    expect(main.queryAllByRole("link")).toHaveLength(0);
  });

  it.each([
    ["planning", "/workspace/reef-e2e/planning", "Planning", "Sprints"],
    ["my work", "/workspace/reef-e2e/my-work", "My Work", "Open work by stage"],
    ["reports", "/workspace/reef-e2e/reports", "Reports", "Snapshot"],
  ])(
    "keeps %s fixed labels while auth is pending",
    (_name, pathname, title, label) => {
      renderPending(pathname);
      const main = within(screen.getByTestId("app-shell-skeleton-main"));

      expect(main.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(main.getByText(label)).toBeInTheDocument();
    },
  );

  it("keeps the Inbox surface while auth is pending", () => {
    renderPending("/workspace/reef-e2e/inbox");
    const main = within(screen.getByTestId("app-shell-skeleton-main"));

    expect(main.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(main.getByTestId("notification-inbox-loading")).toBeInTheDocument();
    expect(main.queryByTestId("board-columns-skeleton")).toBeNull();
    expect(screen.getByTestId("sidebar-nav-inbox")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not claim an unsupported nested Settings route", () => {
    renderPending("/workspace/reef-e2e/settings/unknown");
    const main = within(screen.getByTestId("app-shell-skeleton-main"));

    expect(main.queryByRole("heading", { name: "Settings" })).toBeNull();
    expect(main.getByTestId("board-columns-skeleton")).toBeInTheDocument();
  });

  it("resolves routes after a route-like workspace slug", () => {
    renderPending("/workspace/issues/reports");
    const main = within(screen.getByTestId("app-shell-skeleton-main"));

    expect(main.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-reports")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("sidebar-nav-issues")).not.toHaveAttribute(
      "aria-current",
    );
  });
});

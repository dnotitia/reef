import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueChromeActions } from "./IssueChromeActions";
import { IssueChromeSlotProvider } from "./IssueChromeSlot";

afterEach(cleanup);

type ActionsProps = Parameters<typeof IssueChromeActions>[0];

function makeProps(overrides: Partial<ActionsProps> = {}): ActionsProps {
  return {
    updatedAt: null,
    saveStatus: "idle",
    onRetryLastCommit: vi.fn(),
    isArchived: false,
    isArchivePending: false,
    isDeletePending: false,
    onArchiveToggle: vi.fn(),
    onDeleteRequested: vi.fn(),
    ...overrides,
  };
}

describe("IssueChromeActions", () => {
  it("renders the ⋮ issue-actions menu in-flow when no chrome slot is in scope", () => {
    // A standalone render (no sheet / no provider) must still show the actions —
    // it falls back to rendering in-flow rather than portaling.
    render(<IssueChromeActions {...makeProps()} />);
    expect(
      screen.getByRole("button", { name: "Issue actions" }),
    ).toBeInTheDocument();
    // Close is the sheet's own affordance, never rendered by the actions cluster.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("shows the last-edited time while idle", () => {
    render(
      <IssueChromeActions
        {...makeProps({ updatedAt: "2026-04-01T00:00:00.000Z" })}
      />,
    );
    expect(screen.getByTestId("issue-updated-at")).toHaveTextContent("Edited");
  });

  it("covers the static time with the live save status while a write is in flight", () => {
    render(
      <IssueChromeActions
        {...makeProps({
          saveStatus: "saving",
          updatedAt: "2026-04-01T00:00:00.000Z",
        })}
      />,
    );
    expect(screen.getByTestId("issue-save-status")).toHaveTextContent("Saving");
    // The static "Edited …" time is suppressed so the two never compete.
    expect(screen.queryByTestId("issue-updated-at")).toBeNull();
  });

  it("surfaces a retry on save failure that calls back to the autosave machine", async () => {
    const user = userEvent.setup();
    const onRetryLastCommit = vi.fn();
    render(
      <IssueChromeActions
        {...makeProps({ saveStatus: "error", onRetryLastCommit })}
      />,
    );
    expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
      "Not saved",
    );
    await user.click(screen.getByTestId("issue-save-retry"));
    expect(onRetryLastCommit).toHaveBeenCalledTimes(1);
  });

  it("invokes archive and delete from the menu", async () => {
    const user = userEvent.setup();
    const onArchiveToggle = vi.fn();
    const onDeleteRequested = vi.fn();
    render(
      <IssueChromeActions
        {...makeProps({ onArchiveToggle, onDeleteRequested })}
      />,
    );

    await user.click(screen.getByTestId("issue-more-trigger"));
    await user.click(await screen.findByTestId("issue-archive-toggle"));
    expect(onArchiveToggle).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("issue-more-trigger"));
    await user.click(await screen.findByTestId("issue-delete-trigger"));
    expect(onDeleteRequested).toHaveBeenCalledTimes(1);
  });

  it("offers Unarchive when the issue is archived", async () => {
    const user = userEvent.setup();
    render(<IssueChromeActions {...makeProps({ isArchived: true })} />);
    await user.click(screen.getByTestId("issue-more-trigger"));
    expect(await screen.findByText("Unarchive")).toBeInTheDocument();
  });

  it("portals its content into the chrome slot when one is provided (REEF-286)", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    render(
      <IssueChromeSlotProvider value={slot}>
        <IssueChromeActions {...makeProps()} />
      </IssueChromeSlotProvider>,
    );
    // The cluster lands in the sheet's bar slot, not in the body's render tree.
    const trigger = screen.getByRole("button", { name: "Issue actions" });
    expect(slot.contains(trigger)).toBe(true);
    slot.remove();
  });
});

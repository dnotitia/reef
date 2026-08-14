import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";

afterEach(cleanup);

function Harness() {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button type="button" data-testid="trigger">
          Open menu
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="content">
        <ContextMenuItem data-testid="first-item">First</ContextMenuItem>
        <ContextMenuItem>Second</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TableHarness({ onClick }: { onClick: () => void }) {
  return (
    <>
      <button type="button" data-testid="prior-focus">
        Prior focus
      </button>
      <ContextMenu>
        <table>
          <tbody>
            <ContextMenuTrigger asChild portal>
              <tr data-testid="table-trigger" tabIndex={0} onClick={onClick}>
                <td>Table row</td>
              </tr>
            </ContextMenuTrigger>
          </tbody>
        </table>
        <ContextMenuContent>
          <ContextMenuItem data-testid="table-menu-item">
            Table menu
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

describe("ContextMenu", () => {
  it("opens from a pointer context-menu event and focuses the first item", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");

    fireEvent.contextMenu(trigger, { clientX: 40, clientY: 60 });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByTestId("first-item")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByText("Second")).toHaveFocus();
  });

  it("opens from Shift+F10 and Menu key without changing the trigger action", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    fireEvent.keyDown(trigger, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("keeps the existing reduced-motion and focus styling contract", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("trigger"));

    const content = screen.getByTestId("content");
    expect(content.className).toContain("motion-safe:animate-in");
    expect(content.className).toContain("motion-reduce:animate-none");
    expect(screen.getByTestId("first-item").className).toContain(
      "focus-visible:bg-surface-hover",
    );
    await user.keyboard("{Escape}");
  });

  it("keeps a table row in tbody while supporting the context menu", async () => {
    const onClick = vi.fn();
    render(<TableHarness onClick={onClick} />);

    const row = screen.getByTestId("table-trigger");
    await waitFor(() =>
      expect(row.closest("tbody")).toBeInTheDocument(),
    );

    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });
    expect(screen.getByTestId("table-menu-item")).toBeInTheDocument();
  });

  it("settles pointer focus restoration before reopening a table-row menu from the keyboard", async () => {
    const user = userEvent.setup();
    render(<TableHarness onClick={vi.fn()} />);
    const priorFocus = screen.getByTestId("prior-focus");
    const row = screen.getByTestId("table-trigger");
    priorFocus.focus();

    fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(priorFocus).toHaveFocus());

    row.focus();
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(row).toHaveFocus());
  });
});

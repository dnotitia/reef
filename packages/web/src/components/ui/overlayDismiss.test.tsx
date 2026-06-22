import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Combobox, type ComboboxOption } from "./combobox";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

/**
 * REEF-288: Escape inside a Sheet/Dialog must close an open custom overlay
 * (Combobox / Popover / menu / relation input) — which is NOT a Radix layer —
 * rather than dismissing the whole sheet. Radix's own Escape listener is a
 * capture-phase `document` listener that dismisses its highest layer; these
 * tests pin that the overlay-dismiss registry makes the sheet/dialog defer to an
 * open custom overlay, and otherwise dismiss as before.
 */

const FRUITS: ComboboxOption<string>[] = [
  { value: "apple", label: "Apple", content: "Apple" },
  { value: "banana", label: "Banana", content: "Banana" },
];

function SheetHarness({
  onOpenChange,
  onEscapeKeyDown,
}: {
  onOpenChange?: (open: boolean) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <SheetContent showCloseButton={false} onEscapeKeyDown={onEscapeKeyDown}>
        <SheetTitle>Edit issue</SheetTitle>
        <Combobox<string>
          value={null}
          onChange={() => {}}
          options={FRUITS}
          ariaLabel="Fruit"
          placeholder="Pick a fruit"
        />
      </SheetContent>
    </Sheet>
  );
}

describe("overlay dismiss inside a Sheet (REEF-288)", () => {
  it("Escape closes an open child Combobox without closing the sheet", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SheetHarness onOpenChange={onOpenChange} />);

    // Open the combobox; its listbox mounts.
    await user.click(screen.getByLabelText("Fruit"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    // The combobox panel closed…
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    // …but the sheet stayed: its title is still mounted and no close fired.
    expect(screen.getByText("Edit issue")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Escape closes the sheet when no child overlay is open", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SheetHarness onOpenChange={onOpenChange} />);

    // Focus inside the sheet but leave the combobox closed.
    screen.getByLabelText("Fruit").focus();
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(onOpenChange).toHaveBeenCalledWith(false),
    );
    await waitFor(() =>
      expect(screen.queryByText("Edit issue")).not.toBeInTheDocument(),
    );
  });

  it("defers to the open overlay before the caller's onEscapeKeyDown runs", async () => {
    const user = userEvent.setup();
    const onEscapeKeyDown = vi.fn();
    render(<SheetHarness onEscapeKeyDown={onEscapeKeyDown} />);

    await user.click(screen.getByLabelText("Fruit"));
    await user.keyboard("{Escape}");
    // Overlay open → caller's dismiss intent (e.g. IssueDetailSheet's Back/Close)
    // is suppressed so only the overlay closes.
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(onEscapeKeyDown).not.toHaveBeenCalled();

    // Overlay now closed → a second Escape reaches the caller's handler.
    screen.getByLabelText("Fruit").focus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onEscapeKeyDown).toHaveBeenCalledTimes(1));
  });
});

function DialogHarness({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogTitle>New issue</DialogTitle>
        <Combobox<string>
          value={null}
          onChange={() => {}}
          options={FRUITS}
          ariaLabel="Fruit"
          placeholder="Pick a fruit"
        />
      </DialogContent>
    </Dialog>
  );
}

describe("overlay dismiss inside a Dialog (REEF-288)", () => {
  it("Escape closes an open child overlay without closing the dialog", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<DialogHarness onOpenChange={onOpenChange} />);

    await user.click(screen.getByLabelText("Fruit"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("New issue")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Escape closes the dialog when no child overlay is open", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<DialogHarness onOpenChange={onOpenChange} />);

    screen.getByLabelText("Fruit").focus();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

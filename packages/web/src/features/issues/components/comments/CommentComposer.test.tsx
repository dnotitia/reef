// @vitest-environment jsdom

import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { VaultMember } from "@reef/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommentComposer } from "./CommentComposer";

const MEMBERS: VaultMember[] = [
  { username: "Alice Smith", display_name: "Alice", role: "member" },
  { username: "bob", display_name: "Bob", role: "member" },
];

function renderComposer(members: readonly VaultMember[] = MEMBERS) {
  return render(
    <IntlTestProvider>
      <CommentComposer
        currentLogin="alice"
        members={members}
        pending={false}
        onSubmit={vi.fn(async () => undefined)}
      />
    </IntlTestProvider>,
  );
}

describe("CommentComposer mentions", () => {
  it("selects a roster username with exact case without exposing save syntax", () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <IntlTestProvider>
        <CommentComposer
          currentLogin="alice"
          members={MEMBERS}
          pending={false}
          onSubmit={onSubmit}
        />
      </IntlTestProvider>,
    );
    const textbox = screen.getByRole("textbox", { name: "Add a comment" });

    fireEvent.change(textbox, {
      target: { value: "@a", selectionStart: 2, selectionEnd: 2 },
    });
    expect(
      screen.getByRole("option", { name: "Mention @Alice Smith" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(textbox).toHaveValue("@Alice Smith ");
    expect(textbox).not.toHaveValue(expect.stringContaining("{"));
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(onSubmit).toHaveBeenCalledWith("@{Alice Smith}");
  });

  it("supports arrow navigation and escape without submitting", () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <IntlTestProvider>
        <CommentComposer
          currentLogin="alice"
          members={MEMBERS}
          pending={false}
          onSubmit={onSubmit}
        />
      </IntlTestProvider>,
    );
    const textbox = screen.getByRole("textbox", { name: "Add a comment" });
    fireEvent.change(textbox, {
      target: { value: "@", selectionStart: 1, selectionEnd: 1 },
    });
    fireEvent.keyDown(textbox, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: "Mention @bob" }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(textbox, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add a comment" })).toHaveValue(
      "@",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not open autocomplete during IME composition", () => {
    renderComposer([{ username: "한글", role: "member" }]);
    const textbox = screen.getByRole("textbox", { name: "Add a comment" });
    fireEvent.compositionStart(textbox);
    fireEvent.change(textbox, {
      target: { value: "@한", selectionStart: 2, selectionEnd: 2 },
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.compositionEnd(textbox);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

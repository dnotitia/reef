// @vitest-environment jsdom
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { VaultMember } from "@reef/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommentMentionTextarea } from "./CommentMentionTextarea";
import {
  type CommentMentionDraft,
  emptyCommentMentionDraft,
} from "./commentMentionDraft";

const MEMBERS: VaultMember[] = [
  { username: "Bob Smith", display_name: "Bob Smith", role: "member" },
];

function SheetCommentHarness({ onEscape }: { onEscape: () => void }) {
  const [draft, setDraft] = useState<CommentMentionDraft>(() =>
    emptyCommentMentionDraft(),
  );

  return (
    <Sheet open>
      <SheetContent showCloseButton={false}>
        <SheetTitle>Issue detail</SheetTitle>
        <CommentMentionTextarea
          draft={draft}
          members={MEMBERS}
          pending={false}
          name="comment"
          ariaLabel="Add a comment"
          placeholder="Write a comment"
          rows={2}
          className=""
          onDraftChange={setDraft}
          onEscape={onEscape}
        />
      </SheetContent>
    </Sheet>
  );
}

describe("CommentMentionTextarea Escape behavior", () => {
  it("closes only the mention list while the surrounding issue sheet stays open", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(
      <IntlTestProvider>
        <SheetCommentHarness onEscape={onEscape} />
      </IntlTestProvider>,
    );

    const textbox = screen.getByRole("textbox", { name: "Add a comment" });
    await user.type(textbox, "@B");
    expect(
      screen.getByRole("option", { name: "Mention @Bob Smith" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Issue detail")).toBeInTheDocument();
    expect(textbox).toHaveValue("@B");
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("does not expose Escape as a parent key event when the list is open", () => {
    const onEscape = vi.fn();
    render(
      <IntlTestProvider>
        <CommentMentionTextarea
          draft={{ ...emptyCommentMentionDraft(), text: "@B" }}
          members={MEMBERS}
          pending={false}
          name="comment"
          ariaLabel="Add a comment"
          placeholder="Write a comment"
          rows={2}
          className=""
          onDraftChange={vi.fn()}
          onEscape={onEscape}
        />
      </IntlTestProvider>,
    );
    const textbox = screen.getByRole("textbox", { name: "Add a comment" });
    fireEvent.select(textbox, { target: { selectionStart: 2 } });
    expect(
      screen.getByRole("option", { name: "Mention @Bob Smith" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(textbox, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});

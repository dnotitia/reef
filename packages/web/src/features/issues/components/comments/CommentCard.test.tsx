// @vitest-environment jsdom
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { Comment } from "@reef/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommentCard } from "./CommentCard";

vi.mock("streamdown", () => ({
  Streamdown: ({
    children,
    urlTransform,
  }: {
    children: string;
    urlTransform?: (
      url: string,
      key: string,
      node: Record<string, unknown>,
    ) => string | null | undefined;
  }) => {
    const fileUri = "akb://reef-test/issues/file/file-1";
    return (
      <div>
        <a href={urlTransform?.(fileUri, "href", {}) ?? fileUri}>download</a>
        <img alt="inline" src={urlTransform?.(fileUri, "src", {}) ?? fileUri} />
        <span>{children}</span>
      </div>
    );
  },
  defaultUrlTransform: (url: string) => url,
}));

const COMMENT: Comment = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  reef_id: "REEF-001",
  body: "[download](akb://reef-test/issues/file/file-1)",
  author: "alice",
  created_at: "2026-07-09T00:00:00.000Z",
  edited_at: null,
};

const MENTION_COMMENT: Comment = {
  ...COMMENT,
  body: "Hello @{Bob Smith}",
  author: "alice",
  mention_recipients: ["Bob Smith"],
};

const EDITABLE_MENTION_COMMENT: Comment = {
  ...COMMENT,
  body: "@{Bob Smith} hello",
  mention_recipients: ["Bob Smith"],
};

const MEMBERS = [
  { username: "Bob Smith", display_name: "Bob Smith", role: "member" },
] as const;

describe("CommentCard", () => {
  it("passes markdown hrefs and image srcs distinctly to the URL resolver", () => {
    const resolveMarkdownUrl = vi.fn((url: string, key: string) =>
      key === "href"
        ? `/download?uri=${encodeURIComponent(url)}`
        : `/inline?uri=${encodeURIComponent(url)}`,
    );

    render(
      <IntlTestProvider>
        <CommentCard
          comment={COMMENT}
          currentLogin="bob"
          onSave={vi.fn()}
          resolveMarkdownUrl={resolveMarkdownUrl}
        />
      </IntlTestProvider>,
    );

    const encoded = encodeURIComponent("akb://reef-test/issues/file/file-1");
    expect(screen.getByRole("link", { name: "download" })).toHaveAttribute(
      "href",
      `/download?uri=${encoded}`,
    );
    expect(screen.getByRole("img", { name: "inline" })).toHaveAttribute(
      "src",
      `/inline?uri=${encoded}`,
    );
    expect(resolveMarkdownUrl).toHaveBeenCalledWith(
      "akb://reef-test/issues/file/file-1",
      "href",
      {},
    );
    expect(resolveMarkdownUrl).toHaveBeenCalledWith(
      "akb://reef-test/issues/file/file-1",
      "src",
      {},
    );
  });

  it("shows direct-parent context and exposes a semantic reply control", () => {
    const onReply = vi.fn();
    render(
      <IntlTestProvider locale="ko">
        <CommentCard
          comment={COMMENT}
          currentLogin="bob"
          replyToAuthor="carol"
          onReply={onReply}
          onSave={vi.fn()}
        />
      </IntlTestProvider>,
    );
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" &&
          element.textContent === "carol님에게 답글",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "답글" }));
    expect(onReply).toHaveBeenCalledOnce();
  });

  it("keeps edit mode syntax-free and serializes the selected identity on save", () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <IntlTestProvider>
        <CommentCard
          comment={MENTION_COMMENT}
          currentLogin="alice"
          members={MEMBERS}
          onSave={onSave}
        />
      </IntlTestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    const draft = screen.getByRole("textbox", { name: "Comment draft" });
    expect(draft).toHaveValue("Hello @Bob Smith");
    expect(draft).not.toHaveValue("Hello @{Bob Smith}");

    fireEvent.change(draft, {
      target: { value: "@B", selectionStart: 2, selectionEnd: 2 },
    });
    expect(
      screen.getByRole("option", { name: "Mention @Bob Smith" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(draft, { key: "Enter" });
    expect(draft).toHaveValue("@Bob Smith ");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("@{Bob Smith}");
  });

  it("saves the latest edited label as escaped ordinary text", () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <IntlTestProvider>
        <CommentCard
          comment={EDITABLE_MENTION_COMMENT}
          currentLogin="alice"
          members={MEMBERS}
          onSave={onSave}
        />
      </IntlTestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    const draft = screen.getByRole("textbox", { name: "Comment draft" });
    expect(draft).toHaveValue("@Bob Smith hello");

    act(() => {
      fireEvent.keyDown(draft, { key: "Delete", code: "Delete" });
      fireEvent.change(draft, {
        target: {
          value: "@Bob Smth hello",
          selectionStart: 7,
          selectionEnd: 7,
        },
      });
      fireEvent.keyDown(draft, { key: "y", code: "KeyY" });
      fireEvent.change(draft, {
        target: {
          value: "@Bob Smyth hello",
          selectionStart: 8,
          selectionEnd: 8,
        },
      });
      expect(draft).toHaveValue("@Bob Smyth hello");
      expect((draft as HTMLTextAreaElement).value).not.toMatch(/[{}\\]/u);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(onSave).toHaveBeenCalledWith("\\@Bob Smyth hello");
    expect(onSave).not.toHaveBeenCalledWith("@{Bob Smith} hello");
  });
});

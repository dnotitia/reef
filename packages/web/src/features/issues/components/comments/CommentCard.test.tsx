// @vitest-environment jsdom
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { Comment } from "@reef/core";
import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommentCard } from "./CommentCard";

const streamdownCapture = vi.hoisted(() => ({
  remarkPlugins: undefined as unknown,
}));

vi.mock("streamdown", () => ({
  defaultRehypePlugins: {
    raw: () => undefined,
    sanitize: [() => undefined, {}],
    harden: () => undefined,
  },
  defaultRemarkPlugins: { gfm: () => undefined },
  Streamdown: ({
    children,
    className,
    components,
    remarkPlugins,
    urlTransform,
  }: {
    children: string;
    className?: string;
    components?: {
      a?: (props: { children?: ReactNode; href?: string }) => ReactNode;
    };
    remarkPlugins?: unknown;
    urlTransform?: (
      url: string,
      key: string,
      node: Record<string, unknown>,
    ) => string | null | undefined;
  }) => {
    streamdownCapture.remarkPlugins = remarkPlugins;
    const fileUri = "akb://reef-test/issues/file/file-1";
    const Link =
      components?.a ??
      ((props: { children?: ReactNode; href?: string }) => <a {...props} />);
    return (
      <div className={className}>
        <Link href={urlTransform?.(fileUri, "href", {}) ?? fileUri}>
          download
        </Link>
        <Link href="https://example.com/reef">reef link</Link>
        {children.includes("REEF-002") ? (
          <Link href="/workspace/reef-test/issues/REEF-002">REEF-002</Link>
        ) : null}
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
  beforeEach(() => {
    streamdownCapture.remarkPlugins = undefined;
  });

  it("exposes a stable, focusable source target for hash navigation", () => {
    render(
      <IntlTestProvider>
        <CommentCard comment={COMMENT} currentLogin="bob" onSave={vi.fn()} />
      </IntlTestProvider>,
    );

    const card = screen.getByTestId("comment-card");
    expect(card).toHaveAttribute("id", `comment-${COMMENT.id}`);
    expect(card).toHaveAttribute("tabindex", "-1");
  });

  it("uses the shared semantic surface and keeps the comment density marker", () => {
    render(
      <IntlTestProvider>
        <CommentCard comment={COMMENT} currentLogin="bob" onSave={vi.fn()} />
      </IntlTestProvider>,
    );

    const renderer = screen.getByText(COMMENT.body).parentElement;
    expect(renderer).toHaveClass(
      "reef-markdown-surface",
      "reef-markdown-comment",
      "comment-mention-renderer",
      "text-[13px]",
    );
  });

  it("passes markdown hrefs and image srcs distinctly to the URL resolver", () => {
    const resolveMarkdownUrl = vi.fn((url: string, key: string) =>
      key === "href"
        ? `/api/issues/REEF-001/attachments/file?vault=reef-test&uri=${encodeURIComponent(url)}`
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
      `/api/issues/REEF-001/attachments/file?vault=reef-test&uri=${encoded}`,
    );
    expect(screen.getByRole("link", { name: "reef link" })).toHaveAttribute(
      "href",
      "https://example.com/reef",
    );
    expect(screen.getByRole("link", { name: "download" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "download" })).toHaveAttribute(
      "data-reef-file-uri",
      "akb://reef-test/issues/file/file-1",
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

  it("keeps ordinary links as anchors while preserving safe-link confirmation", () => {
    render(
      <IntlTestProvider>
        <CommentCard comment={COMMENT} currentLogin="bob" onSave={vi.fn()} />
      </IntlTestProvider>,
    );

    const link = screen.getByRole("link", { name: "reef link" });
    expect(link).toHaveAttribute("href", "https://example.com/reef");
    fireEvent.click(link);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a known issue token as a navigable semantic issue reference", () => {
    render(
      <IntlTestProvider>
        <CommentCard
          comment={{ ...COMMENT, body: "Known issue REEF-002" }}
          currentLogin="bob"
          knownIssueIds={new Set(["REEF-002"])}
          vault="reef-test"
          onSave={vi.fn()}
        />
      </IntlTestProvider>,
    );

    const reference = screen.getByRole("link", { name: "REEF-002" });
    expect(reference).toHaveAttribute(
      "href",
      "/workspace/reef-test/issues/REEF-002",
    );
    expect(reference).toHaveAttribute("target", "_blank");
    expect(reference).toHaveAttribute("data-reference-kind", "issue");
    expect(reference).toHaveAttribute("data-issue-id", "REEF-002");
    expect(reference).toHaveAttribute("translate", "no");

    const plugins = streamdownCapture.remarkPlugins as Array<
      | unknown
      | [
          unknown,
          {
            isKnown?: (id: string) => boolean;
            hrefFor?: (id: string) => string;
          },
        ]
    >;
    const issuePlugin = plugins.at(-1);
    expect(Array.isArray(issuePlugin)).toBe(true);
    if (!Array.isArray(issuePlugin)) throw new Error("Issue plugin is missing");
    expect(issuePlugin[1].isKnown?.("REEF-002")).toBe(true);
    expect(issuePlugin[1].isKnown?.("REEF-999")).toBe(false);
    expect(issuePlugin[1].hrefFor?.("REEF-002")).toBe(
      "/workspace/reef-test/issues/REEF-002",
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

  it("shows delete only for the author and requires confirmation", async () => {
    const onDelete = vi.fn(async () => undefined);
    const { rerender } = render(
      <IntlTestProvider>
        <CommentCard
          comment={COMMENT}
          currentLogin="alice"
          onSave={vi.fn()}
          onDelete={onDelete}
        />
      </IntlTestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    expect(screen.getByTestId("comment-delete-confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("comment-delete-cancel"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-delete-confirm")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    fireEvent.click(screen.getByTestId("comment-delete-confirm-btn"));
    await expect(onDelete).toHaveBeenCalledOnce();

    rerender(
      <IntlTestProvider>
        <CommentCard
          comment={COMMENT}
          currentLogin="bob"
          onSave={vi.fn()}
          onDelete={onDelete}
        />
      </IntlTestProvider>,
    );
    expect(screen.queryByRole("button", { name: "Delete comment" })).toBeNull();
  });

  it("blocks duplicate confirmation while deletion is pending and closes after success", async () => {
    let resolveDelete: (() => void) | undefined;
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    render(
      <IntlTestProvider>
        <CommentCard
          comment={COMMENT}
          currentLogin="alice"
          onSave={vi.fn()}
          onDelete={onDelete}
        />
      </IntlTestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    const confirm = screen.getByTestId("comment-delete-confirm-btn");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();
    resolveDelete?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("comment-delete-confirm")).toBeNull();
  });

  it("keeps the confirmation open when deletion fails", async () => {
    const onDelete = vi.fn(async () => {
      throw new Error("delete failed");
    });
    render(
      <IntlTestProvider>
        <CommentCard
          comment={COMMENT}
          currentLogin="alice"
          onSave={vi.fn()}
          onDelete={onDelete}
        />
      </IntlTestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    fireEvent.click(screen.getByTestId("comment-delete-confirm-btn"));

    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    expect(screen.getByTestId("comment-delete-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("comment-delete-confirm-btn")).toBeEnabled();
  });
});

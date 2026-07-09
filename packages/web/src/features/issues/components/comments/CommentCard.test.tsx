// @vitest-environment jsdom
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { Comment } from "@reef/core";
import { render, screen } from "@testing-library/react";
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
});

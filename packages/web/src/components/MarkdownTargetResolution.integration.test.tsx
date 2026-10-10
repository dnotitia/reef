import type {
  MarkdownAdapters,
  MarkdownTargetResolution,
  MarkdownTargetResolverContext,
} from "@akb/markdown-editor";
import { MarkdownEditor } from "@akb/markdown-editor/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const markdown = "[Guide](akb://reef-test/coll/docs/doc/guide.md)";
const target = "akb://reef-test/coll/docs/doc/guide.md";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Markdown target resolution integration", () => {
  it("aborts stale context requests without moving links or changing canonical Markdown", async () => {
    const contexts: MarkdownTargetResolverContext[] = [
      {
        vault: "reef-test",
        document: "issues/reef-001.md",
        commit: "commit-1",
      },
      {
        vault: "reef-test",
        document: "issues/reef-002.md",
        commit: "commit-1",
      },
      {
        vault: "reef-other",
        document: "issues/reef-002.md",
        commit: "commit-1",
      },
      {
        vault: "reef-other",
        document: "issues/reef-002.md",
        commit: "commit-2",
      },
    ];
    const requests: Array<{
      context: MarkdownTargetResolverContext | undefined;
      resolve: (resolution: MarkdownTargetResolution) => void;
    }> = [];
    const targetResolver: NonNullable<MarkdownAdapters["targetResolver"]> = {
      resolve: vi.fn((_target, context) => {
        const response = deferred<MarkdownTargetResolution>();
        requests.push({ context, resolve: response.resolve });
        return response.promise;
      }),
    };
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MarkdownEditor
        markdown={markdown}
        onChange={onChange}
        adapters={{ targetResolver }}
        resolverContext={contexts[0]}
        reference={false}
      />,
    );
    const link = () =>
      container.querySelector<HTMLAnchorElement>("a[data-markdown-target]");

    await waitFor(() => {
      expect(requests).toHaveLength(1);
      expect(link()).toHaveAttribute("data-markdown-target", target);
      expect(link()).toHaveAttribute("data-markdown-resolution", "pending");
      expect(link()).toHaveAttribute("href", "#");
    });

    const initialRelease = vi.fn();
    requests[0]?.resolve({
      target,
      kind: "document",
      status: "available",
      runtimeUrl: "/runtime-context-0",
      release: initialRelease,
    });
    await waitFor(() => {
      expect(link()).toHaveAttribute("data-markdown-resolution", "available");
      expect(link()).toHaveAttribute("href", "/runtime-context-0");
    });

    for (const [index, context] of contexts.slice(1).entries()) {
      const previousRequest = requests[index];
      expect(previousRequest?.context?.signal?.aborted).toBe(false);

      rerender(
        <MarkdownEditor
          markdown={markdown}
          onChange={onChange}
          adapters={{ targetResolver }}
          resolverContext={context}
          reference={false}
        />,
      );

      await waitFor(() => expect(requests).toHaveLength(index + 2));
      expect(previousRequest?.context?.signal?.aborted).toBe(true);
      if (index === 0) {
        await waitFor(() => expect(initialRelease).toHaveBeenCalledOnce());
      }
      expect(link()).toHaveAttribute("data-markdown-resolution", "pending");
      expect(link()).toHaveAttribute("href", "#");
      expect(link()).toHaveAttribute("aria-disabled", "true");
    }

    expect(
      requests.map(({ context }) => ({
        vault: context?.vault,
        document: context?.document,
        commit: context?.commit,
      })),
    ).toEqual(contexts);
    expect(requests.map(({ context }) => context?.signal?.aborted)).toEqual([
      true,
      true,
      true,
      false,
    ]);

    requests[3]?.resolve({
      target,
      kind: "document",
      status: "unavailable",
      reason: "cross-vault",
    });

    await waitFor(() => {
      expect(link()).toHaveAttribute("data-markdown-resolution", "unavailable");
      expect(link()).toHaveAttribute("href", "#");
      expect(link()).toHaveAttribute("aria-disabled", "true");
    });

    const staleReleases = [vi.fn(), vi.fn()];
    for (const [index, release] of staleReleases.entries()) {
      requests[index + 1]?.resolve({
        target,
        kind: "document",
        status: "available",
        runtimeUrl: `/stale-context-${index + 1}`,
        release,
      });
      await waitFor(() => expect(release).toHaveBeenCalledOnce());
      expect(link()).toHaveAttribute("data-markdown-resolution", "unavailable");
      expect(link()).toHaveAttribute("href", "#");
      expect(link()).toHaveAttribute("aria-disabled", "true");
    }

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(
      screen.getByRole("textbox", { name: "Markdown source" }),
    ).toHaveValue(markdown);
    expect(markdown).toContain(target);
    expect(onChange).not.toHaveBeenCalled();
    expect(link()).not.toHaveAttribute("href", "/runtime-context-0");
  });
});

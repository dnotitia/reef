import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Render `next/link` as a plain anchor so the in-app mention links do not need
// an App Router context — the assertion checks about the resolved href.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ChatMarkdown } from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  it("links known reef ids in-app and leaves unknown ids as plain text", async () => {
    const { container } = render(
      <ChatMarkdown vault="reef-e2e" knownIssueIds={new Set(["REEF-1"])}>
        See REEF-1 and REEF-9.
      </ChatMarkdown>,
    );

    // Streamdown may render asynchronously — wait for the known mention link.
    await waitFor(() => {
      expect(container.querySelectorAll('a[href^="/workspace/"]')).toHaveLength(
        1,
      );
    });

    const inAppLinks = container.querySelectorAll('a[href^="/workspace/"]');
    const link = inAppLinks[0] as HTMLAnchorElement;
    expect(link).toHaveTextContent("REEF-1");
    expect(link).toHaveAttribute("href", "/workspace/reef-e2e/issues/REEF-1");

    // REEF-9 is not a known id, so it is present as prose but not linked.
    expect(screen.getByText(/REEF-9/)).toBeInTheDocument();
    const allLinks = Array.from(container.querySelectorAll("a"));
    expect(allLinks.some((a) => a.textContent?.includes("REEF-9"))).toBe(false);
  });

  it("re-links a mention once its id becomes known mid-stream (AC3 streaming)", async () => {
    // REEF-77 is unique to this test so a leaked processor closure from another
    // test leaves it unmarked and mask the regression.
    const content = "Blocked by REEF-77 now.";
    const { container, rerender } = render(
      <ChatMarkdown vault="reef-e2e" knownIssueIds={new Set()}>
        {content}
      </ChatMarkdown>,
    );
    await screen.findByText(/REEF-77/);
    // Not yet proven → plain text.
    expect(container.querySelectorAll('a[href^="/workspace/"]')).toHaveLength(
      0,
    );

    // A tool completes mid-stream and proves REEF-77; the same answer text should
    // now deep-link it rather than keeping a stale plain render.
    rerender(
      <ChatMarkdown vault="reef-e2e" knownIssueIds={new Set(["REEF-77"])}>
        {content}
      </ChatMarkdown>,
    );
    await waitFor(() => {
      const link = container.querySelector(
        'a[href="/workspace/reef-e2e/issues/REEF-77"]',
      );
      expect(link).not.toBeNull();
      expect(link).toHaveTextContent("REEF-77");
    });
  });

  it("renders no in-app issue link when no ids are known", async () => {
    // Reference an id that no other test in this file marks known: Streamdown
    // keeps a module-level processor cache, so the `isKnown` closure from an
    // earlier render can be reused — an id that is unknown in every closure
    // stays plain text regardless of test order.
    const { container } = render(
      <ChatMarkdown vault="reef-e2e" knownIssueIds={new Set()}>
        See REEF-9.
      </ChatMarkdown>,
    );

    // Wait for the prose to render, then assert there is no in-app link.
    await screen.findByText(/REEF-9/);
    expect(container.querySelectorAll('a[href^="/workspace/"]')).toHaveLength(
      0,
    );
  });
});

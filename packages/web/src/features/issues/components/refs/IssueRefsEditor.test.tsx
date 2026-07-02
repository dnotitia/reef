import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueRefsEditor } from "./IssueRefsEditor";

describe("IssueRefsEditor", () => {
  it("does not render unsafe implementation URLs as links", () => {
    render(
      <IssueRefsEditor
        externalRefs={[]}
        implementationRefs={[
          {
            type: "pull_request",
            ref: "123",
            url: "javascript:alert(1)",
            title: "Unsafe activity",
          },
        ]}
        onExternalRefsChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Unsafe activity")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders http and https implementation URLs as links", () => {
    render(
      <IssueRefsEditor
        externalRefs={[]}
        implementationRefs={[
          {
            type: "pull_request",
            ref: "123",
            url: "https://github.com/acme/app/pull/123",
            title: "Safe activity",
          },
        ]}
        onExternalRefsChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: /Safe activity/i }),
    ).toHaveAttribute("href", "https://github.com/acme/app/pull/123");
  });

  it("renders safe external reference URLs as links", () => {
    render(
      <IssueRefsEditor
        externalRefs={[
          {
            type: "url",
            ref: "https://example.com/spec",
            url: "https://example.com/spec",
            label: "Spec",
          },
        ]}
        implementationRefs={[]}
        onExternalRefsChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Spec" })).toHaveAttribute(
      "href",
      "https://example.com/spec",
    );
  });

  // REEF-329: jira/confluence are first-class external-ref kinds. jsdom cannot
  // reliably open the Radix Select popover, so the dropdown-option coverage is
  // the live-proof e2e; here we assert the label map resolves the new brand
  // kinds (the `Record<ExternalRef["type"], string>` map already forces this at
  // type-check time, this pins it at runtime too).
  it("labels jira and confluence external references with their brand names (REEF-329)", () => {
    render(
      <IssueRefsEditor
        externalRefs={[
          {
            type: "jira",
            ref: "PROJ-42",
            url: "https://acme.atlassian.net/browse/PROJ-42",
            label: "PROJ-42",
          },
          {
            type: "confluence",
            ref: "https://acme.atlassian.net/wiki/spaces/ENG/pages/1/Spec",
            url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/1/Spec",
            label: "Design doc",
          },
        ]}
        implementationRefs={[]}
        onExternalRefsChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Jira")).toBeInTheDocument();
    expect(screen.getByText("Confluence")).toBeInTheDocument();
  });

  it("does not render unsafe external reference URLs as links", () => {
    render(
      <IssueRefsEditor
        externalRefs={[
          {
            type: "url",
            ref: "javascript:alert(1)",
            label: "Unsafe spec",
          },
        ]}
        implementationRefs={[]}
        onExternalRefsChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Unsafe spec")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  // REEF-071: a long, space-less ref should stay inside the left column. We assert
  // the layout contract (CSS truncation) rather than pixels, since jsdom has no
  // layout — the truncate/min-w-0 classes are what keep it from overrunning the
  // right rail.
  it("truncates a long delivery ref for display while preserving the full value", () => {
    const longRef = `feature/${"x".repeat(200)}`;
    render(
      <IssueRefsEditor
        externalRefs={[]}
        implementationRefs={[{ type: "branch", ref: longRef }]}
        onExternalRefsChange={vi.fn()}
        onImplementationRefsChange={vi.fn()}
      />,
    );

    const chip = screen.getByText(longRef);
    expect(chip).toHaveClass("truncate");
    // The full, untruncated ref stays reachable via the hover tooltip.
    expect(chip).toHaveAttribute("title", longRef);
  });

  it("shows a short commit SHA but keeps the full SHA in the title", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    render(
      <IssueRefsEditor
        externalRefs={[]}
        implementationRefs={[{ type: "commit", ref: sha }]}
        onExternalRefsChange={vi.fn()}
        onImplementationRefsChange={vi.fn()}
      />,
    );

    const chip = screen.getByText("0123456");
    expect(chip).toHaveAttribute("title", sha);
  });

  it("copies the full original ref, not the displayed (truncated) value", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const longRef = `feature/${"y".repeat(200)}`;
    render(
      <IssueRefsEditor
        externalRefs={[]}
        implementationRefs={[{ type: "branch", ref: longRef }]}
        onExternalRefsChange={vi.fn()}
        onImplementationRefsChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy reference/i }));
    expect(writeText).toHaveBeenCalledWith(longRef);
  });
});

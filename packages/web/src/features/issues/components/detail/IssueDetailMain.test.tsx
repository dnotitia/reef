// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

// Heavy / query-backed children aren't relevant to the clip-container contract.
vi.mock("@/components/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("../refs/IssueLinkedDocuments", () => ({
  IssueLinkedDocuments: () => null,
}));
vi.mock("../refs/IssueRefsEditor", () => ({ IssueRefsEditor: () => null }));
vi.mock("../comments/IssueComments", () => ({ IssueComments: () => null }));
vi.mock("../relations/IssueChildren", () => ({ IssueChildren: () => null }));
vi.mock("../relations/IssueRelationInput", () => ({
  IssueRelationInput: () => null,
}));

import { IssueDetailMain } from "./IssueDetailMain";

function renderMain(
  overrides: Partial<Parameters<typeof IssueDetailMain>[0]> = {},
) {
  return render(renderMainElement(overrides));
}

/**
 * REEF-226: the edit body keeps clipping horizontal content overflow (long
 * bodies/refs does not widen the column), but a clip-margin lets a focused field's
 * 2–3px ring/outline paint past the clip edge — so the Title input's left/right
 * focus border is no longer shaved off. jsdom does not measure the paint, so this
 * locks the structural contract; the real clipping is verified in-browser.
 */
describe("IssueDetailMain focus-ring clipping (REEF-226)", () => {
  it("pairs overflow-x-clip with a clip-margin safe zone on the edit body", () => {
    renderMain();
    const main = screen.getByRole("main");
    expect(main.className).toContain("overflow-x-clip");
    expect(main.className).toContain("[overflow-clip-margin:3px]");
  });

  it("uses inset input focus rings inside the clipped edit lane", () => {
    renderMain();
    const input = screen.getByTestId("issue-title-input");
    expect(input.className).toContain("focus-visible:ring-2");
    expect(input.className).toContain("focus-visible:ring-inset");
    expect(input.className).toContain("focus-visible:ring-brand/30");
  });
});

describe("IssueDetailMain autosave boundaries", () => {
  it("commits the title input's current value on blur", () => {
    const commitTitle = vi.fn();

    function TitleHarness() {
      const [title, setTitle] = useState("Sample title");
      return renderMainElement({ title, setTitle, commitTitle });
    }

    render(<TitleHarness />);

    const input = screen.getByTestId("issue-title-input");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.blur(input);

    expect(commitTitle).toHaveBeenCalledWith("Renamed title");
  });
});

function renderMainElement(
  overrides: Partial<Parameters<typeof IssueDetailMain>[0]> = {},
) {
  return (
    <IssueDetailMain
      issueId="REEF-1"
      vault="reef-test"
      issue={undefined}
      allIssues={[]}
      relations={[]}
      title=""
      body=""
      parentId=""
      dependsOn={[]}
      blocks={[]}
      relatedTo={[]}
      externalRefs={[]}
      implementationRefs={[]}
      setTitle={vi.fn()}
      setBody={vi.fn()}
      setParentId={vi.fn()}
      setDependsOn={vi.fn()}
      setBlocks={vi.fn()}
      setRelatedTo={vi.fn()}
      setExternalRefs={vi.fn()}
      setImplementationRefs={vi.fn()}
      commitTitle={vi.fn()}
      commitBody={vi.fn()}
      commit={vi.fn()}
      {...overrides}
    />
  );
}

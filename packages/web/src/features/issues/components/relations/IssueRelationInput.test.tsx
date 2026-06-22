import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import type { IssueMetadata } from "@reef/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueRelationInput } from "./IssueRelationInput";

// Navigable chips drill in place through `useIssueDrill` (REEF-284), which reads
// the router + live query, so stub both navigation primitives. An empty
// `useSearchParams` keeps relation hrefs bare (`/issues/REEF-001`).
const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  mockReplace.mockClear();
  useIssueNavStack.setState({ trail: [], currentId: null });
});

const ISSUES: IssueMetadata[] = [
  {
    id: "REEF-001",
    title: "Parent issue",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "REEF-002",
    title: "Dependency issue",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
];

describe("IssueRelationInput", () => {
  it("renders parent as a single-value control, not a relation chip list", () => {
    render(
      <IssueRelationInput
        id="parent"
        label="Parent"
        value={["REEF-001"]}
        allIssues={ISSUES}
        onChange={() => {}}
        maxItems={1}
      />,
    );

    expect(screen.getByLabelText("Parent")).toHaveValue("REEF-001");
    expect(
      screen.getByRole("button", { name: "Clear Parent" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove REEF-001" }),
    ).not.toBeInTheDocument();
  });

  it("sets and clears a single parent value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <IssueRelationInput
        id="parent"
        label="Parent"
        value={[]}
        allIssues={ISSUES}
        onChange={onChange}
        maxItems={1}
      />,
    );

    await user.type(screen.getByLabelText("Parent"), "reef-002");
    await user.click(screen.getByRole("button", { name: "Set Parent" }));
    expect(onChange).toHaveBeenLastCalledWith(["REEF-002"]);

    rerender(
      <IssueRelationInput
        id="parent"
        label="Parent"
        value={["REEF-002"]}
        allIssues={ISSUES}
        onChange={onChange}
        maxItems={1}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear Parent" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("keeps relation chip behavior for multi-value relationships", () => {
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={["REEF-001"]}
        allIssues={ISSUES}
        onChange={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove REEF-001" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add Depends on" }),
    ).toBeInTheDocument();
  });

  // REEF-032: candidate dropdown is now a card-level combobox.
  const RICH: IssueMetadata[] = [
    {
      id: "REEF-001",
      title: "Login fails",
      status: "todo",
      issue_type: "bug",
      priority: "high",
      created_at: "2026-05-01T00:00:00.000Z",
      created_by: "alice",
      updated_at: "2026-05-01T00:00:00.000Z",
      updated_by: "alice",
    },
    {
      id: "REEF-002",
      title: "Blocked work",
      status: "in_progress",
      issue_type: "story",
      priority: "medium",
      depends_on: ["REEF-001"],
      created_at: "2026-05-01T00:00:00.000Z",
      created_by: "alice",
      updated_at: "2026-05-01T00:00:00.000Z",
      updated_by: "alice",
    },
  ];

  // REEF-268: detail-panel chips are navigable, self-describing rows; the
  // create dialog / activity-draft editor keep the non-navigable id chips.
  describe("navigable chips (REEF-268)", () => {
    it("renders each chip as a link to the issue with id + title", () => {
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={["REEF-001"]}
          allIssues={RICH}
          onChange={() => {}}
          navigable
        />,
      );

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/issues/REEF-001");
      // Self-describing: the id AND the title render inside the link, matching
      // the Sub-issues row (not the old id-only chip).
      expect(link).toHaveTextContent("REEF-001");
      expect(link).toHaveTextContent("Login fails");
      // Same focus contract as IssueChildren's rows.
      expect(link).toHaveClass("focus-visible:ring-brand/40");
    });

    it("drills in place on click, recording the hop like the breadcrumb (REEF-284)", async () => {
      const user = userEvent.setup();
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={["REEF-001"]}
          allIssues={RICH}
          currentIssueId="REEF-002"
          onChange={() => {}}
          navigable
        />,
      );

      await user.click(screen.getByRole("link"));

      // Same nav model as the parent breadcrumb / Sub-issues: push the issue we
      // are leaving onto the trail, move currentId to the target, and replace
      // (not push) so the browser history stays flat.
      expect(useIssueNavStack.getState().trail).toEqual(["REEF-002"]);
      expect(useIssueNavStack.getState().currentId).toBe("REEF-001");
      expect(mockReplace).toHaveBeenCalledWith("/issues/REEF-001");
    });

    it("keeps the remove X as a separate hit target that does not navigate", async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={["REEF-001"]}
          allIssues={RICH}
          onChange={onChange}
          navigable
        />,
      );

      const removeButton = screen.getByRole("button", {
        name: "Remove REEF-001",
      });
      // The remove button is outside the navigating link, so clicking it
      // removes the relation without following the href.
      expect(screen.getByRole("link")).not.toContainElement(removeButton);

      await user.click(removeButton);
      expect(onChange).toHaveBeenLastCalledWith([]);
    });

    it("degrades an unresolved relation id to an id-only link, keeping navigation", () => {
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          // REEF-999 is absent from allIssues (e.g. an archived target).
          value={["REEF-999"]}
          allIssues={RICH}
          onChange={() => {}}
          navigable
        />,
      );

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/issues/REEF-999");
      expect(link).toHaveTextContent("REEF-999");
    });

    it("stays non-navigable by default (create dialog / draft editor)", () => {
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={["REEF-001"]}
          allIssues={RICH}
          onChange={() => {}}
        />,
      );

      // No link: clicking a chip in an unsaved-issue form must not navigate.
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      // The id chip + its remove control are still rendered.
      expect(screen.getByText("REEF-001")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove REEF-001" }),
      ).toBeInTheDocument();
    });
  });

  // REEF-282: the non-navigable chips (create dialog / draft editor) get the
  // same a11y/i18n finish the navigable chips already have (REEF-268), without
  // gaining navigation or changing the pill layout. jsdom loads no Tailwind, so
  // these assert the structural class/attribute contract the fix turns on.
  describe("non-navigable chip a11y/i18n finish (REEF-282)", () => {
    it("gives the remove button the same keyboard focus ring as the navigable chip", () => {
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={["REEF-001"]}
          allIssues={RICH}
          onChange={() => {}}
        />,
      );

      // No navigation was added — still the non-navigable chip branch.
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove REEF-001" }),
      ).toHaveClass("focus-visible:ring-brand/40");
    });

    it("marks the decorative X aria-hidden while the button keeps its accessible name", () => {
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={["REEF-001"]}
          allIssues={RICH}
          onChange={() => {}}
        />,
      );

      const removeButton = screen.getByRole("button", {
        name: "Remove REEF-001",
      });
      // The accessible name comes from aria-label, so the icon is decorative.
      expect(removeButton.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });

    it("marks the id span translate=no so auto-translation preserves the reef id", () => {
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={["REEF-001"]}
          allIssues={RICH}
          onChange={() => {}}
        />,
      );

      expect(screen.getByText("REEF-001")).toHaveAttribute("translate", "no");
    });
  });

  it("renders candidate rows with type, priority, and blocked badge", async () => {
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={() => {}}
      />,
    );

    await user.type(screen.getByLabelText("Depends on"), "REEF-002");

    // Type pill, priority dot, and blocked badge all surface on the row.
    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority: Medium")).toBeInTheDocument();
    expect(screen.getByText("Blocked (1)")).toBeInTheDocument();
  });

  it("adds a candidate chosen from the dropdown", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText("Depends on"), "REEF-002");
    // The panel is portaled to <body>, so query the whole document.
    const option = document.querySelector('[data-issue-id="REEF-002"]');
    expect(option).not.toBeNull();
    await user.click(option as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(["REEF-002"]);
  });

  it("re-enables pointer events on the portaled panel so clicks land inside a modal dialog", async () => {
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={() => {}}
      />,
    );

    await user.type(screen.getByLabelText("Depends on"), "REEF-002");

    // REEF-092: the panel is portaled to <body>. Inside a modal Radix dialog the
    // DismissableLayer sets `pointer-events: none` on <body>, which a body-portaled
    // panel inherits — swallowing option clicks (onClick does not fires, the
    // outside-mousedown handler closes the dropdown). The panel should opt back in
    // with `pointer-events-auto`. jsdom loads no Tailwind CSS, so the inherited
    // none does not be simulated through computed styles; this asserts the structural
    // opt-in the fix relies on. The full behavior is verified manually / in e2e.
    expect(screen.getByTestId("relation-dropdown-panel")).toHaveClass(
      "pointer-events-auto",
    );
  });

  it("adds an arbitrary typed id via the free-text Use row", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText("Depends on"), "reef-777");
    // No candidate matches, so the "Use …" row is offered.
    await user.click(screen.getByText("REEF-777"));
    expect(onChange).toHaveBeenLastCalledWith(["REEF-777"]);
  });

  it("adds the auto-highlighted match on Enter", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText("Depends on"), "REEF-001");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["REEF-001"]);
  });

  it("adds the top match (not the raw query) on Enter for a title search", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={onChange}
      />,
    );

    // "Login" matches REEF-001 by title but is not an id; Enter should commit the
    // matched issue, does not the raw text. The top match is auto-highlighted, so
    // Enter commits it.
    await user.type(screen.getByLabelText("Depends on"), "Login");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["REEF-001"]);
  });

  it("does not commit anything when Enter is pressed on an empty field", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={onChange}
      />,
    );

    // Focusing opens the panel with the recent-issue list; Enter should not commit
    // the first recent issue when nothing has been typed.
    await user.click(screen.getByLabelText("Depends on"));
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers a free-text Use row for an id-shaped query that only matches a title", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const issues: IssueMetadata[] = [
      {
        id: "REEF-005",
        title: "Migrate REEF-900 endpoints",
        status: "todo",
        created_at: "2026-05-01T00:00:00.000Z",
        created_by: "alice",
        updated_at: "2026-05-01T00:00:00.000Z",
        updated_by: "alice",
      },
    ];
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={issues}
        onChange={onChange}
      />,
    );

    // "REEF-900" substring-matches REEF-005's title, but it is still an id absent
    // from the list, so the free-text "Use REEF-900" row should remain available.
    await user.type(screen.getByLabelText("Depends on"), "REEF-900");
    await user.click(screen.getByRole("button", { name: /Use REEF-900/ }));
    expect(onChange).toHaveBeenLastCalledWith(["REEF-900"]);
  });

  it("disables Add for a non-id, non-matching query so no arbitrary string is saved", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText("Depends on"), "foo");
    expect(
      screen.getByRole("button", { name: "Add Depends on" }),
    ).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets you add a relation to an archived issue by exact id", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const issues: IssueMetadata[] = [
      {
        id: "REEF-050",
        title: "Archived thing",
        status: "closed",
        archived_at: "2026-05-01T00:00:00.000Z",
        created_at: "2026-05-01T00:00:00.000Z",
        created_by: "alice",
        updated_at: "2026-05-01T00:00:00.000Z",
        updated_by: "alice",
      },
    ];
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={issues}
        onChange={onChange}
      />,
    );

    // The archived issue is dropped from the search matches, but its exact id
    // should still be addable via the free-text Use row (the old datalist allowed
    // any issue in the list).
    await user.type(screen.getByLabelText("Depends on"), "REEF-050");
    await user.click(screen.getByRole("button", { name: /Use REEF-050/ }));
    expect(onChange).toHaveBeenLastCalledWith(["REEF-050"]);
  });

  it("does not let an issue reference itself via the free-text row", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="parent"
        label="Parent"
        value={[]}
        allIssues={RICH}
        currentIssueId="REEF-001"
        onChange={onChange}
        maxItems={1}
      />,
    );

    // Typing the current issue's own id should not surface a "Use …" row or enable
    // the Set button — a self parent/dependency is invalid.
    await user.type(screen.getByLabelText("Parent"), "REEF-001");
    expect(screen.queryByRole("button", { name: /Use REEF-001/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Set Parent" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits the typed id by default (Enter) when it only matches a title", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const issues: IssueMetadata[] = [
      {
        id: "REEF-005",
        title: "Migrate REEF-900 endpoints",
        status: "todo",
        created_at: "2026-05-01T00:00:00.000Z",
        created_by: "alice",
        updated_at: "2026-05-01T00:00:00.000Z",
        updated_by: "alice",
      },
    ];
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={issues}
        onChange={onChange}
      />,
    );

    // "REEF-900" is a complete id with no id match (just REEF-005's title), so the
    // default commit should be the typed id, not the coincidental title match.
    await user.type(screen.getByLabelText("Depends on"), "REEF-900");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["REEF-900"]);
  });

  it("commits the top match (not the raw text) for an id prefix that has id matches", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={onChange}
      />,
    );

    // "REEF-0" is a prefix of REEF-001/REEF-002 (id matches exist), so Enter
    // commits the top match rather than the raw prefix text.
    await user.type(screen.getByLabelText("Depends on"), "REEF-0");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["REEF-001"]);
  });

  it("resolves blocked state from relationGraph, not the visible list", async () => {
    const user = userEvent.setup();
    // The candidate depends on REEF-001, which is archived/done and therefore
    // absent from the visible list — but present (resolved) in the relation graph.
    const allIssues: IssueMetadata[] = [
      {
        id: "REEF-002",
        title: "Depends on archived",
        status: "todo",
        depends_on: ["REEF-001"],
        created_at: "2026-05-01T00:00:00.000Z",
        created_by: "alice",
        updated_at: "2026-05-01T00:00:00.000Z",
        updated_by: "alice",
      },
    ];
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={allIssues}
        relationGraph={[
          { id: "REEF-002", status: "todo", depends_on: ["REEF-001"] },
          { id: "REEF-001", status: "done", depends_on: [] },
        ]}
        onChange={() => {}}
      />,
    );

    await user.type(screen.getByLabelText("Depends on"), "REEF-002");
    expect(screen.getByText("Depends on archived")).toBeInTheDocument();
    // The dependency is done in the graph, so the row should not show Blocked.
    expect(screen.queryByText(/Blocked/)).toBeNull();
  });

  // REEF-223: multi-value relations now close on select, matching single mode.
  it("closes the dropdown after adding a candidate in multi mode", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={onChange}
      />,
    );

    const field = screen.getByLabelText("Depends on");
    await user.type(field, "REEF-002");
    expect(screen.getByTestId("relation-dropdown-panel")).toBeInTheDocument();

    await user.click(
      document.querySelector('[data-issue-id="REEF-002"]') as HTMLElement,
    );

    // The relation is committed AND the panel closes (previously it stayed open
    // on the recent list, reading as "selection didn't take").
    expect(onChange).toHaveBeenLastCalledWith(["REEF-002"]);
    expect(screen.queryByTestId("relation-dropdown-panel")).toBeNull();
    expect(field).toHaveAttribute("aria-expanded", "false");
  });

  // REEF-223: the panel flips above the field when it would otherwise spill off
  // the bottom of the viewport. jsdom returns rect=0, so geometry is mocked to
  // place the field near the bottom and the panel taller than the room below;
  // the structural contract asserted here is that the panel anchors from its
  // bottom (not its top). On-screen placement is verified manually in a browser.
  it("anchors the panel from its bottom (flips up) when the field is near the viewport bottom", async () => {
    const user = userEvent.setup();
    const makeRect = (top: number, height: number): DOMRect =>
      ({
        top,
        bottom: top + height,
        left: 0,
        right: 320,
        width: 320,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        // The portaled panel is tall; everything else (the field wrapper) sits
        // near the bottom edge of the 768px-tall jsdom viewport.
        return this instanceof HTMLElement &&
          this.dataset.testid === "relation-dropdown-panel"
          ? makeRect(0, 300)
          : makeRect(720, 28);
      });

    try {
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={[]}
          allIssues={RICH}
          onChange={() => {}}
        />,
      );

      await user.type(screen.getByLabelText("Depends on"), "REEF-002");

      const panel = screen.getByTestId("relation-dropdown-panel");
      // Flipped up: positioned by `bottom`, with `top` left unset.
      expect(panel.style.bottom).not.toBe("");
      expect(panel.style.top).toBe("");
      // The list still contains wheel-scroll so a long candidate list does not
      // drags the surrounding dialog/sheet (AC1).
      expect(panel.querySelector(".overscroll-contain")).not.toBeNull();
    } finally {
      rectSpy.mockRestore();
    }
  });

  // REEF-223: while the panel stays open, broadening the query can grow the list
  // past the room below the field. A ResizeObserver should re-measure so a panel
  // that opened downward flips up instead of spilling off the bottom.
  it("re-flips the panel up when the list grows past the room below while open", async () => {
    const user = userEvent.setup();
    let panelHeight = 100;
    const makeRect = (top: number, height: number): DOMRect =>
      ({
        top,
        bottom: top + height,
        left: 0,
        right: 320,
        width: 320,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    // Field sits mid-low: a short panel fits in the ~260px below it, a tall one
    // does not (768px-tall jsdom viewport).
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        return this instanceof HTMLElement &&
          this.dataset.testid === "relation-dropdown-panel"
          ? makeRect(0, panelHeight)
          : makeRect(480, 28);
      });
    // Capture the ResizeObserver callback so the content-growth resize can be
    // fired deterministically (the jsdom shim does not fires on its own).
    let fireResize: (() => void) | null = null;
    const RealResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        fireResize = () => cb([], this as unknown as ResizeObserver);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    try {
      render(
        <IssueRelationInput
          id="depends-on"
          label="Depends on"
          value={[]}
          allIssues={RICH}
          onChange={() => {}}
        />,
      );

      await user.type(screen.getByLabelText("Depends on"), "REEF-001");
      const panel = screen.getByTestId("relation-dropdown-panel");
      // Short panel → opens downward (anchored from its top).
      expect(panel.style.top).not.toBe("");
      expect(panel.style.bottom).toBe("");

      // The list grows past the room below; the observer re-measures.
      panelHeight = 300;
      await act(async () => {
        fireResize?.();
      });

      // Now anchored from its bottom — flipped up, no longer spilling off-screen.
      expect(panel.style.bottom).not.toBe("");
      expect(panel.style.top).toBe("");
    } finally {
      rectSpy.mockRestore();
      globalThis.ResizeObserver = RealResizeObserver;
    }
  });

  // REEF-223: the panel is portaled to <body>, outside a modal dialog's
  // react-remove-scroll lock, which cancels any wheel event that bubbles to its
  // document-level handler — blocking the list from scrolling. The panel stops
  // wheel events so they does not reach that handler; assert they don't bubble to
  // document. (Real native scrolling is verified in a browser; jsdom doesn't lay
  // out or scroll.)
  it("stops list wheel events from bubbling to the document scroll lock", async () => {
    const user = userEvent.setup();
    render(
      <IssueRelationInput
        id="depends-on"
        label="Depends on"
        value={[]}
        allIssues={RICH}
        onChange={() => {}}
      />,
    );

    await user.type(screen.getByLabelText("Depends on"), "REEF-002");
    const panel = screen.getByTestId("relation-dropdown-panel");
    const list = panel.querySelector(".overflow-y-auto") ?? panel;

    const onDocWheel = vi.fn();
    document.addEventListener("wheel", onDocWheel);
    try {
      list.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 40,
        }),
      );
      // Stopped at the panel: a modal scroll lock's document handler does not sees
      // it, so it does not cancel the list's native scroll.
      expect(onDocWheel).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("wheel", onDocWheel);
    }
  });
});

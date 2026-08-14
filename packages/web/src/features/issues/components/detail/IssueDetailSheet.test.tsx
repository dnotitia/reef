import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { Locale } from "@/i18n/locales";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const { mockUseActiveVault, mockReplace } = vi.hoisted(() => ({
  mockUseActiveVault: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: mockUseActiveVault,
}));

// The sheet's drill-aware dismiss controller reads router + the live query
// (REEF-270). With an empty trail there is no Back affordance.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// `data-next-link` marks anchors routed through Next `Link`; a raw `<a>` lacks
// it, so the no-vault CTA assertion fails if the Settings link regresses to a
// full-reload anchor (REEF-262).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a data-next-link="true" href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The persistent chrome bar reads these for its identity cluster (REEF-286).
// They are query data, not what these chrome/dismiss tests exercise, so stub
// them empty — the bar then shows the route-param id alone, which is exactly the
// loading / id fallback state the AC2 assertions check.
vi.mock("@/features/issues/hooks/queries/useIssue", () => ({
  useIssue: () => ({ data: undefined }),
}));
vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: () => ({ data: undefined, isPending: false }),
}));

import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import {
  clampIssueDetailWidth,
  getIssueDetailMaxWidth,
  ISSUE_DETAIL_DEFAULT_WIDTH,
  ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY,
  ISSUE_DETAIL_KEYBOARD_STEP,
  ISSUE_DETAIL_MIN_WIDTH,
  ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY,
  ISSUE_DETAIL_SESSION_STORAGE_KEY,
  IssueDetailSheet,
} from "./IssueDetailSheet";

function wrap(ui: ReactNode, locale: Locale = "en") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider locale={locale}>{ui}</IntlTestProvider>
    </QueryClientProvider>
  );
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

describe("IssueDetailSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    setViewportWidth(1024);
    useIssueNavStack.getState().clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    setViewportWidth(1024);
  });

  it("renders the skeleton path while vault is loading", () => {
    mockUseActiveVault.mockReturnValue({
      vault: "",
      isLoading: true,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));
    // Skeletons render a series of <Skeleton/> elements — no error thrown is the smoke check.
    expect(screen.getByTestId("issue-detail-modal")).toBeInTheDocument();
    expect(
      screen.queryByTestId("issue-detail-no-vault"),
    ).not.toBeInTheDocument();
  });

  it('renders the "Configure a workspace" CTA with a client-side Settings link when no vault is set (REEF-262)', () => {
    mockUseActiveVault.mockReturnValue({
      vault: "",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));
    expect(screen.getByTestId("issue-detail-no-vault")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveAttribute("data-next-link", "true");
  });

  it("mounts IssueDetail when vault is available", () => {
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));
    expect(
      screen.queryByTestId("issue-detail-no-vault"),
    ).not.toBeInTheDocument();
  });

  // REEF-111: opting out of the shared SheetContent X should not leave a sheet
  // state without a visible close control. Every state exposes exactly one
  // close button — the in-flow replacement (data-testid="issue-close"), does not
  // the shared overlay X (which carries no test id).
  it.each([
    ["vault loading", { vault: "", isLoading: true }],
    ["no vault", { vault: "", isLoading: false }],
    ["vault available", { vault: "reef-acme", isLoading: false }],
  ])("always exposes a single close button (%s)", (_label, vaultState) => {
    mockUseActiveVault.mockReturnValue({
      ...vaultState,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));

    const closers = screen.getAllByRole("button", { name: "Close" });
    expect(closers).toHaveLength(1);
    expect(closers[0]).toHaveAttribute("data-testid", "issue-close");
  });

  // REEF-286: the identity/nav bar is persistent chrome outside the body, so the
  // route-param id fills the bar's left in every state — there is no empty
  // band, and the id does not blink while the body below skeletons (AC1 · AC2).
  it.each([
    ["vault loading", { vault: "", isLoading: true }],
    ["no vault", { vault: "", isLoading: false }],
    ["vault available", { vault: "reef-acme", isLoading: false }],
  ])("fills the chrome bar with the issue id (%s)", (_label, vaultState) => {
    mockUseActiveVault.mockReturnValue({
      ...vaultState,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));

    const bar = screen.getByTestId("issue-detail-chrome");
    expect(bar).toHaveTextContent("REEF-001");
    // The bar also owns the single Close, so the left id + right Close pair is
    // present without an empty band in any state.
    expect(bar).toContainElement(screen.getByTestId("issue-close"));
  });

  it("dismisses through the fallback close button in a header-less state (REEF-111)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockUseActiveVault.mockReturnValue({
      vault: "",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={onClose} />));

    await user.click(screen.getByTestId("issue-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the sheet open when a child layer has already consumed Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let childEscapeConsumed = false;
    const consumeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !childEscapeConsumed) {
        childEscapeConsumed = true;
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", consumeEscape, { capture: true });

    try {
      mockUseActiveVault.mockReturnValue({
        vault: "",
        isLoading: false,
        refetch: () => Promise.resolve(),
      });
      render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={onClose} />));

      await user.keyboard("{Escape}");

      expect(onClose).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", consumeEscape, { capture: true });
    }
  });

  // REEF-270: the drill trail drives a top-left Back affordance and makes Close
  // exit the whole trail in one shot.
  describe("drill navigation (REEF-270)", () => {
    function renderDrilledInto(issueId: string, onClose = vi.fn()) {
      mockUseActiveVault.mockReturnValue({
        vault: "",
        isLoading: false,
        refetch: () => Promise.resolve(),
      });
      render(wrap(<IssueDetailSheet issueId={issueId} onClose={onClose} />));
      return onClose;
    }

    it("shows no Back affordance when the trail is empty (depth 0)", () => {
      renderDrilledInto("REEF-001");
      expect(screen.queryByTestId("issue-drill-back")).toBeNull();
    });

    it("shows a Back affordance to the previous issue when drilled in", () => {
      // Trail expects REEF-001 on screen, having drilled here from REEF-A, so
      // reconcile keeps the trail (currentId already matches).
      useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-001" });
      renderDrilledInto("REEF-001");

      const back = screen.getByTestId("issue-drill-back");
      expect(back).toHaveAccessibleName("Back to REEF-A");
      expect(back).toHaveAttribute("data-back-to", "REEF-A");
      // Exposed as its own labelled nav landmark, separate from the breadcrumb's
      // "Issue hierarchy" — drill trail vs. structure (AC5).
      const nav = screen.getByRole("navigation", { name: "Back navigation" });
      expect(nav).toContainElement(back);
    });

    it("Back pops one hop and replaces to the previous issue (AC1/AC4)", async () => {
      const user = userEvent.setup();
      useIssueNavStack.setState({
        trail: ["REEF-A", "REEF-B"],
        currentId: "REEF-001",
      });
      renderDrilledInto("REEF-001");

      await user.click(screen.getByTestId("issue-drill-back"));

      // One hop: REEF-B leaves the trail and we replace to it.
      expect(useIssueNavStack.getState().trail).toEqual(["REEF-A"]);
      expect(mockReplace).toHaveBeenCalledWith("/issues/REEF-B");
    });

    it("Close exits the whole trail in one shot (AC2)", async () => {
      const user = userEvent.setup();
      useIssueNavStack.setState({
        trail: ["REEF-A", "REEF-B"],
        currentId: "REEF-001",
      });
      const onClose = renderDrilledInto("REEF-001");

      await user.click(screen.getByTestId("issue-close"));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(useIssueNavStack.getState().trail).toEqual([]);
    });

    it("Escape unwinds one drill hop instead of closing the session", async () => {
      const user = userEvent.setup();
      useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-001" });
      const onClose = renderDrilledInto("REEF-001");

      await user.keyboard("{Escape}");

      expect(mockReplace).toHaveBeenCalledWith("/issues/REEF-A");
      expect(onClose).not.toHaveBeenCalled();
      expect(useIssueNavStack.getState().trail).toEqual([]);
    });

    it("outside click closes the entire drill session", async () => {
      const user = userEvent.setup();
      useIssueNavStack.setState({
        trail: ["REEF-A", "REEF-B"],
        currentId: "REEF-001",
      });
      const onClose = renderDrilledInto("REEF-001");
      const overlay = document.querySelector('[data-slot="sheet-overlay"]');

      expect(overlay).not.toBeNull();
      await user.click(overlay as HTMLElement);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(useIssueNavStack.getState().trail).toEqual([]);
    });

    it("places Back and Close together in one top chrome row, Back before Close (REEF-284)", () => {
      useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-001" });
      renderDrilledInto("REEF-001");

      const back = screen.getByTestId("issue-drill-back");
      const close = screen.getByTestId("issue-close");

      // Both affordances live in the same chrome row (a shared ancestor that is
      // not the whole modal), so the history Back and the dismiss Close align on
      // one line instead of Back stacking as a strip above the header.
      const row = back.closest("div");
      expect(row).not.toBeNull();
      expect(row?.contains(close)).toBe(true);

      // Back leads (left), Close follows (right, pushed by ml-auto).
      expect(
        back.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  // The 1440px default leaves a comfortable editor beside the 400px property
  // rail, and `overscroll-contain` stops a scroll at the sheet edge from
  // chaining to the page behind it.
  it("renders a widened, overscroll-contained canvas", () => {
    setViewportWidth(1920);
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));

    const content = document.querySelector('[data-slot="sheet-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain("issue-detail-sheet");
    expect(content?.getAttribute("style")).toContain(
      "--issue-detail-width: 1440px",
    );
    expect(content?.className).toContain("overscroll-contain");
  });

  it("clamps resize values to the desktop bounds", () => {
    const maxWidth = getIssueDetailMaxWidth(1920);
    expect(clampIssueDetailWidth(1, maxWidth)).toBe(ISSUE_DETAIL_MIN_WIDTH);
    expect(clampIssueDetailWidth(Number.POSITIVE_INFINITY, maxWidth)).toBe(
      ISSUE_DETAIL_DEFAULT_WIDTH,
    );
    expect(clampIssueDetailWidth(10_000, maxWidth)).toBe(maxWidth);
  });

  describe("desktop splitter", () => {
    function renderDesktop(locale: Locale = "en") {
      setViewportWidth(1920);
      mockUseActiveVault.mockReturnValue({
        vault: "reef-acme",
        isLoading: false,
        refetch: () => Promise.resolve(),
      });
      return render(
        wrap(
          <IssueDetailSheet issueId="REEF-001" onClose={() => {}} />,
          locale,
        ),
      );
    }

    it("exposes the separator contract and controls the detail panel", () => {
      renderDesktop();

      const splitter = screen.getByRole("separator", {
        name: "Resize issue detail panel",
      });
      expect(splitter).toHaveAttribute("aria-orientation", "vertical");
      expect(splitter).toHaveAttribute("aria-valuemin", "1200");
      expect(splitter).toHaveAttribute(
        "aria-valuemax",
        String(getIssueDetailMaxWidth(1920)),
      );
      expect(splitter).toHaveAttribute("aria-valuenow", "1440");
      expect(splitter).toHaveAttribute("aria-valuetext", "1440px");
      expect(splitter).toHaveAttribute("aria-controls", "issue-detail-panel");
      expect(splitter).toHaveAttribute(
        "aria-describedby",
        "issue-detail-resize-description",
      );
      expect(
        document.getElementById("issue-detail-resize-description"),
      ).toHaveTextContent(
        "Vertical separator controls the issue detail panel. Current width 1440px; minimum 1200px; maximum 1680px.",
      );
      expect(document.getElementById("issue-detail-panel")).toHaveAttribute(
        "role",
        "region",
      );
      expect(document.getElementById("issue-detail-panel")).toContainElement(
        screen.getByTestId("issue-detail-chrome"),
      );
    });

    it("changes width with the W3C keyboard contract and persists each value", async () => {
      const user = userEvent.setup();
      renderDesktop();
      const splitter = screen.getByRole("separator");

      splitter.focus();
      await user.keyboard("{ArrowLeft}");
      expect(splitter).toHaveAttribute(
        "aria-valuenow",
        String(ISSUE_DETAIL_DEFAULT_WIDTH + ISSUE_DETAIL_KEYBOARD_STEP),
      );
      await user.keyboard("{ArrowRight}");
      expect(splitter).toHaveAttribute(
        "aria-valuenow",
        String(ISSUE_DETAIL_DEFAULT_WIDTH),
      );
      await user.keyboard("{Home}");
      expect(splitter).toHaveAttribute(
        "aria-valuenow",
        String(ISSUE_DETAIL_MIN_WIDTH),
      );
      await user.keyboard("{End}");
      const maxWidth = getIssueDetailMaxWidth(1920);
      expect(splitter).toHaveAttribute("aria-valuenow", String(maxWidth));
      expect(sessionStorage.getItem(ISSUE_DETAIL_SESSION_STORAGE_KEY)).toBe(
        JSON.stringify(maxWidth),
      );
      expect(document.activeElement).toBe(splitter);
    });

    it("captures pointer drags and releases the capture at the end", () => {
      renderDesktop();
      const splitter = screen.getByRole("separator");
      const setPointerCapture = vi.spyOn(splitter, "setPointerCapture");
      const releasePointerCapture = vi.spyOn(splitter, "releasePointerCapture");
      vi.spyOn(splitter, "hasPointerCapture").mockReturnValue(true);

      fireEvent.pointerDown(splitter, {
        button: 0,
        clientX: 300,
        pointerId: 7,
      });
      expect(setPointerCapture).toHaveBeenCalledWith(7);
      expect(splitter).toHaveAttribute("data-resizing", "true");

      fireEvent.pointerMove(splitter, {
        clientX: 200,
        pointerId: 7,
      });
      expect(splitter).toHaveAttribute("aria-valuenow", "1540");

      fireEvent.pointerUp(splitter, { pointerId: 7 });
      expect(releasePointerCapture).toHaveBeenCalledWith(7);
      expect(splitter).toHaveAttribute("data-resizing", "false");
    });

    it("restores a valid session width and falls back from corrupt storage", async () => {
      sessionStorage.setItem(ISSUE_DETAIL_SESSION_STORAGE_KEY, "1288");
      const first = renderDesktop();
      const splitter = screen.getByRole("separator");
      await waitFor(() =>
        expect(splitter).toHaveAttribute("aria-valuenow", "1288"),
      );

      first.rerender(
        wrap(<IssueDetailSheet issueId="REEF-002" onClose={() => {}} />),
      );
      await waitFor(() =>
        expect(screen.getByRole("separator")).toHaveAttribute(
          "aria-valuenow",
          "1288",
        ),
      );

      first.unmount();
      sessionStorage.setItem(ISSUE_DETAIL_SESSION_STORAGE_KEY, "not-json");
      renderDesktop();
      await waitFor(() =>
        expect(screen.getByRole("separator")).toHaveAttribute(
          "aria-valuenow",
          String(ISSUE_DETAIL_DEFAULT_WIDTH),
        ),
      );
    });

    it("expands to the viewport maximum and restores the previous width", async () => {
      const user = userEvent.setup();
      renderDesktop();
      const splitter = screen.getByRole("separator");

      splitter.focus();
      await user.keyboard("{ArrowLeft}");
      const normalWidth =
        ISSUE_DETAIL_DEFAULT_WIDTH + ISSUE_DETAIL_KEYBOARD_STEP;
      const expand = screen.getByRole("button", {
        name: "Expand issue detail panel to maximum width",
      });

      await user.click(expand);

      const maxWidth = getIssueDetailMaxWidth(1920);
      expect(splitter).toHaveAttribute("aria-valuenow", String(maxWidth));
      expect(expand).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("button", {
          name: "Restore issue detail panel width",
        }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(sessionStorage.getItem(ISSUE_DETAIL_SESSION_STORAGE_KEY)).toBe(
        JSON.stringify(normalWidth),
      );
      expect(
        sessionStorage.getItem(ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY),
      ).toBe("true");
      expect(
        sessionStorage.getItem(ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY),
      ).toBe(JSON.stringify(normalWidth));

      await user.click(
        screen.getByRole("button", {
          name: "Restore issue detail panel width",
        }),
      );

      expect(splitter).toHaveAttribute("aria-valuenow", String(normalWidth));
      expect(
        screen.getByRole("button", {
          name: "Expand issue detail panel to maximum width",
        }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(
        sessionStorage.getItem(ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY),
      ).toBe("false");
      expect(
        sessionStorage.getItem(ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY),
      ).toBeNull();
    });

    it.each([
      ["missing", null],
      ["non-numeric", JSON.stringify("not-a-number")],
    ])(
      "uses the default width when the restore snapshot is %s",
      async (_label, raw) => {
        const user = userEvent.setup();
        sessionStorage.setItem(
          ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY,
          "true",
        );
        if (raw !== null) {
          sessionStorage.setItem(
            ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY,
            raw,
          );
        }
        renderDesktop();
        const splitter = screen.getByRole("separator");
        await waitFor(() =>
          expect(splitter).toHaveAttribute(
            "aria-valuenow",
            String(getIssueDetailMaxWidth(1920)),
          ),
        );

        await user.click(
          screen.getByRole("button", {
            name: "Restore issue detail panel width",
          }),
        );

        expect(splitter).toHaveAttribute(
          "aria-valuenow",
          String(ISSUE_DETAIL_DEFAULT_WIDTH),
        );
        expect(
          screen.getByRole("button", {
            name: "Expand issue detail panel to maximum width",
          }),
        ).toHaveAttribute("aria-pressed", "false");
      },
    );

    it("exits expanded mode when the splitter is adjusted by keyboard", async () => {
      const user = userEvent.setup();
      renderDesktop();
      const splitter = screen.getByRole("separator");
      const expand = screen.getByRole("button", {
        name: "Expand issue detail panel to maximum width",
      });

      await user.click(expand);
      splitter.focus();
      await user.keyboard("{ArrowRight}");

      const adjustedWidth =
        getIssueDetailMaxWidth(1920) - ISSUE_DETAIL_KEYBOARD_STEP;
      expect(splitter).toHaveAttribute("aria-valuenow", String(adjustedWidth));
      expect(
        screen.getByRole("button", {
          name: "Expand issue detail panel to maximum width",
        }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(sessionStorage.getItem(ISSUE_DETAIL_SESSION_STORAGE_KEY)).toBe(
        JSON.stringify(adjustedWidth),
      );
      expect(
        sessionStorage.getItem(ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY),
      ).toBeNull();

      await user.click(
        screen.getByRole("button", {
          name: "Expand issue detail panel to maximum width",
        }),
      );
      await user.click(
        screen.getByRole("button", {
          name: "Restore issue detail panel width",
        }),
      );
      expect(splitter).toHaveAttribute("aria-valuenow", String(adjustedWidth));
    });

    it("exits expanded mode when the splitter is adjusted by pointer", async () => {
      const user = userEvent.setup();
      renderDesktop();
      const splitter = screen.getByRole("separator");

      await user.click(
        screen.getByRole("button", {
          name: "Expand issue detail panel to maximum width",
        }),
      );
      fireEvent.pointerDown(splitter, {
        button: 0,
        clientX: 300,
        pointerId: 9,
      });
      fireEvent.pointerMove(splitter, {
        clientX: 340,
        pointerId: 9,
      });
      fireEvent.pointerUp(splitter, { pointerId: 9 });

      expect(splitter).toHaveAttribute(
        "aria-valuenow",
        String(getIssueDetailMaxWidth(1920) - 40),
      );
      expect(
        screen.getByRole("button", {
          name: "Expand issue detail panel to maximum width",
        }),
      ).toHaveAttribute("aria-pressed", "false");
    });

    it("restores expanded state across issue navigation and exposes the translated focus ring", async () => {
      const user = userEvent.setup();
      sessionStorage.setItem(ISSUE_DETAIL_SESSION_STORAGE_KEY, "1288");
      sessionStorage.setItem(ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY, "true");
      sessionStorage.setItem(
        ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY,
        "1320",
      );
      const first = renderDesktop("ko");
      const splitter = screen.getByRole("separator");
      await waitFor(() =>
        expect(splitter).toHaveAttribute(
          "aria-valuenow",
          String(getIssueDetailMaxWidth(1920)),
        ),
      );
      const toggle = screen.getByRole("button", {
        name: "이슈 상세 패널 너비 복원",
      });
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(toggle.className).toContain("focus-visible:ring-2");

      first.rerender(
        wrap(<IssueDetailSheet issueId="REEF-002" onClose={() => {}} />, "ko"),
      );
      await waitFor(() =>
        expect(screen.getByRole("separator")).toHaveAttribute(
          "aria-valuenow",
          String(getIssueDetailMaxWidth(1920)),
        ),
      );
      expect(
        screen.getByRole("button", { name: "이슈 상세 패널 너비 복원" }),
      ).toHaveAttribute("aria-pressed", "true");

      first.unmount();
      renderDesktop("ko");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "이슈 상세 패널 너비 복원" }),
        ).toHaveAttribute("aria-pressed", "true"),
      );
      await user.click(
        screen.getByRole("button", { name: "이슈 상세 패널 너비 복원" }),
      );
      expect(screen.getByRole("separator")).toHaveAttribute(
        "aria-valuenow",
        "1320",
      );
    });

    it("omits the splitter below the desktop breakpoint", () => {
      setViewportWidth(1279);
      mockUseActiveVault.mockReturnValue({
        vault: "reef-acme",
        isLoading: false,
        refetch: () => Promise.resolve(),
      });
      render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));

      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("issue-detail-width-toggle"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("issue-close")).toBeVisible();
      const sheet = document.querySelector('[data-slot="sheet-content"]');
      expect(sheet?.getAttribute("style")).toContain(
        "width: min(94vw, var(--issue-detail-width-default))",
      );
    });
  });
});

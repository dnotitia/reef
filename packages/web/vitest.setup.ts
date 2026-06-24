import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";

expect.extend(matchers);

// Field labels are locale-resolved through next-intl (REEF-292). For the broad
// component suite we resolve them to the en base directly — the same English
// strings these tests already assert — so a leaf rendering a status/priority
// label does not need a NextIntlClientProvider wrapper in every test. The real
// locale-aware path (en/ko + missing-key fallback) is covered by the dedicated
// `src/i18n/fieldLabels.test.tsx` (which `vi.unmock`s this) and the hermetic
// `i18n-locale` Playwright spec. The en maps come straight from the core
// catalog, so this stays in sync with the source of truth automatically; add a
// line here when a new field-label hook is added to `@/i18n/fieldLabels`.
vi.mock("@/i18n/fieldLabels", async () => {
  const { ISSUE_FIELD_MESSAGES_EN } =
    await vi.importActual<typeof import("@reef/core/fields")>(
      "@reef/core/fields",
    );
  const { PLANNING_FIELD_MESSAGES_EN } = await vi.importActual<
    typeof import("@reef/core/fields/planning")
  >("@reef/core/fields/planning");
  // Enrichment empty-state labels live in the web `enrichment` catalog
  // (REEF-299), so resolve them from the en base directly; field-NAME labels
  // resolve from the core `fields.name` group (`f.name`, REEF-301) below.
  const enModule = await vi.importActual<{ default: Record<string, unknown> }>(
    "@/i18n/messages/en.json",
  );
  const en = enModule.default;
  const f = ISSUE_FIELD_MESSAGES_EN;
  const p = PLANNING_FIELD_MESSAGES_EN;
  return {
    useEnrichmentEmptyLabels: () => en.enrichment,
    useStatusLabels: () => f.status,
    usePriorityLabels: () => f.priority,
    useIssueTypeLabels: () => f.issueType,
    useSeverityLabels: () => f.severity,
    useFieldNameLabels: () => f.name,
    useClosedReasonLabels: () => f.closedReason,
    useClosedReasonHints: () => f.closedReasonHint,
    useDueLabels: () => f.due,
    useDependencyLabels: () => f.dependency,
    useSortFieldLabels: () => f.sortField,
    useDirectionLabel:
      () => (field: keyof typeof f.sortDirection, order: "asc" | "desc") =>
        f.sortDirection[field][order],
    usePlanningKindLabels: () => p.kind,
    usePlanningKindSingularLabels: () => p.kindSingular,
    useSprintStatusLabels: () => p.sprintStatus,
    useMilestoneStatusLabels: () => p.milestoneStatus,
    useReleaseStatusLabels: () => p.releaseStatus,
  };
});

// The app mounts a single `NextIntlClientProvider` at the root, so locale-aware
// formatters (`useLocale()` for date / relative-time rendering, REEF-294) always
// have a provider in production. Unit tests render components in isolation
// without that root, so default `useLocale()` to the base locale (`en`) here
// rather than re-mounting the provider in every test. Everything else in
// next-intl stays real; a test that needs a specific locale still wraps in
// `NextIntlClientProvider`. Locale-formatting behavior itself is covered by the
// pure dateHelpers / relative-time unit tests and the hermetic i18n E2E spec.
vi.mock("next-intl", async (importActual) => {
  const actual = await importActual<typeof import("next-intl")>();
  // The en base catalog, loaded once for the provider-less fallback below.
  const { loadMessages } =
    await vi.importActual<typeof import("@/i18n/messages")>("@/i18n/messages");
  const enMessages = loadMessages("en");
  return {
    ...actual,
    // Use the provider's locale when a test wraps the tree (e.g. REEF-293's
    // `IntlTestProvider locale="ko"`); fall back to the base locale for bare
    // renders that have no provider, so locale-aware date/relative-time
    // components don't throw "No intl context found".
    useLocale: () => {
      try {
        return actual.useLocale();
      } catch {
        return "en";
      }
    },
    // Same fallback for `useTranslations` (REEF-299): a component that calls it
    // (e.g. a toast handler) should render in a bare test without "No intl
    // context found". When a provider IS present the real hook wins (so a
    // `IntlTestProvider locale="ko"` test still asserts the translated surface);
    // otherwise resolve against the en base via the non-hook `createTranslator`,
    // mirroring the production request config (messages + formats + UTC).
    useTranslations: ((namespace?: string) => {
      try {
        return actual.useTranslations(namespace as never);
      } catch {
        return actual.createTranslator({
          locale: "en",
          messages: enMessages,
          timeZone: "UTC",
          namespace: namespace as never,
        });
      }
    }) as typeof actual.useTranslations,
  };
});

// jsdom does not implement ResizeObserver, but cmdk (and any other library
// using Radix-style virtualization or measuring) calls `new ResizeObserver`
// at mount. A no-op shim is sufficient — tests don't depend on layout
// callbacks firing.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement matchMedia, but auto-animate (board/list layout
// transitions) queries `prefers-reduced-motion` at mount, and the theme code
// queries `prefers-color-scheme`. A no-op shim reporting no match is enough —
// reduced-motion defaults to "not reduced" under test. Tests that need a
// specific media result still override window.matchMedia themselves.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom doesn't implement Element.prototype.scrollIntoView, but cmdk calls
// it when the active item changes. Shim it as a no-op so the command palette
// can mount and update under test.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom does not implement the Web Animations API, but auto-animate calls
// `el.animate(...)` from its MutationObserver callback to run board/list layout
// transitions. A stub that exposes the surface auto-animate touches (finished,
// cancel, play, the "finish" event) lets components mount and update without a
// real animation; the transition itself is verified visually, not under jsdom.
if (typeof Element !== "undefined" && !Element.prototype.animate) {
  Element.prototype.animate = function animate() {
    const finishListeners: Array<() => void> = [];
    const anim = {
      finished: Promise.resolve(),
      onfinish: null as (() => void) | null,
      oncancel: null,
      cancel() {},
      finish() {},
      play() {},
      pause() {},
      addEventListener(type: string, cb: () => void) {
        if (type === "finish") finishListeners.push(cb);
      },
      removeEventListener() {},
    };
    // auto-animate cleans up nodes it temporarily re-inserts for removal
    // animations on the "finish" event. Fire it on a microtask so that cleanup
    // actually runs under test instead of leaving stale DOM behind. Listeners
    // are bound thunks that ignore the event arg, so calling them bare is fine.
    queueMicrotask(() => {
      anim.onfinish?.();
      for (const cb of finishListeners) cb();
    });
    return anim as unknown as Animation;
  };
}

// jsdom does not implement pointer capture APIs, but Radix Select checks them
// while handling pointer interactions. No-op shims let tests exercise the
// normal click path without depending on browser-level pointer capture.
if (typeof Element !== "undefined" && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
}
if (typeof Element !== "undefined" && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {};
}
if (
  typeof Element !== "undefined" &&
  !Element.prototype.releasePointerCapture
) {
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
}

// Automatic cleanup after each test
afterEach(() => {
  cleanup();
  if (typeof document !== "undefined") {
    document.body.style.pointerEvents = "";
    document.body.removeAttribute("data-scroll-locked");
  }
});

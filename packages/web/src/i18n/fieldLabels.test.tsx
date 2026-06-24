// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// This spec exercises the REAL locale-aware hooks, so opt out of the global
// en-resolving mock that `vitest.setup.ts` installs for the broad component
// suite.
vi.unmock("@/i18n/fieldLabels");
import {
  useClosedReasonHints,
  useDirectionLabel,
  usePriorityLabels,
  useSprintStatusLabels,
  useStatusLabels,
} from "./fieldLabels";
import type { Locale } from "./locales";
import { loadMessages } from "./messages";

/**
 * Resolve the hooks through the real next-intl provider with the merged catalog
 * for `locale`, exercising the production lookup path (core key → active-locale
 * string) rather than a stub.
 */
function withLocale(locale: Locale) {
  const messages = loadMessages(locale);
  return ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("field label hooks (REEF-292)", () => {
  it("resolves issue-field labels against the en base", () => {
    const { result } = renderHook(() => useStatusLabels(), {
      wrapper: withLocale("en"),
    });
    expect(result.current.todo).toBe("Todo");
    expect(result.current.in_progress).toBe("In Progress");
  });

  it("resolves issue-field labels in the active locale (AC1)", () => {
    const status = renderHook(() => useStatusLabels(), {
      wrapper: withLocale("ko"),
    });
    expect(status.result.current.todo).toBe("할 일");
    expect(status.result.current.in_progress).toBe("진행 중");

    const priority = renderHook(() => usePriorityLabels(), {
      wrapper: withLocale("ko"),
    });
    expect(priority.result.current.critical).toBe("긴급");
  });

  it("resolves the natural-language direction label per field and order", () => {
    const en = renderHook(() => useDirectionLabel(), {
      wrapper: withLocale("en"),
    });
    expect(en.result.current("priority", "desc")).toBe("High → Low");
    expect(en.result.current("due_date", "asc")).toBe("Soonest");

    const ko = renderHook(() => useDirectionLabel(), {
      wrapper: withLocale("ko"),
    });
    expect(ko.result.current("priority", "desc")).toBe("높음 → 낮음");
  });

  it("resolves closed-reason hints and planning labels in the active locale", () => {
    const hints = renderHook(() => useClosedReasonHints(), {
      wrapper: withLocale("ko"),
    });
    expect(hints.result.current.completed).toBe(
      "작업이 완료되어 승인되었습니다.",
    );

    const sprint = renderHook(() => useSprintStatusLabels(), {
      wrapper: withLocale("ko"),
    });
    expect(sprint.result.current.active).toBe("진행 중");
  });
});

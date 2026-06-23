// @vitest-environment jsdom

import type { Locale } from "@/i18n/locales";
import en from "@/i18n/messages/en.json";
import ko from "@/i18n/messages/ko.json";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drive the locale preference directly so the component test is isolated from
// the store / next-intl provider locale (the active locale is the provider's;
// here we only assert the switcher's render + click contract).
const setLocaleMock = vi.fn(async () => {});
const localeRef = { current: "en" as Locale };
vi.mock("../hooks/useLocalePreference", () => ({
  useLocalePreference: () => ({
    locale: localeRef.current,
    setLocale: setLocaleMock,
  }),
}));

import { LanguageSection } from "./LanguageSection";

function renderWithMessages(locale: Locale, node: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ko" ? ko : en}
    >
      {node}
    </NextIntlClientProvider>,
  );
}

describe("LanguageSection", () => {
  beforeEach(() => {
    setLocaleMock.mockClear();
    localeRef.current = "en";
  });
  afterEach(() => {
    localeRef.current = "en";
  });

  it("renders an option per supported locale, labeled by endonym", () => {
    renderWithMessages("en", <LanguageSection />);
    expect(screen.getByTestId("locale-option-en")).toHaveTextContent("English");
    expect(screen.getByTestId("locale-option-ko")).toHaveTextContent("한국어");
  });

  it("resolves its heading through the provider's en catalog (AC3)", () => {
    renderWithMessages("en", <LanguageSection />);
    expect(
      screen.getByRole("heading", { name: "Language", level: 3 }),
    ).toBeInTheDocument();
  });

  it("resolves its heading through the provider's ko catalog when active (AC3)", () => {
    renderWithMessages("ko", <LanguageSection />);
    expect(
      screen.getByRole("heading", { name: "언어", level: 3 }),
    ).toBeInTheDocument();
  });

  it("marks the active locale via aria-checked", () => {
    localeRef.current = "ko";
    renderWithMessages("ko", <LanguageSection />);
    expect(screen.getByTestId("locale-option-ko")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("locale-option-en")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls setLocale with the clicked locale", async () => {
    renderWithMessages("en", <LanguageSection />);
    fireEvent.click(screen.getByTestId("locale-option-ko"));
    await waitFor(() => expect(setLocaleMock).toHaveBeenCalledWith("ko"));
  });
});

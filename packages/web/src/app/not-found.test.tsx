import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "./not-found";

describe("app/not-found", () => {
  it("renders the English catalog copy and one safe home action", () => {
    render(
      <IntlTestProvider>
        <NotFound />
      </IntlTestProvider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The page you’re looking for doesn’t exist or may have moved.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to reef home" }),
    ).toHaveAttribute("href", "/");
    expect(
      screen.queryByText("This page could not be found."),
    ).not.toBeInTheDocument();
  });

  it("renders the same information architecture from the Korean catalog", () => {
    render(
      <IntlTestProvider locale="ko">
        <NotFound />
      </IntlTestProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "페이지를 찾을 수 없습니다",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "찾으시는 페이지가 없거나 다른 위치로 이동했을 수 있습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "reef 홈으로 이동" }),
    ).toHaveAttribute("href", "/");
  });
});

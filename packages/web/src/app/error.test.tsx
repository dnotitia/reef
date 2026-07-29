import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "./error";

describe("app/error", () => {
  it("offers Next.js retry and safe home without exposing error internals", async () => {
    const user = userEvent.setup();
    const unstableRetry = vi.fn();
    const error = Object.assign(new Error("private upstream response"), {
      digest: "private-digest",
    });

    render(
      <IntlTestProvider>
        <ErrorPage error={error} unstable_retry={unstableRetry} />
      </IntlTestProvider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "We couldn’t load this page. Try again, or return home to continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
    expect(screen.queryByText(error.digest)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(unstableRetry).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: "Go to reef home" }),
    ).toHaveAttribute("href", "/");
  });

  it("localizes both recovery actions in Korean", () => {
    render(
      <IntlTestProvider locale="ko">
        <ErrorPage error={new Error("hidden")} unstable_retry={vi.fn()} />
      </IntlTestProvider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "문제가 발생했습니다" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "다시 시도" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "reef 홈으로 이동" }),
    ).toHaveAttribute("href", "/");
  });
});

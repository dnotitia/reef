import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { Locale } from "@/i18n/locales";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { linkSafetyConfig } from "./linkSafety";

const URL = "https://github.com/dnotitia/reef/pull/103";

function renderModal(
  overrides: Partial<{
    url: string;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
  }> = {},
  locale: Locale = "en",
) {
  const props = {
    url: URL,
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(
    <IntlTestProvider locale={locale}>
      {linkSafetyConfig.renderModal?.(props)}
    </IntlTestProvider>,
  );
  return props;
}

describe("linkSafetyConfig", () => {
  // The fix's contract: link safety stays enabled (we keep the confirmation UX),
  // and the modal is rendered by our portaled Dialog instead of Streamdown's
  // inline overlay that nested a <div>/<p> inside the markdown <p>.
  it("keeps link safety enabled and renders through a custom modal", () => {
    expect(linkSafetyConfig.enabled).toBe(true);
    expect(linkSafetyConfig.renderModal).toBeTypeOf("function");
  });

  it("shows the destination URL, title, and warning when open", () => {
    renderModal();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /open external link/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/about to leave reef/i)).toBeInTheDocument();

    const urlNode = screen.getByText(URL);
    expect(urlNode).toBeInTheDocument();
    // URLs are protected from browser translation, following the id convention.
    expect(urlNode).toHaveAttribute("translate", "no");
  });

  it("renders nothing while closed so no modal can nest inside the paragraph", () => {
    renderModal({ isOpen: false });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(URL)).not.toBeInTheDocument();
  });

  it("opens the link (confirm) then dismisses on Open link", () => {
    const { onConfirm, onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Open link" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses without opening the link on Cancel", () => {
    const { onConfirm, onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("copies the full URL to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it("renders the Korean copy under the ko catalog", () => {
    renderModal({}, "ko");

    expect(
      screen.getByRole("heading", { name: "외부 링크 열기" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "링크 열기" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
  });
});

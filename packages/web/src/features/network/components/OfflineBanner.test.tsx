// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfflineBanner } from "./OfflineBanner";

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("OfflineBanner", () => {
  beforeEach(() => {
    setOnLine(true);
  });

  afterEach(() => {
    setOnLine(true);
  });

  it("renders nothing when the browser is online", () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("renders a polite live region with copy when offline", () => {
    setOnLine(false);
    render(<OfflineBanner />);
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveTextContent(/offline/i);
    expect(banner).toHaveTextContent(/cached data/i);
  });

  it("appears when the browser dispatches an 'offline' event", () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });

  it("disappears again on 'online'", () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });
});

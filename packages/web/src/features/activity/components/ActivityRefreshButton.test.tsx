import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { Locale } from "@/i18n/locales";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityRefreshButton } from "./ActivityRefreshButton";

const getLastScanAt = vi.fn<(repo: string) => Promise<string | undefined>>();

vi.mock("@/lib/storage/lastScan", () => ({
  getLastScanAt: (repo: string) => getLastScanAt(repo),
}));

function renderButton(locale: Locale) {
  return render(
    <IntlTestProvider locale={locale}>
      <ActivityRefreshButton
        repo="acme/widgets"
        onRefresh={() => {}}
        isScanning={false}
      />
    </IntlTestProvider>,
  );
}

describe("ActivityRefreshButton last-scan label", () => {
  beforeEach(() => {
    // Five minutes before "now" so the compact relative label renders "5m ago"
    // / "5분 전" regardless of the few-ms gap between this setup and mount.
    getLastScanAt.mockResolvedValue(
      new Date(Date.now() - 5 * 60_000).toISOString(),
    );
  });

  afterEach(() => {
    getLastScanAt.mockReset();
  });

  it("renders the relative time in the active locale (ko)", async () => {
    renderButton("ko");
    const label = await screen.findByTestId("activity-last-scan");
    // AC1: the staleness label follows the Korean locale.
    expect(label).toHaveTextContent("5분 전");
    // AC2: no leftover English reimplementation leaks through.
    expect(label).not.toHaveTextContent(/ago/);
  });

  it("still renders English for the en locale", async () => {
    renderButton("en");
    const label = await screen.findByTestId("activity-last-scan");
    expect(label).toHaveTextContent("5m ago");
  });

  it("hides the label until a scan timestamp exists", async () => {
    getLastScanAt.mockResolvedValue(undefined);
    renderButton("ko");
    // The refresh button mounts immediately; the label stays absent.
    await screen.findByTestId("activity-refresh");
    expect(screen.queryByTestId("activity-last-scan")).toBeNull();
  });
});

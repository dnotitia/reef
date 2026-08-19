// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueBodyHistoryKey,
  useIssueBodyHistory,
} from "./useIssueBodyHistory";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("useIssueBodyHistory", () => {
  it("loads the separate history route", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          history: [
            {
              id: "body-update:c1",
              hash: "c1",
              at: "2026-08-18T01:00:00.000Z",
              actor: "alice",
              kind: "body_update",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(
      () => useIssueBodyHistory("REEF-127", "reef-sample"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/REEF-127/history?vault=reef-sample",
      expect.anything(),
    );
    expect(issueBodyHistoryKey("reef-sample", "REEF-127")).toEqual([
      "issues",
      "body-history",
      "reef-sample",
      "REEF-127",
    ]);
  });
});

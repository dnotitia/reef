import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  notFound,
}));

import LegacyWorkspaceActivityPage from "./page";

describe("workspace Activity compatibility route", () => {
  beforeEach(() => {
    redirect.mockClear();
    notFound.mockClear();
  });

  it("redirects to Suggestions while preserving repeated and empty query values", async () => {
    await LegacyWorkspaceActivityPage({
      params: Promise.resolve({ vault: "reef-acme" }),
      searchParams: Promise.resolve({
        tag: ["a", "b"],
        empty: "",
      }),
    });

    expect(redirect).toHaveBeenCalledWith(
      "/workspace/reef-acme/suggestions?tag=a&tag=b&empty=",
    );
  });
});

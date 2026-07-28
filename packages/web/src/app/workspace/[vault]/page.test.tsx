import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  notFound,
}));

import VaultWorkspaceRootPage from "./page";

describe("vault workspace root page (REEF-424)", () => {
  beforeEach(() => {
    redirect.mockClear();
    notFound.mockClear();
  });

  it("redirects to the same vault's Issues surface", async () => {
    await VaultWorkspaceRootPage({
      params: Promise.resolve({ vault: "reef-acme" }),
      searchParams: Promise.resolve({}),
    });

    expect(redirect).toHaveBeenCalledWith("/workspace/reef-acme/issues");
  });

  it("preserves single, repeated, and empty query values", async () => {
    await VaultWorkspaceRootPage({
      params: Promise.resolve({ vault: "reef-acme" }),
      searchParams: Promise.resolve({
        view: "list",
        label: ["a", "b"],
        empty: "",
      }),
    });

    expect(redirect).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues?view=list&label=a&label=b&empty=",
    );
  });

  it("omits undefined query values", async () => {
    await VaultWorkspaceRootPage({
      params: Promise.resolve({ vault: "reef-acme" }),
      searchParams: Promise.resolve({ view: undefined, status: "todo" }),
    });

    expect(redirect).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues?status=todo",
    );
  });

  it("404s a malformed vault before constructing a redirect", async () => {
    await expect(
      VaultWorkspaceRootPage({
        params: Promise.resolve({ vault: "Bad_Vault" }),
        searchParams: Promise.resolve({ view: "list" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { useAskAiStore } from "./useAskAiStore";

describe("useAskAiStore", () => {
  beforeEach(() => {
    useAskAiStore.setState({ isOpen: false, seenMessageCount: 0 });
  });

  it("starts closed with zero seen messages", () => {
    expect(useAskAiStore.getState().isOpen).toBe(false);
    expect(useAskAiStore.getState().seenMessageCount).toBe(0);
  });

  it("open() and close() flip isOpen", () => {
    useAskAiStore.getState().open();
    expect(useAskAiStore.getState().isOpen).toBe(true);
    useAskAiStore.getState().close();
    expect(useAskAiStore.getState().isOpen).toBe(false);
  });

  it("toggle() flips isOpen back and forth", () => {
    expect(useAskAiStore.getState().isOpen).toBe(false);
    useAskAiStore.getState().toggle();
    expect(useAskAiStore.getState().isOpen).toBe(true);
    useAskAiStore.getState().toggle();
    expect(useAskAiStore.getState().isOpen).toBe(false);
  });

  it("markSeen() updates seenMessageCount", () => {
    useAskAiStore.getState().markSeen(5);
    expect(useAskAiStore.getState().seenMessageCount).toBe(5);
    useAskAiStore.getState().markSeen(7);
    expect(useAskAiStore.getState().seenMessageCount).toBe(7);
  });
});

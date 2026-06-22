// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { useIssueNavStack } from "./useIssueNavStack";

afterEach(() => {
  useIssueNavStack.setState({ trail: [], currentId: null });
});

describe("useIssueNavStack (REEF-270)", () => {
  it("drill pushes the issue left behind and tracks the target as current", () => {
    useIssueNavStack.getState().drill("REEF-A", "REEF-B");
    expect(useIssueNavStack.getState().trail).toEqual(["REEF-A"]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-B");

    useIssueNavStack.getState().drill("REEF-B", "REEF-C");
    expect(useIssueNavStack.getState().trail).toEqual(["REEF-A", "REEF-B"]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-C");
  });

  it("back unwinds one hop and returns the previous issue (A→B→C→back→B)", () => {
    const store = useIssueNavStack.getState();
    store.drill("REEF-A", "REEF-B");
    store.drill("REEF-B", "REEF-C");

    expect(useIssueNavStack.getState().back()).toBe("REEF-B");
    expect(useIssueNavStack.getState().trail).toEqual(["REEF-A"]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-B");

    expect(useIssueNavStack.getState().back()).toBe("REEF-A");
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-A");
  });

  it("back on an empty trail returns null and leaves state untouched", () => {
    useIssueNavStack.setState({ trail: [], currentId: "REEF-A" });
    expect(useIssueNavStack.getState().back()).toBeNull();
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-A");
  });

  it("reconcile keeps the trail when the id matches the expected current", () => {
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-B" });
    useIssueNavStack.getState().reconcile("REEF-B");
    expect(useIssueNavStack.getState().trail).toEqual(["REEF-A"]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-B");
  });

  it("reconcile resets to depth 0 when the id was reached some other way", () => {
    // Drilled into a trail, then a fresh open lands on an unrelated issue.
    useIssueNavStack.setState({
      trail: ["REEF-A", "REEF-B"],
      currentId: "REEF-C",
    });
    useIssueNavStack.getState().reconcile("REEF-Z");
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(useIssueNavStack.getState().currentId).toBe("REEF-Z");
  });

  it("clear empties the trail and current pointer", () => {
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-B" });
    useIssueNavStack.getState().clear();
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(useIssueNavStack.getState().currentId).toBeNull();
  });
});

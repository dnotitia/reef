import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ModalDefault from "./default";

afterEach(() => {
  useIssueNavStack.setState({ trail: [], currentId: null });
});

describe("ModalDefault (REEF-270 drill session boundary)", () => {
  it("clears the drill trail on mount (the list/backdrop is back)", () => {
    // Simulate a sheet left via browser Back without Close: a stale trail
    // lingers in the module store.
    useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-B" });

    render(<ModalDefault />);

    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(useIssueNavStack.getState().currentId).toBeNull();
  });

  it("renders nothing", () => {
    const { container } = render(<ModalDefault />);
    expect(container.firstChild).toBeNull();
  });
});

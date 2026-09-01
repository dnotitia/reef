import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptInputSubmit } from "./primitives";

describe("PromptInputSubmit", () => {
  it("does not cancel a run on the second click of a rapid activation", () => {
    const onStop = vi.fn();
    render(
      <PromptInputSubmit
        data-testid="prompt-submit"
        status="streaming"
        onStop={onStop}
      />,
    );

    fireEvent.click(screen.getByTestId("prompt-submit"), { detail: 2 });

    expect(onStop).not.toHaveBeenCalled();
  });

  it("stops on a single activation while generating", () => {
    const onStop = vi.fn();
    render(
      <PromptInputSubmit
        data-testid="prompt-submit"
        status="streaming"
        onStop={onStop}
      />,
    );

    fireEvent.click(screen.getByTestId("prompt-submit"), { detail: 1 });

    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

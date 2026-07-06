import type { ChatToolStep } from "@/features/ai/chat/chatTypes";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ToolStepTrace } from "./ToolStepTrace";

function render(ui: ReactElement) {
  return rtlRender(<IntlTestProvider>{ui}</IntlTestProvider>);
}

function step(overrides: Partial<ChatToolStep> = {}): ChatToolStep {
  return {
    toolCallId: "call-1",
    toolName: "search_issues",
    status: "completed",
    input: null,
    output: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("ToolStepTrace", () => {
  it("renders nothing when there are no steps", () => {
    render(<ToolStepTrace steps={[]} streaming={false} />);
    expect(screen.queryByTestId("chat-tool-trace")).toBeNull();
  });

  it("shows the live label for a running step while streaming", () => {
    render(
      <ToolStepTrace
        steps={[
          step({
            status: "running",
            input: { query: "login" },
            output: null,
          }),
        ]}
        streaming={true}
      />,
    );
    expect(screen.getByTestId("chat-tool-trace")).toBeInTheDocument();
    // While streaming the step rows are shown — the running step surfaces
    // its live "Searching issues…" label with no disclosure of its own.
    expect(screen.getByText(/Searching issues/)).toBeInTheDocument();
  });

  it("collapses settled steps under the header and reveals detail on expand", () => {
    render(
      <ToolStepTrace
        steps={[
          step({
            status: "completed",
            input: { query: "login" },
            output: {
              issues: [{ id: "REEF-1" }, { id: "REEF-2" }, { id: "REEF-3" }],
            },
          }),
        ]}
        streaming={false}
      />,
    );

    // Settled → rows collapsed; the header disclosure is present.
    expect(screen.queryByText("Searched issues")).not.toBeInTheDocument();

    // Expand the trace header to reveal the step history.
    fireEvent.click(screen.getByRole("button", { name: /step/i }));
    expect(screen.getByText("Searched issues")).toBeInTheDocument();
    expect(screen.getByText("3 results")).toBeInTheDocument();

    // The completed row is itself a disclosure; expanding it shows the tool name
    // and the summarized argument — not the raw payload.
    fireEvent.click(screen.getByRole("button", { name: /Searched issues/ }));
    expect(screen.getByText("search_issues")).toBeInTheDocument();
    expect(screen.getByText("login")).toBeInTheDocument();
  });

  it("renders an error step and reveals its message on expand", () => {
    render(
      <ToolStepTrace
        steps={[
          step({
            status: "error",
            input: { query: "login" },
            output: null,
            errorMessage: "boom",
          }),
        ]}
        streaming={false}
      />,
    );

    // Expand the header, then the error row.
    fireEvent.click(screen.getByRole("button", { name: /step/i }));
    const errorRow = screen.getByRole("button", { name: /Searched issues/ });
    expect(errorRow).toBeInTheDocument();
    fireEvent.click(errorRow);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

import { AgentArtifactSchema } from "@reef/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createInitialAgentRunState } from "../runtime/reducer";
import { ArtifactMetadata } from "./ArtifactMetadata";
import { ChatRunPresenter } from "./ChatRunPresenter";
import { ReviewActions } from "./ReviewActions";
import { RunStatusIndicator } from "./RunStatusIndicator";

const chatArtifact = AgentArtifactSchema.parse({
  artifact_id: "artifact-chat-1",
  run_id: "run-1",
  task_id: "chat.workspace",
  type: "chat_message",
  status: "pending",
  title: "Assistant reply",
  confidence: 0.92,
  reasoning: "Grounded in the workspace issue list.",
  evidence: [
    {
      type: "issue",
      ref: "REEF-045",
      label: "REEF-045",
      metadata: {},
    },
  ],
  warnings: ["Needs PM review before applying."],
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: null,
  metadata: {},
  payload: {
    message_id: "message-1",
    role: "assistant",
    text: "The run completed.",
    parts: [],
  },
});

describe("AI review components", () => {
  it("renders shared review actions and invokes handlers", async () => {
    const onApprove = vi.fn();
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(
      <ReviewActions
        actions={[
          { id: "approve", label: "Approve", onClick: onApprove },
          { id: "retry", label: "Retry", onClick: onRetry },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders common artifact confidence, reasoning, evidence, and warnings", () => {
    render(
      <ArtifactMetadata
        confidence={0.87}
        reasoning="The repository activity points to this change."
        evidence={[{ type: "pr", ref: "114", label: "PR 114", metadata: {} }]}
        warnings={["Review generated title before approving."]}
      />,
    );

    expect(screen.getByText("87% confidence")).toBeInTheDocument();
    expect(
      screen.getByText("The repository activity points to this change."),
    ).toBeInTheDocument();
    expect(screen.getByText("PR 114")).toBeInTheDocument();
    expect(
      screen.getByText("Review generated title before approving."),
    ).toBeInTheDocument();
  });

  it("renders safe evidence URLs as links and keeps unsafe URLs as text", () => {
    render(
      <ArtifactMetadata
        evidence={[
          {
            type: "pr",
            ref: "114",
            label: "PR 114",
            url: "https://github.com/acme/reef/pull/114",
            metadata: {},
          },
          {
            type: "url",
            label: "Unsafe reference",
            url: "javascript:alert(1)",
            metadata: {},
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "PR 114" })).toHaveAttribute(
      "href",
      "https://github.com/acme/reef/pull/114",
    );
    expect(
      screen.queryByRole("link", { name: "Unsafe reference" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Unsafe reference")).toBeInTheDocument();
  });

  it("shows run retry/cancel controls from common run state", async () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    const user = userEvent.setup();
    const running = {
      ...createInitialAgentRunState("chat.workspace"),
      phase: "running" as const,
      run_status: "running" as const,
    };
    const error = {
      ...running,
      phase: "error" as const,
      run_status: "error" as const,
      error: {
        kind: "stream" as const,
        code: "agent_run_stream_parse_error",
        message: "Stream ended early.",
        recoverable: true,
        details: {},
      },
    };

    const { rerender } = render(
      <RunStatusIndicator state={running} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(<RunStatusIndicator state={error} onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders chat stream text and final artifacts from AgentRunState", () => {
    const state = {
      ...createInitialAgentRunState("chat.workspace"),
      phase: "completed" as const,
      run_status: "completed" as const,
      text: "Streamed answer",
      artifact_order: [chatArtifact.artifact_id],
      artifact_ids: [chatArtifact.artifact_id],
      artifacts: { [chatArtifact.artifact_id]: chatArtifact },
    };

    render(<ChatRunPresenter state={state} />);

    expect(screen.getByTestId("chat-run-text")).toHaveTextContent(
      "Streamed answer",
    );
    expect(screen.getByTestId("artifact-list")).toBeInTheDocument();
    expect(screen.getByText("Assistant reply")).toBeInTheDocument();
    expect(screen.getByText("The run completed.")).toBeInTheDocument();
  });
});

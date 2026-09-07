import {
  ISSUE_READ_CALL_ID_PREFIX,
  NOW,
  TOOL_LOOP_E2E_PROMPT,
  TOOL_LOOP_SEARCH_DOCUMENTS_CALL_ID,
  TOOL_LOOP_SEARCH_ISSUES_CALL_ID,
} from "./mock-fixtures.mjs";
import { json, readJson, sleep } from "./mock-http.mjs";

export async function handleOpenRouter(req, res) {
  if (req.method === "POST") {
    const body = await readJson(req);
    if (body?.stream === true) {
      const created = Math.floor(new Date(NOW).getTime() / 1000);
      if (isToolLoopResultTurn(body)) {
        await streamOpenRouterChunks(res, finalToolLoopChunks(created), {
          delayBeforeTextDeltaMs: 250,
        });
        return;
      }
      if (isToolLoopPromptTurn(body)) {
        await streamOpenRouterChunks(res, initialToolLoopChunks(created), {
          delayAfterFunctionCallMs: 180,
        });
        return;
      }
      const issueQuestion = issueQuestionResult(body);
      if (issueQuestion) {
        await streamOpenRouterChunks(
          res,
          finalIssueQuestionChunks(created, issueQuestion.output),
          { delayBeforeTextDeltaMs: 250 },
        );
        return;
      }
      const issueId = issueQuestionId(body);
      if (issueId) {
        await streamOpenRouterChunks(
          res,
          initialIssueQuestionChunks(created, issueId),
          {
            delayAfterFunctionCallMs: 180,
          },
        );
        return;
      }
      await streamOpenRouterChunks(res, basicTextChunks(created, body));
      return;
    }
    return json(res, 200, {
      id: "chatcmpl-e2e",
      object: "chat.completion",
      created: Math.floor(new Date(NOW).getTime() / 1000),
      model: "e2e/mock-model",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: isEnrichmentRequest(body)
              ? JSON.stringify({
                  suggestions: [
                    {
                      field: "priority",
                      value: "high",
                      reasoning: "Authentication failures affect core access.",
                      confidence: 0.91,
                    },
                  ],
                  references: [],
                })
              : basicTextResponse(body),
          },
        },
      ],
    });
  }
  return json(res, 404, { error: "not_found" });
}

function isEnrichmentRequest(body) {
  return JSON.stringify(body?.messages ?? []).includes(
    "complete a new Reef issue draft",
  );
}

function basicTextChunks(created, body) {
  return [
    chatCompletionChunk("chatcmpl-e2e", created, { role: "assistant" }),
    chatCompletionChunk("chatcmpl-e2e", created, {
      content: basicTextResponse(body),
    }),
    chatCompletionChunk("chatcmpl-e2e", created, {}, "stop"),
  ];
}

function basicTextResponse(body) {
  const requestText = lastUserMessageText(body?.messages ?? body?.input);
  return `Mock OpenRouter response. Request: ${requestText || "(empty)"}`;
}

function lastUserMessageText(value) {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const text = lastUserMessageText(value[index]);
      if (text) return text;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  if (value.role === "user") {
    return messageContentText(value.content ?? value.parts);
  }
  const entries = Object.values(value);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const text = lastUserMessageText(entries[index]);
    if (text) return text;
  }
  return "";
}

function messageContentText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => messageContentText(part))
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text.trim();
  if (typeof value.content === "string") return value.content.trim();
  if (Array.isArray(value.content)) return messageContentText(value.content);
  if (Array.isArray(value.parts)) return messageContentText(value.parts);
  return "";
}

function initialToolLoopChunks(created) {
  return [
    chatCompletionChunk("chatcmpl-e2e-tools", created, {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: TOOL_LOOP_SEARCH_ISSUES_CALL_ID,
          type: "function",
          function: {
            name: "search_issues",
            arguments: JSON.stringify({
              query: "Initial issue Alpha",
              status: null,
              assigned_to: null,
              labels: null,
              limit: 3,
            }),
          },
        },
        {
          index: 1,
          id: TOOL_LOOP_SEARCH_DOCUMENTS_CALL_ID,
          type: "function",
          function: {
            name: "search_documents",
            arguments: JSON.stringify({
              query: "Spec overview",
              limit: 3,
            }),
          },
        },
      ],
    }),
    chatCompletionChunk("chatcmpl-e2e-tools", created, {}, "tool_calls"),
  ];
}

function finalToolLoopChunks(created) {
  const text =
    "I found REEF-001 from the issue search and the Spec overview document as supporting context.";
  return [
    chatCompletionChunk("chatcmpl-e2e-tools-final", created, {
      role: "assistant",
    }),
    chatCompletionChunk("chatcmpl-e2e-tools-final", created, {
      content: text,
    }),
    chatCompletionChunk("chatcmpl-e2e-tools-final", created, {}, "stop"),
  ];
}

function initialIssueQuestionChunks(created, issueId) {
  const callId = issueReadCallId(issueId);
  return [
    chatCompletionChunk(`chatcmpl-e2e-${issueId}`, created, {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: callId,
          type: "function",
          function: {
            name: "read_issue",
            arguments: JSON.stringify({ id: issueId }),
          },
        },
      ],
    }),
    chatCompletionChunk(`chatcmpl-e2e-${issueId}`, created, {}, "tool_calls"),
  ];
}

function finalIssueQuestionChunks(created, output) {
  const issue = output?.issue;
  const text =
    issue &&
    typeof issue.id === "string" &&
    typeof issue.title === "string" &&
    typeof issue.status === "string"
      ? `${issue.id} is "${issue.title}" and its status is ${issue.status}.`
      : "I could not read that issue from the workspace.";
  return [
    chatCompletionChunk("chatcmpl-e2e-issue-final", created, {
      role: "assistant",
    }),
    chatCompletionChunk("chatcmpl-e2e-issue-final", created, {
      content: text,
    }),
    chatCompletionChunk("chatcmpl-e2e-issue-final", created, {}, "stop"),
  ];
}

function chatCompletionChunk(id, created, delta, finishReason = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model: "e2e/mock-model",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

async function streamOpenRouterChunks(
  res,
  chunks,
  { delayAfterFunctionCallMs = 0, delayBeforeTextDeltaMs = 0 } = {},
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  for (const chunk of chunks) {
    if (delayBeforeTextDeltaMs > 0 && chunk.choices?.[0]?.delta?.content) {
      await sleep(delayBeforeTextDeltaMs);
    }
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    if (
      delayAfterFunctionCallMs > 0 &&
      chunk.choices?.[0]?.finish_reason === "tool_calls"
    ) {
      await sleep(delayAfterFunctionCallMs);
    }
  }
  res.end("data: [DONE]\n\n");
}

function isToolLoopPromptTurn(body) {
  return lastUserMessageText(body?.messages ?? body?.input)
    .toLowerCase()
    .includes(TOOL_LOOP_E2E_PROMPT);
}

function isToolLoopResultTurn(body) {
  const currentTurn = latestUserTurnMessages(body?.messages ?? body?.input);
  return (
    hasFunctionCallOutput(currentTurn, TOOL_LOOP_SEARCH_ISSUES_CALL_ID) ||
    hasFunctionCallOutput(currentTurn, TOOL_LOOP_SEARCH_DOCUMENTS_CALL_ID)
  );
}

function issueQuestionId(body) {
  const prompt = lastUserMessageText(body?.messages ?? body?.input);
  if (!/(?:title|status|제목|상태)/iu.test(prompt)) return null;
  return prompt.match(/\bREEF-\d+\b/iu)?.[0]?.toUpperCase() ?? null;
}

function issueQuestionResult(body) {
  const currentTurn = latestUserTurnMessages(body?.messages ?? body?.input);
  return findIssueToolResult(currentTurn);
}

function latestUserTurnMessages(value) {
  if (!Array.isArray(value)) return [];
  let lastUserIndex = -1;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex < 0 ? value : value.slice(lastUserIndex + 1);
}

function issueReadCallId(issueId) {
  return `${ISSUE_READ_CALL_ID_PREFIX}${issueId.toLowerCase()}`;
}

function findIssueToolResult(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findIssueToolResult(item);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const callId =
    typeof value.tool_call_id === "string"
      ? value.tool_call_id
      : typeof value.call_id === "string"
        ? value.call_id
        : typeof value.toolCallId === "string"
          ? value.toolCallId
          : null;
  if (callId?.startsWith(ISSUE_READ_CALL_ID_PREFIX)) {
    return { callId, output: parseToolOutput(value.content ?? value.output) };
  }

  for (const item of Object.values(value)) {
    const result = findIssueToolResult(item);
    if (result) return result;
  }
  return null;
}

function parseToolOutput(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseToolOutput(item?.text ?? item?.output ?? item);
      if (parsed) return parsed;
    }
    return null;
  }
  return value && typeof value === "object" ? value : null;
}

function hasFunctionCallOutput(value, callId) {
  if (Array.isArray(value)) {
    return value.some((item) => hasFunctionCallOutput(item, callId));
  }
  if (!value || typeof value !== "object") return false;
  if (value.type === "function_call_output" && value.call_id === callId) {
    return true;
  }
  if (value.role === "tool" && value.tool_call_id === callId) return true;
  return Object.values(value).some((item) =>
    hasFunctionCallOutput(item, callId),
  );
}

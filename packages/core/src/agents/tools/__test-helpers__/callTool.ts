import type { Tool } from "ai";

/**
 * Invoke an AI SDK tool's `execute` from a test, narrowing the
 * `T | AsyncIterable<T>` union back to the synchronous result the reef tools
 * all return today. Also asserts that `execute` is defined (the SDK makes it
 * optional for provider-executed and needsApproval tools — reef's are local).
 */
export async function callTool<TInput, TOutput>(
  tool: Tool<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> {
  if (!tool.execute) {
    throw new Error("tool.execute is undefined");
  }
  const result = await tool.execute(input, {
    toolCallId: "test",
    messages: [],
    // biome-ignore lint/suspicious/noExplicitAny: ToolExecutionOptions has additional internal fields not exposed in the public type.
  } as any);
  if (
    result !== null &&
    typeof result === "object" &&
    Symbol.asyncIterator in result
  ) {
    throw new Error("callTool received AsyncIterable; expected sync result");
  }
  return result as TOutput;
}

import type { UIMessage } from "ai";

/**
 * Concatenate every `text` part of a UIMessage into a single string.
 * Non-text parts (tool calls, reasoning, files, sources, approval requests)
 * are ignored — callers wanting structured rendering should iterate
 * `message.parts` themselves.
 */
export function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

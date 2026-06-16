import { resolveServerLlmConfig } from "@/lib/llm/serverConfig";

export function GET(): Response {
  const resolved = resolveServerLlmConfig();
  return Response.json(resolved.status);
}

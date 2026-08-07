import { resolveServerLlmConfig } from "@/server/adapters/llmConfig/serverConfig";

export function GET(): Response {
  const resolved = resolveServerLlmConfig();
  return Response.json(resolved.status);
}

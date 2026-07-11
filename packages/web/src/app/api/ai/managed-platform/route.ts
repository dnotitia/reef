import { resolveServerLlmConfig } from "@/lib/llm/serverConfig";

export function GET(): Response {
  const resolved = resolveServerLlmConfig();
  if (!resolved.ok || resolved.config.governance_mode !== "platform_hard") {
    return Response.json(
      {
        ok: false,
        service: "reef-web",
        capability: "reef-managed-platform-v1",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    {
      ok: true,
      service: "reef-web",
      capability: "reef-managed-platform-v1",
      llmGovernanceMode: resolved.config.governance_mode,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

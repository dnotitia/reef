import { resolveServerLlmConfig } from "@/lib/llm/serverConfig";

export function GET(): Response {
  const resolved = resolveServerLlmConfig();
  if (!resolved.ok) {
    return Response.json(
      {
        ok: false,
        service: "reef-web",
        capability: "reef-llm-capability-v1",
        llm: { enabled: false, state: "invalid" },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    {
      ok: true,
      service: "reef-web",
      capability: "reef-llm-capability-v1",
      llm: {
        enabled: resolved.status.isConfigured,
        state: resolved.status.state,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

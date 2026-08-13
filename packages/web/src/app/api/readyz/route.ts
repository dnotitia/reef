import { readAuthRuntimeConfig } from "@/server/auth/config";
import { getSsoAuthRuntime } from "@/server/auth/runtime";

const HEADERS = { "Cache-Control": "no-store" } as const;

/** Dependency-aware Kubernetes readiness; `/api/healthz` remains liveness. */
export async function GET(): Promise<Response> {
  try {
    const config = readAuthRuntimeConfig();
    if (config.mode === "sso") {
      await (await getSsoAuthRuntime()).checkReadiness();
    }
    return Response.json({ status: "ready" }, { headers: HEADERS });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: HEADERS },
    );
  }
}

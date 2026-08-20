import { readAuthV2RuntimeConfig } from "@/server/auth-v2/config";
import {
  AuthV2ReadinessError,
  checkAuthV2Readiness,
} from "@/server/auth-v2/readiness";
import {
  connectAuthV2Redis,
  type AuthV2RedisRuntime,
} from "@/server/auth-v2/redisRuntime";

const HEADERS = { "Cache-Control": "no-store" } as const;

/** Dependency-aware readiness for the explicitly enabled auth-v2 profile. */
export async function GET(): Promise<Response> {
  let config: ReturnType<typeof readAuthV2RuntimeConfig>;
  try {
    config = readAuthV2RuntimeConfig();
  } catch {
    return Response.json(
      { status: "unavailable", code: "auth_v2_configuration_invalid" },
      { status: 503, headers: HEADERS },
    );
  }
  if (!config.enabled) {
    return Response.json(
      { status: "disabled", code: "auth_v2_readiness_disabled" },
      { status: 404, headers: HEADERS },
    );
  }

  let redis: AuthV2RedisRuntime | undefined;
  try {
    if (config.redisUrl) redis = await connectAuthV2Redis(config);
    await checkAuthV2Readiness(config, {
      redis,
      fetch,
    });
    return Response.json({ status: "ready" }, { headers: HEADERS });
  } catch (error) {
    return Response.json(
      {
        status: "unavailable",
        code:
          error instanceof AuthV2ReadinessError
            ? error.code
            : "auth_v2_runtime_unavailable",
      },
      { status: 503, headers: HEADERS },
    );
  } finally {
    await redis?.close();
  }
}

import { logger } from "@/lib/logging/logger";
import { readAuthV2RuntimeConfig } from "@/server/auth-v2/config";
import { checkAuthV2Readiness } from "@/server/auth-v2/readiness";
import { connectAuthV2Redis } from "@/server/auth-v2/redisRuntime";

export async function GET(): Promise<Response> {
  let config: ReturnType<typeof readAuthV2RuntimeConfig>;
  try {
    config = readAuthV2RuntimeConfig();
  } catch (error) {
    logger.error(
      { code: "auth_configuration_invalid" },
      "auth readiness configuration failed",
    );
    return Response.json(
      { status: "not_ready", reason: "auth_configuration_invalid" },
      { status: 503 },
    );
  }

  if (!config.enabled) {
    return Response.json({ status: "ok", auth_mode: "local" }, { status: 200 });
  }

  let redis: Awaited<ReturnType<typeof connectAuthV2Redis>> | undefined;
  try {
    redis = await connectAuthV2Redis(config);
    await checkAuthV2Readiness(config, { redis: { ping: redis.ping } });
    return Response.json({ status: "ok", auth_mode: "sso" }, { status: 200 });
  } catch (error) {
    const reason =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "auth_v2_not_ready";
    logger.warn({ code: reason }, "auth readiness check failed");
    return Response.json({ status: "not_ready", reason }, { status: 503 });
  } finally {
    await redis?.close();
  }
}

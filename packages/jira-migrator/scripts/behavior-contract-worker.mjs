import { runJiraMigration } from "../dist/index.js";

const config = JSON.parse(process.env.REEF_BEHAVIOR_CONFIG ?? "null");
if (!config) throw new Error("behavior_config_missing");

try {
  const result = await runJiraMigration(config, {
    ...(process.env.REEF_BEHAVIOR_FAIL_AFTER
      ? {
          failAfterConfirmedEntities: Number(
            process.env.REEF_BEHAVIOR_FAIL_AFTER,
          ),
        }
      : {}),
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      run_id: result.runId,
      mode: result.mode,
      plan_sha256: result.planSha256,
      status: result.report.run.status,
      conservation: result.report.conservation,
      totals: result.report.totals,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      code:
        error && typeof error === "object" && "code" in error
          ? error.code
          : error instanceof Error
            ? error.name
            : "unknown_error",
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}

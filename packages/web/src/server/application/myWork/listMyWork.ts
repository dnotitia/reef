import { tracer } from "@/lib/telemetry";
import { readWorkspaceInstallationStatus } from "@/server/adapters/workspaceInstallation";
import {
  MyWorkResponseSchema,
  akbListMyWorkIssues,
  akbListVaults,
  type AkbAdapter,
  type MyWorkQuery,
  type MyWorkResponse,
} from "@reef/core";
import { SpanStatusCode } from "@opentelemetry/api";

/**
 * Resolve the actor and ready workspace scope before reading personal work.
 * Vault access is still enforced by AKB for the single integrated SQL query;
 * readiness checks only decide which Reef workspaces belong in the scope.
 */
export async function listMyWork(params: {
  adapter: AkbAdapter;
  actor: string;
  query?: MyWorkQuery;
}): Promise<MyWorkResponse> {
  return tracer.startActiveSpan("application.list_my_work", async (span) => {
    try {
      const { vaults } = await akbListVaults({ adapter: params.adapter });
      const checked = await Promise.all(
        vaults.map(async (vault) => ({
          vault,
          state: await readWorkspaceInstallationStatus({
            adapter: params.adapter,
            vault,
          }),
        })),
      );
      const readyWorkspaces = checked
        .filter(({ state }) => state.installation_status === "ready")
        .map(({ vault }) => vault.name)
        .sort();
      span.setAttribute("workspace_count", readyWorkspaces.length);

      const result = await akbListMyWorkIssues({
        adapter: params.adapter,
        actor: params.actor,
        vaults: readyWorkspaces,
        query: params.query,
      });

      span.setAttribute("issue_count", result.issues.length);
      span.setAttribute("next_page", result.next_offset !== null);
      return MyWorkResponseSchema.parse({
        workspaces: result.workspaces,
        issues: result.issues,
        next_offset: result.next_offset,
        as_of: result.as_of,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

import { tracer } from "@/lib/telemetry";
import {
  MyWorkResponseSchema,
  akbListMyWorkIssues,
  type AkbAdapter,
  type MyWorkQuery,
  type MyWorkResponse,
} from "@reef/core";
import { SpanStatusCode } from "@opentelemetry/api";
import { listActiveWorkspaces } from "../workspaces/listActiveWorkspaces";

/**
 * Resolve the actor and active workspace scope before reading personal work.
 * Vault access is still enforced by AKB for the single integrated SQL query;
 * active installation checks only decide which Reef workspaces belong in the scope.
 */
export async function listMyWork(params: {
  adapter: AkbAdapter;
  actor: string;
  query?: MyWorkQuery;
}): Promise<MyWorkResponse> {
  return tracer.startActiveSpan("application.list_my_work", async (span) => {
    try {
      const activeWorkspaces = await listActiveWorkspaces({
        adapter: params.adapter,
      });
      span.setAttribute("workspace_count", activeWorkspaces.length);

      const result = await akbListMyWorkIssues({
        adapter: params.adapter,
        actor: params.actor,
        vaults: activeWorkspaces,
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

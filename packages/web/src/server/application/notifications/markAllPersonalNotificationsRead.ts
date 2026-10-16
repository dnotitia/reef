import {
  akbMarkAllPersonalNotificationsRead,
  type AkbAdapter,
  type PersonalNotificationReadAllResult,
  type PersonalNotificationTarget,
} from "@reef/core";
import { SpanStatusCode } from "@opentelemetry/api";
import { tracer } from "@/lib/telemetry";
import { listActiveWorkspaces } from "../workspaces/listActiveWorkspaces";

export async function markAllPersonalNotificationsRead(params: {
  adapter: AkbAdapter;
  actor: string;
  targets?: PersonalNotificationTarget[];
}): Promise<PersonalNotificationReadAllResult> {
  return tracer.startActiveSpan(
    "application.mark_all_personal_notifications_read",
    async (span) => {
      try {
        const workspaces = await listActiveWorkspaces({
          adapter: params.adapter,
        });
        span.setAttribute("workspace_count", workspaces.length);

        const result = await akbMarkAllPersonalNotificationsRead(
          params.adapter,
          {
            recipient: params.actor,
            workspaces,
            ...(params.targets === undefined
              ? {}
              : { targets: params.targets }),
          },
        );
        span.setAttribute("target_count", result.targets.length);
        span.setAttribute("completed_count", result.completed.length);
        span.setAttribute("unresolved_count", result.unresolved.length);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

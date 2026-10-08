import { tracer } from "@/lib/telemetry";
import { akbListPersonalNotifications, type AkbAdapter } from "@reef/core";
import { SpanStatusCode } from "@opentelemetry/api";
import { listReadyWorkspaces } from "../workspaces/listReadyWorkspaces";

export async function listPersonalNotifications(params: {
  adapter: AkbAdapter;
  actor: string;
}) {
  return tracer.startActiveSpan(
    "application.list_personal_notifications",
    async (span) => {
      try {
        const workspaces = await listReadyWorkspaces({
          adapter: params.adapter,
        });
        span.setAttribute("workspace_count", workspaces.length);

        const notifications = await akbListPersonalNotifications(
          params.adapter,
          { recipient: params.actor, workspaces },
        );
        span.setAttribute("notification_count", notifications.length);
        return notifications;
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

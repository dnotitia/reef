import { getAkbAdapter, respondWithError } from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  openPersonalNotificationChangeFeed,
  type PersonalNotificationChangeFeed,
} from "@/server/application/notifications/openPersonalNotificationChangeFeed";

export const runtime = "nodejs";

const SSE_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
} as const;

/** GET /api/notifications/events — account-scoped change hints for the Inbox query. */
export async function GET(request: Request): Promise<Response> {
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;

  let feed: PersonalNotificationChangeFeed;
  try {
    feed = await runRouteSpan({
      name: "route.open_personal_notification_change_feed",
      run: () =>
        openPersonalNotificationChangeFeed({
          adapter: adapterResult.adapter,
          signal: request.signal,
        }),
    });
  } catch (err) {
    if (!request.signal.aborted) {
      logger.error({ err }, "open_personal_notification_change_feed failed");
    }
    return respondWithError(err, { resourceKind: "workspace" });
  }

  if (request.signal.aborted) {
    feed.close();
    return new Response(null, { status: 204, headers: SSE_HEADERS });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  const close = () => {
    if (cancelled) return;
    cancelled = true;
    if (heartbeat) clearInterval(heartbeat);
    feed.close();
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      controller.enqueue(encoder.encode("event: ready\ndata: {}\n\n"));
      heartbeat = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          close();
        }
      }, 20_000);
      void (async () => {
        try {
          while (!cancelled) {
            if (!(await feed.nextChange())) break;
            controller.enqueue(
              encoder.encode("event: notifications_changed\ndata: {}\n\n"),
            );
          }
          if (!cancelled) controller.close();
        } catch (err) {
          if (!cancelled && !request.signal.aborted) {
            logger.warn({ err }, "personal_notification_change_feed ended");
          }
          if (!cancelled) {
            try {
              controller.close();
            } catch {
              // The downstream client may have cancelled while the feed closed.
            }
          }
        } finally {
          close();
        }
      })();
    },
    cancel() {
      close();
    },
  });

  request.signal.addEventListener(
    "abort",
    () => {
      close();
      try {
        controllerRef?.close();
      } catch {
        // The stream controller is already closed or cancelled.
      }
    },
    { once: true },
  );

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

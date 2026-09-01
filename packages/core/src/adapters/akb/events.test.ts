import { describe, expect, it, vi } from "vitest";
import { EventTailError } from "../../errors";
import {
  CHANGE_EVENT_KIND,
  REEF_ACTIVITY_RESOURCE,
  REEF_COMMENTS_RESOURCE,
  createAkbChangeEventTail,
  notificationWakeupForChange,
  readChangeEventStream,
  tableResourceUri,
} from "./events";
import { createAkbAdapter } from "./core/http";

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function changeFrame(
  cursor: string,
  overrides: Record<string, unknown> = {},
): string {
  return `event: change\nid: ${cursor}\ndata: ${JSON.stringify({
    version: 1,
    cursor,
    occurred_at: "2026-09-01T10:00:00.000Z",
    vault: "reef-sample",
    kind: CHANGE_EVENT_KIND,
    resource_uri: tableResourceUri("reef-sample", REEF_ACTIVITY_RESOURCE),
    actor: "alice",
    payload: { operation: "insert" },
    ...overrides,
  })}\n\n`;
}

function checkpointFrame(cursor: string): string {
  return `event: checkpoint\nid: ${cursor}\ndata: ${JSON.stringify({
    version: 1,
    cursor,
  })}\n\n`;
}

describe("AKB Change Event Tail", () => {
  it("uses the exact kind filter and Last-Event-ID while parsing split SSE frames", async () => {
    const payload = `${checkpointFrame("cursor-1")}: heartbeat\n\n${changeFrame(
      "cursor-2",
    )}`;
    const fetchMock = vi.fn(async () =>
      streamResponse([
        payload.slice(0, 18),
        payload.slice(18, 57),
        payload.slice(57),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createAkbAdapter({
      baseUrl: "https://akb.test",
      jwt: "deployment-managed-jwt",
    });
    const records = [];
    for await (const record of createAkbChangeEventTail(adapter).subscribe({
      vault: "reef-sample",
      lastEventId: "opaque-cursor",
    })) {
      records.push(record);
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = (fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit | undefined,
    ]) ?? [undefined, undefined];
    expect(url).toBe(
      "https://akb.test/api/v1/events/reef-sample?kind=table.rows_changed",
    );
    expect(init?.headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer deployment-managed-jwt",
      "Last-Event-ID": "opaque-cursor",
    });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      type: "checkpoint",
      cursor: "cursor-1",
      checkpoint: { version: 1, cursor: "cursor-1" },
    });
    expect(records[1]).toMatchObject({
      type: "change",
      cursor: "cursor-2",
      event: { version: 1, cursor: "cursor-2", kind: CHANGE_EVENT_KIND },
    });
  });

  it("supports query-cursor or earliest start, but never combines either with start", async () => {
    const fetchMock = vi.fn(async () => streamResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createAkbAdapter({
      baseUrl: "https://akb.test",
      jwt: "jwt",
    });
    const tail = createAkbChangeEventTail(adapter);

    for await (const _record of tail.subscribe({
      vault: "reef-sample",
      cursor: "query-cursor",
    })) {
      void _record;
    }
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://akb.test/api/v1/events/reef-sample?kind=table.rows_changed&cursor=query-cursor",
    );

    await expect(
      (async () => {
        for await (const _record of tail.subscribe({
          vault: "reef-sample",
          cursor: "query-cursor",
          start: "earliest",
        })) {
          void _record;
        }
      })(),
    ).rejects.toMatchObject({ code: "invalid_event_cursor", status: 400 });
  });

  it("selects only activity inserts and comment inserts/updates in the same vault", () => {
    const activityInsert = {
      version: 1 as const,
      cursor: "a",
      occurred_at: "2026-09-01T10:00:00.000Z",
      vault: "reef-sample",
      kind: CHANGE_EVENT_KIND,
      resource_uri: tableResourceUri("reef-sample", REEF_ACTIVITY_RESOURCE),
      payload: { operation: "insert" },
    };
    const commentInsert = {
      ...activityInsert,
      cursor: "c1",
      resource_uri: tableResourceUri("reef-sample", REEF_COMMENTS_RESOURCE),
      payload: { operation: "insert" },
    };
    const commentUpdate = {
      ...commentInsert,
      cursor: "c2",
      payload: { operation: "update" },
    };

    expect(notificationWakeupForChange(activityInsert, "reef-sample")).toBe(
      "activity",
    );
    expect(notificationWakeupForChange(commentInsert, "reef-sample")).toBe(
      "comment",
    );
    expect(notificationWakeupForChange(commentUpdate, "reef-sample")).toBe(
      "comment",
    );
    expect(
      notificationWakeupForChange(
        { ...activityInsert, payload: { operation: "update" } },
        "reef-sample",
      ),
    ).toBeNull();
    expect(
      notificationWakeupForChange(
        { ...activityInsert, vault: "other-vault" },
        "reef-sample",
      ),
    ).toBeNull();
    expect(
      notificationWakeupForChange(
        {
          ...commentInsert,
          resource_uri: tableResourceUri("reef-sample", "reef_settings"),
        },
        "reef-sample",
      ),
    ).toBeNull();
    expect(
      notificationWakeupForChange(
        { ...commentInsert, payload: { operation: "delete" } },
        "reef-sample",
      ),
    ).toBeNull();
  });

  it("fails closed for a cursor mismatch and preserves the explicit HTTP cursor errors", async () => {
    await expect(
      (async () => {
        for await (const _record of readChangeEventStream(
          streamResponse([changeFrame("frame-id", { cursor: "body-id" })]),
        )) {
          void _record;
        }
      })(),
    ).rejects.toMatchObject({
      code: "protocol",
      status: 502,
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: {
              message: "Event cursor is outside the retained Vault tail",
              code: "event_gap",
              details: {
                earliest_cursor: "earliest",
                latest_cursor: "latest",
              },
            },
          }),
          { status: 410, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createAkbAdapter({
      baseUrl: "https://akb.test",
      jwt: "jwt",
    });

    await expect(
      (async () => {
        for await (const _record of createAkbChangeEventTail(adapter).subscribe(
          {
            vault: "reef-sample",
            lastEventId: "old",
          },
        )) {
          void _record;
        }
      })(),
    ).rejects.toBeInstanceOf(EventTailError);
    try {
      for await (const _record of createAkbChangeEventTail(adapter).subscribe({
        vault: "reef-sample",
        lastEventId: "old",
      })) {
        void _record;
      }
    } catch (error) {
      expect(error).toMatchObject({
        code: "event_gap",
        status: 410,
        context: { earliestCursor: "earliest", latestCursor: "latest" },
      });
    }
  });
});

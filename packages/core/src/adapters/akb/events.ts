import {
  AuthError,
  ConflictError,
  EventTailError,
  NotFoundError,
  SchemaValidationError,
} from "../../errors";
import {
  ChangeEventEnvelopeV1Schema,
  type ChangeEventEnvelopeV1,
  TableRowsChangedOperationSchema,
  TailCheckpointV1Schema,
  type TailCheckpointV1,
} from "../../schemas/events";
import { VaultNameSchema } from "../../schemas/workspace/config";
import { readAkbErrorResponse } from "./core/errorResponse";
import type { AkbAdapter, AkbStreamRequestInit } from "./core/http";

export const CHANGE_EVENT_KIND = "table.rows_changed" as const;
export const REEF_ACTIVITY_RESOURCE = "reef_activity" as const;
export const REEF_COMMENTS_RESOURCE = "reef_comments" as const;

const MAX_EVENT_CURSOR_LENGTH = 4_096;

function isSafeCursor(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EVENT_CURSOR_LENGTH) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
}

export interface ChangeEventTailInput {
  vault: string;
  /** Opaque cursor sent as the HTTP `Last-Event-ID` header on reconnect. */
  lastEventId?: string;
  /** Opaque cursor sent as the query parameter when a header is unavailable. */
  cursor?: string;
  /** Start at the earliest retained event; mutually exclusive with cursors. */
  start?: "earliest";
  signal?: AbortSignal;
}

export type ChangeEventTailRecord =
  | {
      type: "change";
      cursor: string;
      event: ChangeEventEnvelopeV1;
    }
  | {
      type: "checkpoint";
      cursor: string;
      checkpoint: TailCheckpointV1;
    };

export interface AkbChangeEventTail {
  subscribe(input: ChangeEventTailInput): AsyncGenerator<ChangeEventTailRecord>;
}

export type NotificationWakeupSource = "activity" | "comment";

function schemaError(message: string): SchemaValidationError {
  return new SchemaValidationError({
    clientValidated: true,
    issues: [message],
  });
}

export function tableResourceUri(vault: string, table: string): string {
  return `akb://${vault}/table/${table}`;
}

/**
 * Select the two Source State tables that can wake notification projection.
 * The event remains a wake-up hint; the projector rereads Source State.
 */
export function notificationWakeupForChange(
  event: unknown,
  vault: string,
): NotificationWakeupSource | null {
  const parsed = ChangeEventEnvelopeV1Schema.safeParse(event);
  if (!parsed.success) return null;
  const envelope = parsed.data;
  if (
    envelope.version !== 1 ||
    envelope.vault !== vault ||
    envelope.kind !== CHANGE_EVENT_KIND
  ) {
    return null;
  }
  const operation = TableRowsChangedOperationSchema.safeParse(
    envelope.payload.operation,
  );
  if (!operation.success) return null;
  if (
    envelope.resource_uri === tableResourceUri(vault, REEF_ACTIVITY_RESOURCE) &&
    operation.data === "insert"
  ) {
    return "activity";
  }
  if (
    envelope.resource_uri === tableResourceUri(vault, REEF_COMMENTS_RESOURCE) &&
    (operation.data === "insert" || operation.data === "update")
  ) {
    return "comment";
  }
  return null;
}

function eventTailErrorFromHttp(
  status: number,
  code: string | undefined,
  details: Record<string, unknown> | undefined,
):
  | EventTailError
  | AuthError
  | NotFoundError
  | ConflictError
  | SchemaValidationError {
  if (status === 400 || code === "invalid_event_cursor") {
    return new EventTailError({ code: "invalid_event_cursor", status });
  }
  if (status === 410 || code === "event_gap") {
    const earliestCursor = details?.earliest_cursor;
    const latestCursor = details?.latest_cursor;
    return new EventTailError({
      code: "event_gap",
      status,
      ...(typeof earliestCursor === "string" ? { earliestCursor } : {}),
      ...(typeof latestCursor === "string" ? { latestCursor } : {}),
    });
  }
  if (status === 401 || status === 403) {
    return new AuthError({ origin: "akb", status, code });
  }
  if (status === 404) return new NotFoundError({ resource: "event tail" });
  if (status === 409) return new ConflictError({ path: "event tail" });
  if (status === 422) {
    return new SchemaValidationError({
      issues: ["AKB event tail request was rejected"],
    });
  }
  return new EventTailError({ code: "upstream", status });
}

async function assertStreamResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const error = await readAkbErrorResponse(response);
  throw eventTailErrorFromHttp(response.status, error.code, error.details);
}

interface SseFrame {
  event?: string;
  id?: string;
  data: string[];
}

function lineFromBuffer(buffer: string): { line: string; rest: string } | null {
  const match = /\r\n|\r|\n/u.exec(buffer);
  if (!match || match.index === undefined) return null;
  return {
    line: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  };
}

function applySseLine(frame: SseFrame, line: string): void {
  if (line.startsWith(":")) return;
  if (line === "") return;
  const separator = line.indexOf(":");
  const field = separator === -1 ? line : line.slice(0, separator);
  let value = separator === -1 ? "" : line.slice(separator + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  if (field === "event") frame.event = value;
  else if (field === "id") frame.id = value;
  else if (field === "data") frame.data.push(value);
}

function recordFromFrame(frame: SseFrame): ChangeEventTailRecord | null {
  if (frame.data.length === 0) return null;
  if (!frame.event || !frame.id || !isSafeCursor(frame.id)) {
    throw new EventTailError({ code: "protocol", status: 502 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data.join("\n")) as unknown;
  } catch {
    throw new EventTailError({ code: "protocol", status: 502 });
  }

  if (frame.event === "change") {
    const parsed = ChangeEventEnvelopeV1Schema.safeParse(payload);
    if (!parsed.success || parsed.data.cursor !== frame.id) {
      throw new EventTailError({ code: "protocol", status: 502 });
    }
    return { type: "change", cursor: frame.id, event: parsed.data };
  }
  if (frame.event === "checkpoint") {
    const parsed = TailCheckpointV1Schema.safeParse(payload);
    if (!parsed.success || parsed.data.cursor !== frame.id) {
      throw new EventTailError({ code: "protocol", status: 502 });
    }
    return { type: "checkpoint", cursor: frame.id, checkpoint: parsed.data };
  }
  throw new EventTailError({ code: "protocol", status: 502 });
}

function validateTailInput(input: ChangeEventTailInput): void {
  if (!VaultNameSchema.safeParse(input.vault).success) {
    throw schemaError("vault is invalid");
  }
  if (
    input.lastEventId !== undefined &&
    (typeof input.lastEventId !== "string" || !isSafeCursor(input.lastEventId))
  ) {
    throw new EventTailError({ code: "invalid_event_cursor", status: 400 });
  }
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== "string" || !isSafeCursor(input.cursor))
  ) {
    throw new EventTailError({ code: "invalid_event_cursor", status: 400 });
  }
  if (
    input.start !== undefined &&
    (input.start !== "earliest" ||
      input.lastEventId !== undefined ||
      input.cursor !== undefined)
  ) {
    throw new EventTailError({ code: "invalid_event_cursor", status: 400 });
  }
}

/** Parse a single AKB SSE response into validated public tail records. */
export async function* readChangeEventStream(
  response: Response,
): AsyncGenerator<ChangeEventTailRecord> {
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("text/event-stream")
  ) {
    throw new EventTailError({ code: "protocol", status: 502 });
  }
  if (!response.body) {
    throw new EventTailError({ code: "protocol", status: 502 });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let frame: SseFrame = { data: [] };

  const dispatch = function* (): Generator<ChangeEventTailRecord> {
    const record = recordFromFrame(frame);
    frame = { data: [] };
    if (record) yield record;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const line = lineFromBuffer(buffer);
        if (!line) break;
        buffer = line.rest;
        if (line.line === "") {
          yield* dispatch();
        } else {
          applySseLine(frame, line.line);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) applySseLine(frame, buffer);
    if (frame.data.length > 0) yield* dispatch();
  } finally {
    reader.releaseLock();
  }
}

export function createAkbChangeEventTail(
  adapter: AkbAdapter,
): AkbChangeEventTail {
  return {
    async *subscribe(input) {
      validateTailInput(input);
      const stream = adapter.stream;
      if (!stream) {
        throw new EventTailError({ code: "protocol", status: 500 });
      }
      const request: AkbStreamRequestInit = {
        query: {
          kind: CHANGE_EVENT_KIND,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.start ? { start: input.start } : {}),
        },
        signal: input.signal,
        ...(input.lastEventId
          ? { rawHeaders: { "Last-Event-ID": input.lastEventId } }
          : {}),
      };
      const response = await stream(
        `/api/v1/events/${encodeURIComponent(input.vault)}`,
        request,
      );
      await assertStreamResponse(response);
      for await (const record of readChangeEventStream(response)) {
        if (record.type === "change" && record.event.vault !== input.vault) {
          throw new EventTailError({ code: "protocol", status: 502 });
        }
        yield record;
      }
    },
  };
}

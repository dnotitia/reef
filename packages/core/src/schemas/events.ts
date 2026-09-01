import { z } from "zod";

/**
 * The public wire envelopes emitted by AKB's authenticated Change Event Tail.
 *
 * Keep these schemas strict: AKB-internal event ids and database positions are
 * deliberately not part of the consumer contract. The cursor is opaque and
 * the payload is a small event-specific object that consumers must interpret
 * only after validating the envelope.
 */
export const ChangeEventEnvelopeV1Schema = z.strictObject({
  version: z.literal(1),
  cursor: z.string().min(1),
  occurred_at: z.iso.datetime({ offset: true }),
  vault: z.string().min(1),
  kind: z.string().min(1),
  resource_uri: z.string().min(1).nullable().optional(),
  actor: z.string().min(1).nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type ChangeEventEnvelopeV1 = z.infer<typeof ChangeEventEnvelopeV1Schema>;

export const TailCheckpointV1Schema = z.strictObject({
  version: z.literal(1),
  cursor: z.string().min(1),
});

export type TailCheckpointV1 = z.infer<typeof TailCheckpointV1Schema>;

export const TableRowsChangedOperationSchema = z.enum([
  "insert",
  "update",
  "delete",
]);

export type TableRowsChangedOperation = z.infer<
  typeof TableRowsChangedOperationSchema
>;

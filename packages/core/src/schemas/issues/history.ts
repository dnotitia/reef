import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";

/**
 * One entry from AKB's document history endpoint. The `author` value is the
 * AKB principal (often an opaque id); Reef deliberately never uses it as the
 * visible actor. `author_name` is the optional human-readable projection.
 */
export const AkbDocumentHistoryEntrySchema = z.object({
  hash: z.string().min(1, "history hash is required"),
  message: z.string(),
  author: z.string().min(1, "history author is required"),
  date: IsoDateFieldSchema,
  author_name: z.string().nullable().optional(),
  /** Optional additive projection used by compatible history providers. */
  diff: z.string().nullable().optional(),
});
export type AkbDocumentHistoryEntry = z.infer<
  typeof AkbDocumentHistoryEntrySchema
>;

/**
 * The envelope returned by `GET /api/v1/history/{vault}/{doc_id:path}`.
 * Entries stay unknown until the adapter validates them individually: one
 * malformed commit must not hide the rest of an issue's timeline.
 */
export const AkbDocumentHistoryResponseSchema = z.object({
  kind: z.literal("document_history"),
  uri: z.string().min(1),
  history: z.array(z.unknown()),
});
export type AkbDocumentHistoryResponse = z.infer<
  typeof AkbDocumentHistoryResponseSchema
>;

/** A read-time timeline event projected from an `action: update` commit. */
export const IssueBodyHistoryEventSchema = z.object({
  id: z.string().min(1),
  hash: z.string().min(1),
  at: IsoDateFieldSchema,
  actor: z.string().nullable(),
  kind: z.literal("body_update"),
  /** The source diff, when the history provider exposes one. */
  diff: z.string().nullable().optional(),
});
export type IssueBodyHistoryEvent = z.infer<typeof IssueBodyHistoryEventSchema>;

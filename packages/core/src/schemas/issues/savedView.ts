import { z } from "zod";
import {
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "./metadata";
import { USER_SORT_FIELDS } from "./requests";

const NonEmptyStringArraySchema = z.array(z.string().trim().min(1));

const SavedIssueViewWriteQuerySchema = z
  .object({
    status: z.array(StatusEnum).optional(),
    type: z.array(IssueTypeEnum).optional(),
    priority: z.array(PriorityEnum).optional(),
    assignee: NonEmptyStringArraySchema.optional(),
    requester: NonEmptyStringArraySchema.optional(),
    sprint_id: NonEmptyStringArraySchema.optional(),
    milestone_id: NonEmptyStringArraySchema.optional(),
    release_id: NonEmptyStringArraySchema.optional(),
    severity: z.array(SeverityEnum).optional(),
    due: z.array(z.enum(["overdue", "due_soon"])).optional(),
    labels: NonEmptyStringArraySchema.optional(),
    dep: z.array(z.enum(["blocked", "blocking"])).optional(),
    archived: z.array(z.enum(["1", "true"])).optional(),
    stale: z.array(z.enum(["1", "true"])).optional(),
    sort: z.array(z.enum(USER_SORT_FIELDS)).optional(),
    order: z.array(z.enum(["asc", "desc"])).optional(),
    q: NonEmptyStringArraySchema.optional(),
    view: z.array(z.enum(["board", "list", "timeline", "backlog"])).optional(),
  })
  .strict();

export const SavedIssueViewPayloadSchema = z.object({
  version: z.literal(1),
  query: SavedIssueViewWriteQuerySchema,
});

const SavedIssueViewReadPayloadSchema = z.object({
  version: z.literal(1),
  query: z.record(z.string(), z.unknown()).transform((query) =>
    Object.fromEntries(
      Object.entries(query).flatMap(([key, value]) => {
        if (!Array.isArray(value)) return [];
        return [
          [
            key,
            value.filter((item): item is string => typeof item === "string"),
          ],
        ];
      }),
    ),
  ),
});

export const SavedIssueViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  name_key: z.string().min(1),
  owner: z.string().min(1),
  // Stored rows may outlive individual URL enum members. Preserve the row and
  // drop only structurally invalid array members here; the canonical web codec
  // owns known keys and per-field enum validation when applying the payload.
  payload: SavedIssueViewReadPayloadSchema,
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const CreateSavedIssueViewSchema = z.object({
  name: z.string().trim().min(1).max(120),
  payload: SavedIssueViewPayloadSchema,
});

export const UpdateSavedIssueViewSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    payload: SavedIssueViewPayloadSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.payload !== undefined, {
    message: "At least one saved-view field is required",
  });

export type SavedIssueViewPayload = z.infer<typeof SavedIssueViewPayloadSchema>;
export type SavedIssueView = z.infer<typeof SavedIssueViewSchema>;
export type CreateSavedIssueView = z.infer<typeof CreateSavedIssueViewSchema>;
export type UpdateSavedIssueView = z.infer<typeof UpdateSavedIssueViewSchema>;

export function normalizeSavedIssueViewName(name: string): string {
  return name.trim().normalize("NFKC").toLowerCase();
}

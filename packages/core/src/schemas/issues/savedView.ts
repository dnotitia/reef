import { z } from "zod";

export const SavedIssueViewPayloadSchema = z.object({
  version: z.literal(1),
  query: z.record(z.array(z.string())),
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

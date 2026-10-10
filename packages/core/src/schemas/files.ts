import { z } from "zod";

/** Canonical AKB file URI, with or without a collection path. */
export const AKB_FILE_URI_RE = /^akb:\/\/[^/?#]+\/(?:.+\/)?file\/[^/?#]+$/;

export const AkbFileUriSchema = z
  .string()
  .regex(AKB_FILE_URI_RE, "file_uri must be a canonical AKB file URI");

export type AkbFileUri = z.infer<typeof AkbFileUriSchema>;

/** Metadata returned by AKB when checking whether a canonical file is readable. */
export const AkbFileMetadataSchema = z.looseObject({
  kind: z.literal("file"),
  uri: AkbFileUriSchema,
  name: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
});

export type AkbFileMetadata = z.infer<typeof AkbFileMetadataSchema>;

import { z } from "zod";

/** Canonical AKB file URI, with or without a collection path. */
export const AKB_FILE_URI_RE = /^akb:\/\/[^/?#]+\/(?:.+\/)?file\/[^/?#]+$/;

export const AkbFileUriSchema = z
  .string()
  .regex(AKB_FILE_URI_RE, "file_uri must be a canonical AKB file URI");

export type AkbFileUri = z.infer<typeof AkbFileUriSchema>;

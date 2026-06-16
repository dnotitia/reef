import { z } from "zod";

const IsoDateStringSchema = z
  .string()
  .refine(
    (s) => !Number.isNaN(Date.parse(s)),
    "must be a valid ISO 8601 date string",
  );

/**
 * Accepts ISO strings and Date objects at adapter boundaries, then normalizes
 * everything that crosses the schema boundary to an ISO 8601 string.
 */
export const IsoDateFieldSchema = z
  .union([IsoDateStringSchema, z.date()])
  .transform((d) => (typeof d === "string" ? d : d.toISOString()));

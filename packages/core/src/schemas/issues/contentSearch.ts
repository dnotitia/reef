import { z } from "zod";

const unicodeCodePointLength = (value: string): number => [...value].length;

const IssueContentSearchLimitSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(30),
  z.literal(40),
  z.literal(50),
]);

export const IssueContentSearchRequestSchema = z.object({
  q: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => unicodeCodePointLength(value) >= 2, {
      message: "Search query must contain at least two Unicode code points",
    })
    .refine((value) => value.length <= 180, {
      message: "Search query must contain at most 180 UTF-16 code units",
    }),
  limit: IssueContentSearchLimitSchema,
});

const IssueContentSearchResultSchema = z.object({
  reef_id: z.string().min(1),
  title: z.string().min(1),
  snippet: z.string().min(1).max(320),
  source: z.enum(["body", "comment"]),
  score: z.number().nullable(),
  match_id: z.string().min(1),
});

export const IssueContentSearchResponseSchema = z.object({
  results: z.array(IssueContentSearchResultSchema),
  has_more: z.boolean(),
});

type IssueContentSearchRequest = z.infer<
  typeof IssueContentSearchRequestSchema
>;
export type IssueContentSearchResult = z.infer<
  typeof IssueContentSearchResultSchema
>;
export type IssueContentSearchResponse = z.infer<
  typeof IssueContentSearchResponseSchema
>;

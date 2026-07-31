import { defaultFilter } from "cmdk";

export function scoreCommandFilter(
  value: string,
  search: string,
  keywords: ReadonlyArray<string> = [],
): number {
  let score = defaultFilter(value, search);
  for (const keyword of keywords) {
    score = Math.max(score, defaultFilter(keyword, search));
  }
  return score;
}

import type { Priority } from "@reef/core";
import type { NO_SELECTION } from "@reef/core/fields";

export type PrioritySelection = Priority | typeof NO_SELECTION;

export function formatLabelsInput(
  labels: readonly string[] | undefined,
): string {
  return labels?.join(", ") ?? "";
}

export function parseLabelsInput(input: string): string[] {
  return input
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

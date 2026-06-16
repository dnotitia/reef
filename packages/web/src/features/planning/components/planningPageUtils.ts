import type { Milestone, Release, Sprint } from "@reef/core";
import type {
  PlanningInput,
  PlanningItem,
  PlanningKind,
} from "../hooks/usePlanningCatalog";

export const PLANNING_KINDS: PlanningKind[] = [
  "sprints",
  "milestones",
  "releases",
];

export interface EditorState {
  mode: "create" | "edit";
  kind: PlanningKind;
  item: Partial<PlanningItem>;
}

export function emptyItem(kind: PlanningKind): Partial<PlanningItem> {
  if (kind === "sprints") {
    return { name: "", status: "planned", goal: "" } satisfies Partial<Sprint>;
  }
  if (kind === "milestones") {
    return {
      name: "",
      status: "open",
      description: "",
    } satisfies Partial<Milestone>;
  }
  return { name: "", status: "planned", notes: "" } satisfies Partial<Release>;
}

export function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function cleanDate(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildPlanningInput(
  kind: PlanningKind,
  item: Partial<PlanningItem>,
): PlanningInput {
  const name = String(item.name ?? "").trim();
  if (kind === "sprints") {
    return {
      name,
      status: (item.status as Sprint["status"]) ?? "planned",
      start_date: cleanDate((item as Partial<Sprint>).start_date),
      end_date: cleanDate((item as Partial<Sprint>).end_date),
      goal: String((item as Partial<Sprint>).goal ?? ""),
      capacity_points:
        (item as Partial<Sprint>).capacity_points === undefined ||
        (item as Partial<Sprint>).capacity_points === null
          ? null
          : Number((item as Partial<Sprint>).capacity_points),
    };
  }
  if (kind === "milestones") {
    return {
      name,
      status: (item.status as Milestone["status"]) ?? "open",
      target_date: cleanDate((item as Partial<Milestone>).target_date),
      description: String((item as Partial<Milestone>).description ?? ""),
    };
  }
  return {
    name,
    status: (item.status as Release["status"]) ?? "planned",
    target_date: cleanDate((item as Partial<Release>).target_date),
    released_at: cleanDate((item as Partial<Release>).released_at),
    notes: String((item as Partial<Release>).notes ?? ""),
  };
}

export function mergeEditorItem(
  current: Partial<PlanningItem>,
  patch: Partial<PlanningItem>,
): Partial<PlanningItem> {
  return { ...current, ...patch };
}

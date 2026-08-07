import {
  PlanningStatusBadge,
  type PlanningStatusKind,
} from "./PlanningStatusBadge";

export interface PlanningOptionProps {
  kind: PlanningStatusKind;
  name: string;
  status: string;
}

/** Shared planning option body for single- and multi-select consumers. */
export function PlanningOption({ kind, name, status }: PlanningOptionProps) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate">{name}</span>
      <PlanningStatusBadge
        kind={kind}
        status={status}
        className="ml-auto shrink-0"
      />
    </span>
  );
}

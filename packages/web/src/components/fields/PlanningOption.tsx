import {
  PlanningStatusBadge,
  type PlanningStatusKind,
} from "./PlanningStatusBadge";

export interface PlanningOptionProps {
  kind: PlanningStatusKind;
  name: string;
  /** Null means the selected planning id is no longer in the loaded catalog. */
  status: string | null;
}

/** Shared planning option body for single- and multi-select consumers. */
export function PlanningOption({ kind, name, status }: PlanningOptionProps) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate">{name}</span>
      {status ? (
        <PlanningStatusBadge
          kind={kind}
          status={status}
          className="ml-auto shrink-0"
        />
      ) : null}
    </span>
  );
}

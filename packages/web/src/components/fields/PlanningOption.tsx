import {
  PlanningStatusBadge,
  type PlanningStatusKind,
} from "./PlanningStatusBadge";
import {
  OverflowTooltip,
  useTextOverflow,
} from "@/components/ui/overflow-tooltip";
import { useRef } from "react";

export interface PlanningOptionProps {
  kind: PlanningStatusKind;
  name: string;
  /** Null means the selected planning id is no longer in the loaded catalog. */
  status: string | null;
  /** Opt in for single planning combobox options (not multi-select). */
  overflowTooltip?: boolean;
  /** Keyboard-active state supplied by the single-select combobox. */
  active?: boolean;
}

/** Shared planning option body for single- and multi-select consumers. */
export function PlanningOption({
  kind,
  name,
  status,
  overflowTooltip = false,
  active = false,
}: PlanningOptionProps) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const isOverflowing = useTextOverflow(
    nameRef,
    overflowTooltip ? name : "",
    overflowTooltip,
  );
  const content = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span ref={nameRef} className="min-w-0 flex-1 truncate">
        {name}
      </span>
      {status ? (
        <PlanningStatusBadge
          kind={kind}
          status={status}
          className="ml-auto shrink-0"
        />
      ) : null}
    </span>
  );

  return overflowTooltip ? (
    <OverflowTooltip value={name} isOverflowing={isOverflowing} active={active}>
      {content}
    </OverflowTooltip>
  ) : (
    content
  );
}

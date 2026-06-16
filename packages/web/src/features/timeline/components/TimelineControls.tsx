"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { TimelineRange } from "../lib/timelineLayout";

interface TimelineControlsProps {
  range: TimelineRange;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function TimelineControls({
  range,
  onPrevious,
  onNext,
  onToday,
}: TimelineControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs font-medium text-muted-foreground tabular-nums sm:inline">
        {range.start.key} — {range.end.key}
      </span>
      <ButtonGroup>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onPrevious}
          aria-label="Previous quarter"
          title="Previous quarter"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToday}
          aria-label="Go to today"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Today
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onNext}
          aria-label="Next quarter"
          title="Next quarter"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </ButtonGroup>
    </div>
  );
}

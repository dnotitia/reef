"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("timeline");
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
          aria-label={t("previousQuarter")}
          title={t("previousQuarter")}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToday}
          aria-label={t("goToToday")}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {t("today")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onNext}
          aria-label={t("nextQuarter")}
          title={t("nextQuarter")}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </ButtonGroup>
    </div>
  );
}

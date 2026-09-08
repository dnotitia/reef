"use client";

import { Button } from "@/components/ui/button";
import type { SprintRolloverResume } from "@reef/core";
import { useTranslations } from "next-intl";

export function SprintRolloverResumeNotice({
  resumes,
  onOpen,
}: {
  resumes: readonly SprintRolloverResume[];
  onOpen: (resume: SprintRolloverResume) => void;
}) {
  const translate = useTranslations("planning.rollover");
  if (resumes.length === 0) return null;

  return (
    <section
      data-testid="sprint-rollover-resume-notice"
      role="status"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-in-progress-focus/40 bg-status-in-progress-fill/5 px-3 py-2.5"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {translate("resumeTitle")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {translate("resumeDescription")}
        </p>
      </div>
      <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
        {resumes.map((resume) => (
          <Button
            key={resume.result.source_sprint_id}
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => onOpen(resume)}
          >
            {translate("resumeAction", {
              name: resume.result.source_sprint.name,
            })}
          </Button>
        ))}
      </div>
    </section>
  );
}

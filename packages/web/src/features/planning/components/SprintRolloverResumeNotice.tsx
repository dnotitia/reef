"use client";

import { Button } from "@/components/ui/button";
import type { SprintRolloverResume } from "@reef/core";
import { useTranslations } from "next-intl";

export function SprintRolloverResumeNotice({
  resumes,
  canEdit,
  onOpen,
}: {
  resumes: readonly SprintRolloverResume[];
  canEdit: boolean;
  onOpen: (resume: SprintRolloverResume) => void;
}) {
  const translate = useTranslations("planning.rollover");
  if (resumes.length === 0) return null;

  return (
    <section
      data-testid="sprint-rollover-resume-notice"
      role="status"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-focus/35 bg-brand-fill/[0.04] px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="type-body font-medium text-foreground">
          {translate("resumeTitle")}
        </p>
        <p
          className={`mt-0.5 type-caption ${canEdit ? "text-muted-foreground" : "text-foreground"}`}
        >
          {translate(canEdit ? "resumeDescription" : "resumeReaderDescription")}
        </p>
        <div className="mt-2 grid gap-2">
          {resumes.map((resume) => (
            <div
              key={resume.result.source_sprint_id}
              className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <span
                data-testid="sprint-rollover-resume-source"
                className="min-w-0 truncate type-control font-medium text-foreground"
              >
                {resume.result.source_sprint.name}
              </span>
              <Button
                type="button"
                size="sm"
                variant="default"
                className="w-full sm:w-auto"
                disabled={!canEdit}
                aria-disabled={!canEdit || undefined}
                aria-label={translate("resumeActionLabel", {
                  name: resume.result.source_sprint.name,
                })}
                onClick={() => onOpen(resume)}
              >
                {translate("resumeAction")}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

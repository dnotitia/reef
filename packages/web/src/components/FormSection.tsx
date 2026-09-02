"use client";

import type { ReactNode } from "react";

/**
 * Detail/form section headers keep the established compact hierarchy. They are
 * distinct from the per-field label style so the visual hierarchy reads
 * "section → field label → control".
 */
export const SECTION_HEADER_CLASS = "type-detail-section text-muted-foreground";

interface FormSectionProps {
  /** Section heading text (rendered verbatim; uppercasing is CSS). */
  title: string;
  children: ReactNode;
  /** Optional control rendered at the right edge of the header row. */
  action?: ReactNode;
  /** Extra classes on the <section> wrapper (e.g. a top border separator). */
  className?: string;
}

/**
 * Groups a set of form fields under a consistent section header so the
 * create / edit / draft surfaces stay visually aligned. Keeps the underlying
 * `<section>` element so tests that walk `.closest("section")` still resolve.
 */
export function FormSection({
  title,
  children,
  action,
  className,
}: FormSectionProps) {
  return (
    <section className={className ? `grid gap-3 ${className}` : "grid gap-3"}>
      {action ? (
        <div className="flex items-end justify-between gap-2">
          <h3 className={SECTION_HEADER_CLASS}>{title}</h3>
          {action}
        </div>
      ) : (
        <h3 className={SECTION_HEADER_CLASS}>{title}</h3>
      )}
      {children}
    </section>
  );
}

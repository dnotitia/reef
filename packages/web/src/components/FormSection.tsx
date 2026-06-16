"use client";

import type { ReactNode } from "react";

/**
 * Unified section-header style shared by every form surface (issue new/detail/
 * draft editors and the planning editor). Distinct from the per-field label
 * style so the visual hierarchy reads "section → field label → control".
 */
export const SECTION_HEADER_CLASS =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

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

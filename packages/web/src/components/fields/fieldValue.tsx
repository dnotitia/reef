import { useEnrichmentEmptyLabels } from "@/i18n/fieldLabels";
import type { ExternalRef } from "@reef/core";
import type { ReactNode } from "react";

/**
 * Compact field-value display primitives. Originally inline in
 * `enrichmentFieldDescriptors.tsx`; extracted here so the canonical "labels as
 * chips", "relation ids", "external refs" renderings live with the other field
 * leaves and can be reused by future read surfaces. Markup is unchanged.
 */

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

export function PlainValue({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 break-words text-xs text-foreground/80">
      {children}
    </span>
  );
}

export function LabelChips({ labels }: { labels: readonly string[] }) {
  const empty = useEnrichmentEmptyLabels();
  if (labels.length === 0) return <Muted>{empty.none}</Muted>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </span>
  );
}

export function RelationIds({ ids }: { ids: readonly string[] }) {
  const empty = useEnrichmentEmptyLabels();
  if (ids.length === 0) return <Muted>{empty.none}</Muted>;
  return (
    <span className="min-w-0 break-words font-mono text-[11px] text-muted-foreground">
      {ids.join(", ")}
    </span>
  );
}

export function ExternalRefs({ refs }: { refs: readonly ExternalRef[] }) {
  const empty = useEnrichmentEmptyLabels();
  if (refs.length === 0) return <Muted>{empty.none}</Muted>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {refs.map((ref, index) => (
        <span
          key={`${ref.type}:${ref.ref ?? ref.url ?? index}`}
          className="min-w-0 break-words text-xs text-foreground/80"
        >
          {ref.label ?? ref.ref ?? ref.url ?? ref.type}
        </span>
      ))}
    </span>
  );
}

"use client";

import { ArrowLeft } from "lucide-react";

/**
 * Back affordance for the issue detail sheet's drill trail (REEF-270).
 *
 * Lives at the left of the sheet's single top chrome row (REEF-284) — Close sits
 * at its right — and returns to the previous issue in the trail (`backTo`). It is
 * deliberately distinct from the parent breadcrumb (REEF-266) in both axes the
 * issue calls out: position (the top chrome row, above the header, vs. the
 * header's inline left cluster) and glyph (a `←` arrow naming *where you came
 * from* — navigation — vs. the breadcrumb's status icon + `›` naming *this
 * issue's parent* — structure). The two coexist without reading as one trail
 * (AC5).
 *
 * Wrapped in its own labelled `<nav>` landmark, mirroring the breadcrumb's
 * `<nav aria-label="Issue hierarchy">`, so assistive tech exposes the drill
 * trail and the structural hierarchy as two separate, named navigation regions.
 *
 * The raw reef id is the label here on purpose: Back is wayfinding, so the
 * concrete "← REEF-A" target is what a PM scans for; `translate="no"` keeps the
 * id (a code identifier) out of machine translation. Layout padding lives on the
 * chrome row, so this renders just the landmark + button.
 */
export function IssueDrillBackBar({
  backTo,
  onBack,
}: {
  /** Issue id a single Back returns to. */
  backTo: string;
  onBack: () => void;
}) {
  return (
    <nav aria-label="Back navigation">
      <button
        type="button"
        data-testid="issue-drill-back"
        data-back-to={backTo}
        onClick={onBack}
        aria-label={`Back to ${backTo}`}
        className="-ml-1.5 inline-flex touch-manipulation items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
        <span translate="no" className="font-mono tabular-nums">
          {backTo}
        </span>
      </button>
    </nav>
  );
}

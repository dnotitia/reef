import { cn } from "@/lib/utils";

interface ReadOnlyValueProps {
  value: string | null | undefined;
  /** Render code-shaped values (prefix, branch) in the mono stack. */
  mono?: boolean;
  testId?: string;
}

/**
 * The read rendering of a workspace setting for non-admin viewers.
 *
 * Deliberately a typeset value, NOT a disabled `<input>`: a greyed-out field
 * reads as broken/loading and some assistive tech skips it, whereas plain text
 * is unambiguous and fully readable. Empty values collapse to an em dash.
 */
export function ReadOnlyValue({ value, mono, testId }: ReadOnlyValueProps) {
  const isEmpty = value == null || value.trim().length === 0;
  return (
    <p
      data-testid={testId}
      className={cn("text-sm text-foreground", mono && "font-mono text-[13px]")}
    >
      {isEmpty ? <span className="text-muted-foreground">—</span> : value}
    </p>
  );
}

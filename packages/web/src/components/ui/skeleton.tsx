import { cn } from "@/lib/utils";

type SkeletonTone = "primary" | "secondary";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Two-tone hierarchy hint (REEF-250). `primary` (the default) fills value
   * placeholders; `secondary` is a fainter fill for labels and section headers,
   * pre-encoding the loaded view's emphasis without colour or extra chrome. The
   * actual fills live on `.reef-shimmer[data-tone]` in globals.css.
   */
  tone?: SkeletonTone;
}

// `reef-shimmer` keyframe + two-tone fills are defined in globals.css. To phase
// a bar into a group's single light sweep, pass its position index through
// `style={{ "--i": n } as React.CSSProperties}` — it rides the spread `style`.
function Skeleton({ tone = "primary", className, ...props }: SkeletonProps) {
  return (
    <div
      data-tone={tone}
      className={cn("reef-shimmer rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };

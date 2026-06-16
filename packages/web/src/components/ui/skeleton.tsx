import { cn } from "@/lib/utils";

// `reef-shimmer` keyframe is defined in globals.css.
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "reef-shimmer rounded-md bg-surface-subtle",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };

import { cn } from "@/lib/utils";
import type { SVGProps } from "react";

interface ReefMarkProps extends SVGProps<SVGSVGElement> {
  decorative?: boolean;
}

export function ReefMark({
  className,
  decorative = false,
  ...props
}: ReefMarkProps) {
  return (
    <svg
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "reef"}
      aria-hidden={decorative ? true : undefined}
      viewBox="0 0 64 64"
      className={cn("inline-block shrink-0", className)}
      {...props}
    >
      {decorative ? null : <title>reef</title>}
      <rect width="64" height="64" rx="14" fill="#1d2025" />
      <rect x="12" y="13" width="5" height="38" rx="2.5" fill="var(--brand)" />
      <path
        d="M27 26H49M27 39H43"
        fill="none"
        stroke="white"
        strokeLinecap="round"
        strokeWidth="5"
      />
    </svg>
  );
}

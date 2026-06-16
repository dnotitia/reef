"use client";

import { cn } from "@/lib/utils";
import { useId } from "react";
import type { NetThroughputWeek } from "../lib/aggregate";

export function NetThroughputChart({
  points,
  height = 230,
}: {
  points: ReadonlyArray<NetThroughputWeek>;
  height?: number;
}) {
  const gradId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const W = 600;
  const H = height;
  const padX = 4;
  const padTop = 6;
  const padBottom = 16;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const n = points.length;
  const maxLine = Math.max(1, ...points.flatMap((p) => [p.created, p.closed]));
  const maxNet = Math.max(1, ...points.map((p) => Math.abs(p.net)));
  const x = (i: number) =>
    padX + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH - (v / maxLine) * innerH;
  const baseline = padTop + innerH;
  const barW = Math.max(6, Math.min(22, innerW / Math.max(n, 1) - 4));
  const line = (key: "created" | "closed") =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p[key])}`)
      .join(" ");
  const tickIdx =
    n > 0 ? [...new Set([0, Math.floor((n - 1) / 2), n - 1])] : [];

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Issues created, closed, and net change over time"
      >
        <defs>
          <linearGradient id={`${gradId}-created`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {points.map((p, i) => {
          const h = (Math.abs(p.net) / maxNet) * 52;
          const positive = p.net >= 0;
          return (
            <rect
              key={p.start}
              x={x(i) - barW / 2}
              y={positive ? baseline - h : baseline}
              width={barW}
              height={Math.max(1, h)}
              rx={2}
              fill={positive ? "var(--priority-high)" : "var(--status-done)"}
              opacity={0.32}
            >
              <title>{`${p.label}: net ${p.net}`}</title>
            </rect>
          );
        })}
        <path
          d={`${line("created")} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`}
          fill={`url(#${gradId}-created)`}
          stroke="none"
        />
        <path
          d={line("created")}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={line("closed")}
          fill="none"
          stroke="var(--status-done)"
          strokeWidth={2}
          strokeDasharray="4 3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {tickIdx.map((i) => (
          <text
            key={i}
            x={Math.min(W - 28, Math.max(18, x(i)))}
            y={H - 4}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-[11px]"
          >
            {points[i]?.label}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <LegendLine color="var(--brand)" label="Created" />
        <LegendLine color="var(--status-done)" label="Closed" dashed />
        <LegendLine color="var(--priority-high)" label="Net increase" block />
      </div>
    </div>
  );
}

function LegendLine({
  color,
  label,
  dashed,
  block,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  block?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "inline-block rounded-full",
          block ? "h-2 w-3" : "h-0.5 w-4",
        )}
        style={{
          backgroundColor: color,
          opacity: block ? 0.4 : 1,
          borderTop: dashed ? `1px dashed ${color}` : undefined,
        }}
      />
      {label}
    </span>
  );
}

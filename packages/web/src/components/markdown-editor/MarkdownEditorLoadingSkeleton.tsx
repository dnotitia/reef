"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { useMarkdownEditorHeightResize } from "./heightResize";

const TOOLBAR_GROUPS = [4, 4, 3, 3, 2, 2, 1] as const;

function ToolbarGroup({ count }: { count: number }) {
  return (
    <div className="inline-flex items-center gap-0.5 border-r border-border pr-1.5 last:border-r-0 last:pr-0">
      {Array.from({ length: count }, (_, index) => (
        <span
          aria-hidden="true"
          key={index}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-border-subtle/60 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <span className="size-3.5 shrink-0" />
        </span>
      ))}
    </div>
  );
}

export function MarkdownEditorLoadingSkeleton({
  enableHeightResize = false,
  waveIndex,
}: {
  enableHeightResize?: boolean;
  waveIndex?: number;
}) {
  const t = useTranslations("markdownEditor");
  const { isResizeAvailable, bodyFrameStyle } =
    useMarkdownEditorHeightResize(enableHeightResize);
  const frameStyle = enableHeightResize
    ? {
        ...(bodyFrameStyle ?? {
          height:
            "var(--reef-markdown-editor-initial-frame-height, calc(200px + 1rem))",
        }),
        marginBottom: "var(--reef-markdown-editor-frame-margin, 0px)",
        marginRight: "var(--reef-markdown-editor-frame-margin, 0px)",
      }
    : undefined;

  return (
    <div
      aria-hidden="true"
      data-testid="markdown-editor-skeleton"
      className="relative isolate rounded-md border border-border bg-surface-elevated"
    >
      <div
        data-testid="markdown-toolbar"
        className="flex items-start gap-1 border-b border-border-subtle px-2 py-1"
      >
        <div
          data-testid="markdown-toolbar-controls"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 border-b border-transparent">
            {TOOLBAR_GROUPS.map((count, index) => (
              <ToolbarGroup count={count} key={index} />
            ))}
          </div>
        </div>
        <div data-testid="markdown-source-toggle" className="shrink-0">
          <span
            aria-hidden="true"
            className="inline-flex h-8 shrink-0 items-center align-middle whitespace-nowrap rounded-md bg-border-subtle/60 px-2 text-xs font-mono font-medium text-transparent"
          >
            {t("source")}
          </span>
        </div>
      </div>
      <div
        className={cn(
          "p-1",
          enableHeightResize && "relative",
          enableHeightResize && isResizeAvailable && "min-h-0 overflow-hidden",
        )}
        data-testid="markdown-editor-skeleton-body-frame"
        style={frameStyle}
      >
        <div
          className={cn(
            "px-3 py-2",
            enableHeightResize && isResizeAvailable
              ? "h-full min-h-0"
              : "min-h-[200px]",
          )}
        >
          <Skeleton
            className="h-3 w-2/3"
            style={
              waveIndex === undefined
                ? undefined
                : ({ "--i": waveIndex } as CSSProperties)
            }
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  type PanelPlacement,
  computePanelPlacement,
  findScrollBoundaryRect,
} from "@/lib/panelPlacement";
import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useState } from "react";

export function useComboboxPlacement({
  open,
  align,
  triggerRef,
  panelRef,
  measureKey,
}: {
  open: boolean;
  align: "start" | "end";
  triggerRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  measureKey: string | number | boolean;
}): PanelPlacement {
  const [placement, setPlacement] = useState<PanelPlacement>({
    vertical: "down",
    horizontal: align,
  });
  const [viewportRevision, setViewportRevision] = useState(0);

  useEffect(() => {
    if (!open) return;
    const handleResize = () => {
      setViewportRevision((revision) => revision + 1);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement({ vertical: "down", horizontal: align });
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;
    const next = computePanelPlacement({
      trigger,
      panel: { width: panel.width, height: panel.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      boundary: findScrollBoundaryRect(triggerRef.current) ?? undefined,
      preferredHorizontal: align,
    });
    setPlacement((current) =>
      current.vertical === next.vertical &&
      current.horizontal === next.horizontal
        ? current
        : next,
    );
  }, [align, measureKey, open, panelRef, triggerRef, viewportRevision]);

  return placement;
}

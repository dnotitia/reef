import type { KeyboardEventHandler, PointerEventHandler } from "react";
import { cn } from "@/lib/utils";
import {
  EDITOR_BODY_MIN_HEIGHT,
  EDITOR_RESIZABLE_BODY_ID,
  EDITOR_RESIZE_DESCRIPTION_ID,
} from "./heightResize";

export interface MarkdownEditorResizeHandleLabels {
  resizeHandle: string;
  resizeHandleDescription: (values: {
    current: string;
    min: string;
    max: string;
  }) => string;
}

export interface MarkdownEditorResizeHandleProps {
  currentHeight: number;
  maxHeight: number;
  isResizing: boolean;
  labels: MarkdownEditorResizeHandleLabels;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onLostPointerCapture: PointerEventHandler<HTMLDivElement>;
}

export function MarkdownEditorResizeHandle({
  currentHeight,
  maxHeight,
  isResizing,
  labels,
  onKeyDown,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLostPointerCapture,
}: MarkdownEditorResizeHandleProps) {
  return (
    <>
      <div
        role="separator"
        tabIndex={0}
        aria-label={labels.resizeHandle}
        aria-controls={EDITOR_RESIZABLE_BODY_ID}
        aria-describedby={EDITOR_RESIZE_DESCRIPTION_ID}
        aria-orientation="horizontal"
        aria-valuemin={EDITOR_BODY_MIN_HEIGHT}
        aria-valuemax={maxHeight}
        aria-valuenow={currentHeight}
        aria-valuetext={`${currentHeight}px`}
        data-testid="markdown-editor-resize-handle"
        data-resizing={isResizing ? "true" : "false"}
        className="group absolute bottom-0 right-0 z-10 flex size-8 touch-none select-none items-end justify-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
        data-reef-interaction="resize-editor"
        onKeyDown={onKeyDown}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={onLostPointerCapture}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none mb-1 mr-1 size-4 border-b-2 border-r-2 border-border-subtle transition-colors group-hover:border-brand-focus group-focus-visible:border-brand-focus",
            isResizing && "border-brand-focus",
          )}
        />
      </div>
      <span id={EDITOR_RESIZE_DESCRIPTION_ID} className="sr-only">
        {labels.resizeHandleDescription({
          current: String(currentHeight),
          min: String(EDITOR_BODY_MIN_HEIGHT),
          max: String(maxHeight),
        })}
      </span>
    </>
  );
}

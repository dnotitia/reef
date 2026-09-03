"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useIssueKeyboardStore } from "../../stores/useIssueKeyboardStore";

interface IssueListReorderHandleProps {
  id: string;
  label: string;
}

/**
 * The List keeps its row semantics and click behavior while this compact
 * handle owns both the draggable activator and the target slot. The data sent
 * to dnd-kit includes sortable coordinates so keyboard dragging follows the
 * same visible sequence as pointer dragging.
 */
export function IssueListReorderHandle({
  id,
  label,
}: IssueListReorderHandleProps) {
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id,
  });
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      handleRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  useLayoutEffect(() => {
    if (
      focusRequest?.scope !== "list" ||
      focusRequest.target !== "reorder-handle" ||
      focusRequest.issueId !== id ||
      !handleRef.current
    ) {
      return;
    }
    handleRef.current.focus({ preventScroll: true });
  }, [focusRequest, id]);

  return (
    <button
      ref={setRef}
      type="button"
      aria-label={label}
      data-testid={`issue-list-grip-${id}`}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-50 transition-[background-color,opacity,box-shadow] duration-150 hover:bg-surface-hover hover:opacity-100 focus-visible:z-10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
      data-reef-interaction="drag-handle"
      style={{
        ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
        ...(transition ? { transition } : {}),
      }}
      data-drag-over={isOver ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      onClick={(event) => event.stopPropagation()}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}

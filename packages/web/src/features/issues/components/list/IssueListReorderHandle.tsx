"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useCallback } from "react";

interface IssueListReorderHandleProps {
  id: string;
  index: number;
  items: readonly string[];
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
  index,
  items,
  label,
}: IssueListReorderHandleProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id,
      data: {
        sortable: { containerId: "issue-list", index, items },
      },
    });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id,
    data: { sortable: { containerId: "issue-list", index, items } },
  });
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      setNodeRef(node);
      setDroppableRef(node);
    },
    [setDroppableRef, setNodeRef],
  );

  return (
    <button
      ref={setRef}
      type="button"
      aria-label={label}
      data-testid={`issue-list-grip-${id}`}
      className="inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-50 transition-[background-color,opacity,box-shadow] duration-150 hover:bg-surface-hover hover:opacity-100 focus-visible:z-10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40 active:cursor-grabbing"
      style={
        transform ? { transform: CSS.Translate.toString(transform) } : undefined
      }
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

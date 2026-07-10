// @vitest-environment node

export type SelectionCheckState = "unchecked" | "mixed" | "checked";

export function inclusiveSelectionRange(
  orderedIds: readonly string[],
  anchorId: string,
  targetId: string,
): string[] {
  const anchorIndex = orderedIds.indexOf(anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return orderedIds.slice(start, end + 1);
}

export function loadedSelectionState(
  selectedIds: ReadonlySet<string>,
  loadedIds: readonly string[],
): SelectionCheckState {
  if (loadedIds.length === 0) return "unchecked";
  const selectedCount = loadedIds.reduce(
    (count, id) => count + Number(selectedIds.has(id)),
    0,
  );
  if (selectedCount === 0) return "unchecked";
  return selectedCount === loadedIds.length ? "checked" : "mixed";
}

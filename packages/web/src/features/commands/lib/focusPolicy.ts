import type { PaletteFocusPolicy } from "./appActionCatalog";

export function shouldRestorePaletteFocus(
  policy: PaletteFocusPolicy,
  originConnected: boolean,
): boolean {
  return policy === "restore" && originConnected;
}

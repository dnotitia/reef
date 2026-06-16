"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

/**
 * Initial value is hard-coded to `true` so server and first client render
 * consistently agree — Next.js 16 may shim `navigator` differently than the
 * browser, which would otherwise cause hydration mismatches. The mount
 * effect reconciles to the real `navigator.onLine` immediately, so an
 * offline-from-the-start user sees the banner within a frame.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

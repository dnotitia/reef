"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { useAuthRedirect } from "@/features/auth/hooks/useAuthRedirect";

/**
 * `/workspace` is an alias for the global root redirect contract. Only this
 * unscoped route may consult the remembered Dexie workspace default; explicit
 * `/workspace/[vault]` routes keep their URL vault as the source of truth.
 */
export default function WorkspaceRootPage() {
  useAuthRedirect("root");
  return <AppShellSkeleton />;
}

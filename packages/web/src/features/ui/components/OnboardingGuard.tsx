"use client";

import { useAuthRedirect } from "@/features/auth/hooks/useAuthRedirect";
import type { ReactNode } from "react";

interface OnboardingGuardProps {
  children: ReactNode;
}

/**
 * OnboardingGuard — wraps dashboard routes. Falls through to children when
 * the user has an active akb session and active workspace; otherwise the
 * shared `useAuthRedirect` hook fires a replace().
 *
 * Children render immediately to avoid a blank flash — the dashboard unmounts
 * on redirect.
 */
export function OnboardingGuard({ children }: OnboardingGuardProps) {
  useAuthRedirect("dashboard");
  return <>{children}</>;
}

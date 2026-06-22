"use client";

import { IssueDetailSheet } from "@/features/issues/components/detail/IssueDetailSheet";
import { useRouter } from "next/navigation";
import { use } from "react";

interface IssueModalPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Intercepting route for /issues/[id] reached via soft navigation
 * (clicking a row/card from board, list, or activity).
 *
 * Renders the shared IssueDetailSheet. `onClose` is the exit-to-entry target:
 * router.back() returns to the underlying page in one step because drill hops
 * keep the history flat (list ⇄ sheet, REEF-270). Back/Esc within a drill trail
 * are driven by the sheet's in-memory nav stack, not this callback. The base
 * route at app/(dashboard)/issues/[id]/page.tsx handles hard navigation
 * (refresh / direct URL) with its own exit target.
 */
export default function IssueModalPage({ params }: IssueModalPageProps) {
  const { id } = use(params);
  const router = useRouter();
  return <IssueDetailSheet issueId={id} onClose={() => router.back()} />;
}

"use client";

import { IssueDetailSheet } from "@/features/issues/components/detail/IssueDetailSheet";
import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { usePathname, useRouter } from "next/navigation";
import { use, useEffect } from "react";

interface IssueModalPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Intercepting route for /issues/[id] reached via soft navigation
 * (clicking a row/card from board, list, or activity).
 *
 * Renders the shared IssueDetailSheet. `onClose` is the exit-to-entry target
 * for a soft-open session: router.back() returns to the underlying page in one
 * step because drill hops keep the history flat (list ⇄ sheet, REEF-270).
 * Back/Esc within the drill trail are driven by the sheet's in-memory nav
 * stack, not this callback. If a hard-open sheet drills into this route, the
 * sheet keeps the hard-open callback captured at session start. Parallel-route
 * slots retain an unmatched child during soft navigation, so this page also
 * yields its sheet when the pathname is no longer an issue detail; otherwise a
 * deep-link Close would leave stale @modal content over the list.
 */
export default function IssueModalPage({ params }: IssueModalPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const clear = useIssueNavStack((state) => state.clear);
  const isActiveIssuePath = pathname.endsWith(`/issues/${id}`);

  useEffect(() => {
    if (!isActiveIssuePath) clear();
  }, [clear, isActiveIssuePath]);

  if (!isActiveIssuePath) return null;

  return <IssueDetailSheet issueId={id} onClose={() => router.back()} />;
}

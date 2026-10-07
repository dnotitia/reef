"use client";

import { IssueDetailSheet } from "@/features/issues/components/detail/IssueDetailSheet";
import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { usePathname, useRouter } from "next/navigation";
import { use, useEffect } from "react";

interface IssueModalPageProps {
  params: Promise<{ id: string; vault: string }>;
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
 * base route keeps its original Sheet mounted and this slot yields. Parallel-
 * route slots retain an unmatched child during soft navigation, so this page
 * also yields when the pathname is no longer an issue detail; otherwise a
 * deep-link Close would leave stale @modal content over the list.
 */
export default function IssueModalPage({ params }: IssueModalPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const clear = useIssueNavStack((state) => state.clear);
  const entryRoute = useIssueNavStack((state) => state.entryRoute);
  // During cross-workspace soft navigation, Next can retain the background
  // layout's `[vault]` param in this intercepted parallel route. The pathname
  // identifies the actual destination route and owns the detail workspace.
  const issuePath = pathname.match(/^\/workspace\/([^/]+)\/issues\/([^/]+)$/);
  const vault = issuePath?.[1];
  const isActiveIssuePath = issuePath?.[2] === id;

  useEffect(() => {
    if (entryRoute !== "base" && !isActiveIssuePath) clear();
  }, [clear, entryRoute, isActiveIssuePath]);

  if (!vault || !isActiveIssuePath || entryRoute === "base") return null;

  return (
    <IssueDetailSheet
      entryRoute="modal"
      issueId={id}
      vault={vault}
      onClose={() => router.back()}
    />
  );
}

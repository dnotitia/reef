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
 * Renders the shared IssueDetailSheet; close → router.back() so the user
 * returns to the underlying page in their browser history. The base route
 * at app/(dashboard)/issues/[id]/page.tsx handles hard navigation
 * (refresh / direct URL) with its own close behavior.
 */
export default function IssueModalPage({ params }: IssueModalPageProps) {
  const { id } = use(params);
  const router = useRouter();
  return <IssueDetailSheet issueId={id} onClose={() => router.back()} />;
}

import { isSafeWebUrl } from "@/features/ai/review/evidenceLinks";
import type { ImplementationRef } from "@reef/core";

const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function githubActivityUrl({
  type,
  repo,
  ref,
}: {
  type: "commit" | "pr";
  repo?: string | null;
  ref?: string | null;
}): string | undefined {
  if (!repo || !ref || !GITHUB_REPO_PATTERN.test(repo)) return undefined;
  const encodedRef = encodeURIComponent(ref);
  const kind = type === "pr" ? "pull" : "commit";
  return `https://github.com/${repo}/${kind}/${encodedRef}`;
}

export function implementationRefLabel(ref: ImplementationRef): string {
  if (ref.type === "pull_request") return `PR ${ref.ref}`;
  if (ref.type === "commit") return `commit ${ref.ref.slice(0, 7)}`;
  return `branch ${ref.ref}`;
}

export function implementationRefUrl(
  ref: ImplementationRef,
): string | undefined {
  if (isSafeWebUrl(ref.url)) return ref.url;
  if (!ref.repo || !GITHUB_REPO_PATTERN.test(ref.repo)) return undefined;

  const encodedRef = encodeURIComponent(ref.ref);
  if (ref.type === "pull_request") {
    return `https://github.com/${ref.repo}/pull/${encodedRef}`;
  }
  if (ref.type === "commit") {
    return `https://github.com/${ref.repo}/commit/${encodedRef}`;
  }
  return undefined;
}

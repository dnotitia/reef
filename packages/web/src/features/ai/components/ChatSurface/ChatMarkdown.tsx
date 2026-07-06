"use client";

import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import Link from "next/link";
import {
  type ComponentProps,
  memo,
  useCallback,
  useMemo,
  useState,
} from "react";
import { Streamdown } from "streamdown";

type RemarkPlugins = ComponentProps<typeof Streamdown>["remarkPlugins"];
import {
  type ReefMentionOptions,
  remarkReefMentions,
} from "@/lib/markdown/remarkReefMentions";

const streamdownPlugins = { cjk, code, math, mermaid };

/** Root-relative hrefs are the ones the reef mention plugin emits (in-app nav). */
function isInternalHref(href: string | undefined): href is string {
  return typeof href === "string" && href.startsWith("/");
}

/**
 * External answer links keep the same "open external link" confirmation that
 * issue comments use — reused from the shared `linkSafetyConfig` so chat and
 * comments look and behave identically — but rendered here because ChatMarkdown
 * owns the `a` renderer (to route internal reef mentions in-app). Mirrors
 * Streamdown's own gated-link markup: a button that reveals the modal, whose
 * confirm opens the URL in a new tab.
 */
function SafeExternalAnchor({
  href,
  children,
}: {
  href: string | undefined;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const onClose = useCallback(() => setOpen(false), []);
  const onConfirm = useCallback(() => {
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  }, [href]);

  if (!href || !linkSafetyConfig.enabled) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        className="wrap-anywhere font-medium text-brand underline hover:text-brand/80"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {linkSafetyConfig.renderModal?.({
        url: href,
        isOpen: open,
        onClose,
        onConfirm,
      })}
    </>
  );
}

/**
 * The `a` renderer for chat markdown. Reef issue mentions (rewritten by
 * `remarkReefMentions` to a root-relative href) open the issue in-app via a
 * client `<Link>` — skipping the external-link confirmation, which is meant for
 * off-site URLs. Everything else is treated as external and gated.
 */
function ChatAnchor({
  href,
  children,
}: ComponentProps<"a"> & { node?: unknown }) {
  if (isInternalHref(href)) {
    return (
      <Link
        href={href}
        prefetch={false}
        translate="no"
        className="font-medium text-foreground underline decoration-brand/50 decoration-1 underline-offset-2 transition-colors hover:decoration-brand"
      >
        {children}
      </Link>
    );
  }
  return <SafeExternalAnchor href={href}>{children}</SafeExternalAnchor>;
}

const chatMarkdownComponents = { a: ChatAnchor };

export interface ChatMarkdownProps {
  children: string;
  isAnimating?: boolean;
  /** Issue ids the answer may deep-link (the loaded list ∪ this turn's tools). */
  knownIssueIds: ReadonlySet<string>;
  /** Active workspace, used to build vault-scoped issue hrefs. */
  vault: string;
  className?: string;
}

/**
 * Markdown renderer for assistant chat answers (REEF-361). Same Streamdown
 * pipeline as issue comments, plus the reef-mention autolink (AC3) and an
 * in-app-aware link renderer.
 */
export const ChatMarkdown = memo(
  ({
    children,
    isAnimating,
    knownIssueIds,
    vault,
    className,
  }: ChatMarkdownProps) => {
    // A serializable fingerprint of the deep-linkable set + vault. Recomputed
    // when the set identity changes (a tool completing mid-stream), not per
    // streamed token.
    const fingerprint = useMemo(
      () => `${vault}:${[...knownIssueIds].sort().join(",")}`,
      [knownIssueIds, vault],
    );

    const remarkPlugins = useMemo<RemarkPlugins>(() => {
      const options: ReefMentionOptions & { cacheFingerprint: string } = {
        isKnown: (id) => knownIssueIds.has(id),
        hrefFor: (id) => withVault(vault, `/issues/${id}`),
        // Streamdown keys its markdown-processor cache on
        // `JSON.stringify(pluginSettings)`; the closures above serialize away, so
        // renders with different known-id sets would otherwise share a processor
        // frozen to the first set, and a mention proven mid-stream would stay
        // plain text. The fingerprint makes the cache key differ so a fresh
        // processor is built with the current set (REEF-361 AC3).
        cacheFingerprint: fingerprint,
      };
      return [[remarkReefMentions, options]];
    }, [knownIssueIds, vault, fingerprint]);

    return (
      <Streamdown
        // Remount when the set changes so Streamdown actually re-parses the
        // already-streamed text (its memo otherwise skips a re-render while the
        // answer text is unchanged). Paired with `cacheFingerprint`, this rebuilds
        // the processor against the new set instead of reusing the cached one.
        key={fingerprint}
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className,
        )}
        components={chatMarkdownComponents}
        plugins={streamdownPlugins}
        remarkPlugins={remarkPlugins}
        isAnimating={isAnimating}
      >
        {children}
      </Streamdown>
    );
  },
);

ChatMarkdown.displayName = "ChatMarkdown";

"use client";

import type { ChatToolStep } from "@/features/ai/chat/chatTypes";
import {
  summarizeToolInput,
  toolLabelKey,
  toolResultCount,
} from "@/lib/ai/chatToolSummary";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ChevronRight,
  FileCode,
  FileSearch,
  FileText,
  Loader2,
  type LucideIcon,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

const TOOL_ICONS: Record<string, LucideIcon> = {
  search_issues: Search,
  search_code: Search,
  search_documents: FileSearch,
  read_issue: FileText,
  read_template: FileText,
  list_assignees: Users,
  dev_read_file: FileCode,
};

function toolIcon(toolName: string): LucideIcon {
  return TOOL_ICONS[toolName] ?? Sparkles;
}

/**
 * The collapsible "what the assistant did" trace (REEF-361 AC2). While the run
 * streams, the active tool shows a live "Searching issues…" row; completed
 * tools collapse into "Searched issues · N results" rows that persist as history
 * once the answer settles. Expanding a completed row reveals the tool name,
 * summarized arguments, and result count — never the raw payload. Follows reef's
 * disclosure idiom (CollapsedEventsRow) with the AI purple accent marking
 * machine work, distinct from the answer prose and from issue status colors.
 */
export function ToolStepTrace({
  steps,
  streaming,
}: {
  steps: ChatToolStep[];
  streaming: boolean;
}) {
  const t = useTranslations("ai");
  const [expanded, setExpanded] = useState(false);
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  if (steps.length === 0) return null;

  // While streaming the steps are always shown (live progress); once settled
  // they collapse under the header disclosure.
  const showSteps = streaming || expanded;

  return (
    <div
      data-testid="chat-tool-trace"
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface-subtle"
    >
      <button
        type="button"
        aria-expanded={showSteps}
        onClick={() => setExpanded((v) => !v)}
        className="group/trace flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <Sparkles
          aria-hidden="true"
          className="size-3.5 shrink-0 text-ai-subtle-foreground"
        />
        <span className="text-xs font-medium text-foreground">
          {streaming ? t("chatSteps.working") : t("chatSteps.header")}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {t("chatSteps.stepCount", { count: steps.length })}
        </span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-[var(--ease-signature)]",
            showSteps && "rotate-90",
          )}
        />
      </button>

      {showSteps && (
        <ul className="flex flex-col border-t border-border-subtle">
          {steps.map((step) => (
            <ToolStepRow
              key={step.toolCallId}
              step={step}
              isOpen={openStepId === step.toolCallId}
              onToggle={() =>
                setOpenStepId((cur) =>
                  cur === step.toolCallId ? null : step.toolCallId,
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolStepRow({
  step,
  isOpen,
  onToggle,
}: {
  step: ChatToolStep;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("ai");
  const labelKey = toolLabelKey(step.toolName);
  const count = toolResultCount(step);
  const args = summarizeToolInput(step);
  const Icon = toolIcon(step.toolName);
  // Dynamic tool label key — the catalog carries a `.running`/`.done` pair for
  // each mapped tool plus a `generic` fallback.
  const label = t(
    `chatSteps.tool.${labelKey}.${step.status === "running" ? "running" : "done"}`,
  );

  // A running step is a live indicator only — no disclosure, no result yet.
  if (step.status === "running") {
    return (
      <li
        className="flex items-center gap-2.5 px-2.5 py-1.5"
        aria-live="polite"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Loader2 className="size-3.5 text-ai-subtle-foreground motion-safe:animate-spin" />
        </span>
        <span className="text-xs font-medium text-ai-subtle-foreground">
          {label}
        </span>
      </li>
    );
  }

  const isError = step.status === "error";

  return (
    <li className="border-t border-border-subtle first:border-t-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {isError ? (
            <AlertCircle
              aria-hidden="true"
              className="size-3.5 text-destructive"
            />
          ) : (
            <Icon
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
          )}
        </span>
        <span className="truncate text-xs text-foreground/90">{label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {count !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("chatSteps.results", { count })}
            </span>
          )}
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3 text-muted-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-[var(--ease-signature)]",
              isOpen && "rotate-90",
            )}
          />
        </span>
      </button>

      {isOpen && (
        <dl className="flex flex-col gap-1.5 bg-elevated px-2.5 pb-2.5 pl-9 pt-0.5 text-xs">
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-muted-foreground">
              {t("chatSteps.detailTool")}
            </dt>
            <dd
              className="rounded border border-ai-border bg-ai-subtle px-1.5 py-0.5 font-mono text-[11px] text-ai-subtle-foreground"
              translate="no"
            >
              {step.toolName}
            </dd>
          </div>
          {args && (
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-muted-foreground">
                {t("chatSteps.detailArgs")}
              </dt>
              <dd className="min-w-0 break-words font-mono text-[11px] text-foreground">
                {args}
              </dd>
            </div>
          )}
          {isError && step.errorMessage && (
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-muted-foreground">
                {t("chatSteps.detailError")}
              </dt>
              <dd className="min-w-0 break-words text-[11px] text-destructive">
                {step.errorMessage}
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

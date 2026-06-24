/**
 * fieldKit — web-side field metadata. Re-exports the framework-agnostic option
 * data and the no-selection sentinel from `@reef/core` and owns the web
 * presentation concern that should not live in core: Tailwind color classes.
 * Decision #1 of REEF-018 — enum/option data in core, color classes in web.
 *
 * Human LABELS are no longer re-exported here: since REEF-292 they are
 * locale-resolved at render time through `@/i18n/fieldLabels` (e.g.
 * `useStatusLabels()`), not read as English literals. This stays a plain data
 * module (no React); import it directly. The leaf components in this directory
 * consume it.
 */
import type { IssueType, Priority, Severity, Status } from "@reef/core";
import type { DependencyFacet, DueFacet } from "@reef/core/fields";

export {
  STATUS_OPTIONS,
  WORKFLOW_STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  DUE_OPTIONS,
  DEPENDENCY_OPTIONS,
  NO_SELECTION,
  type DueFacet,
  type DependencyFacet,
} from "@reef/core/fields";

/** Tailwind text-color classes for the status indicator. */
export const STATUS_COLORS: Record<Status, string> = {
  backlog: "text-status-backlog",
  // `todo` keeps the shared `--status-open` token (also used by planning &
  // reports); the status key is renamed (REEF-139).
  todo: "text-status-open",
  in_progress: "text-status-in-progress",
  in_review: "text-status-in-review",
  done: "text-status-done",
  closed: "text-status-closed",
};

/** Tailwind background-color classes for the priority dot. */
export const PRIORITY_COLORS: Record<Priority, string> = {
  critical: "bg-priority-critical",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};

/** Tailwind text-color classes for the issue-type glyph (icon currentColor). */
export const ISSUE_TYPE_COLORS: Record<IssueType, string> = {
  epic: "text-type-epic",
  story: "text-type-story",
  task: "text-type-task",
  bug: "text-type-bug",
  spike: "text-type-spike",
  chore: "text-type-chore",
};

/** Tailwind text-color classes for the severity glyph (icon currentColor). */
export const SEVERITY_COLORS: Record<Severity, string> = {
  blocker: "text-severity-blocker",
  critical: "text-severity-critical",
  major: "text-severity-major",
  minor: "text-severity-minor",
  trivial: "text-severity-trivial",
};

/** Tailwind text-color classes for the due-facet glyph (icon currentColor). */
export const DUE_COLORS: Record<DueFacet, string> = {
  overdue: "text-due-overdue",
  due_soon: "text-due-soon",
};

/** Tailwind text-color classes for the dependency-facet glyph (icon currentColor). */
export const DEPENDENCY_COLORS: Record<DependencyFacet, string> = {
  blocked: "text-dependency-blocked",
  blocking: "text-dependency-blocking",
};

/**
 * Identity-tint avatar fill ramp (REEF-093). Indexed by `hash(login) % length`
 * so the same person keeps one color across every surface. These are the one
 * place a token is used as a fill — a person is an identity, not a semantic
 * state — so they live apart from the does not-fill status/priority/type tokens.
 * Paired with AVATAR_FG; the brand tone is reserved for the current user.
 */
export const AVATAR_TONES = [
  "bg-av-0",
  "bg-av-1",
  "bg-av-2",
  "bg-av-3",
  "bg-av-4",
  "bg-av-5",
  "bg-av-6",
  "bg-av-7",
  "bg-av-8",
  "bg-av-9",
] as const;

/** Foreground glyph color for identity-tint avatars (flips per color mode). */
export const AVATAR_FG = "text-av-fg";

/** "You" tone — the current user's avatar stays brand teal (REEF-068). */
export const AVATAR_BRAND = "bg-brand text-brand-foreground";

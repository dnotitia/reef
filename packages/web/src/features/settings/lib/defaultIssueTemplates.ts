import type { Template } from "@reef/core";

/**
 * Seed templates the "Seed default templates" button commits when
 * `reef_templates` is empty. After seeding, these constants are no longer read —
 * the user edits the stored rows instead.
 *
 * The set is aligned 1:1 to reef's canonical `IssueTypeEnum`
 * (epic / story / task / bug / spike / chore): each template `name` is the type
 * id and `default_labels` seeds the matching kind label. Templates do not set
 * `issue_type` directly — the create dialog owns the Type field, and templates
 * are not queried by type, so wiring a template→type column is deliberately out
 * of scope (REEF-256). `feature` (→ `story`) and `tech-debt` (→ a `task`/`chore`
 * carrying the `tech-debt` label) are intentionally dropped: neither is a reef
 * issue type.
 *
 * Acceptance-criteria policy is deliberate, not blanket. Given/When/Then lands
 * only on the behavior-bearing types — `story` (user-facing scenarios) and `bug`
 * (a regression guard). The other four encode a done-definition that fits their
 * kind instead, because forcing a behavioral scenario onto them would be noise:
 *   - epic  → outcome success criteria (the scenarios live on its child stories)
 *   - task  → verifiable checks that reference the parent story's AC
 *   - spike → a question answered with a documented recommendation
 *   - chore → the change performed plus a verification step
 */
export const DEFAULT_ISSUE_TEMPLATES: readonly Template[] = [
  {
    name: "epic",
    label: "Epic",
    description:
      "Large outcome with success criteria; decomposes into child stories.",
    title_prefix: "Epic: ",
    default_labels: ["epic"],
    body: [
      "## Outcome",
      "<the product outcome this epic delivers, and for whom>",
      "",
      "## Why now",
      "<the user value or business goal — describe what, not how>",
      "",
      "## Success criteria",
      "<!-- Epics are measured by outcomes, not Given/When/Then. The behavioral",
      "     scenarios live on the child stories. -->",
      "- <observable outcome or metric that proves the epic is done>",
      "- <quality / operational bar that must hold>",
      "",
      "## Scope",
      "- In scope: ",
      "- Out of scope: ",
      "",
      "## Child stories",
      "<!-- Break down into story issues with this epic as parent_id. -->",
      "- <story 1>",
      "",
      "## Open questions",
      "- ",
    ].join("\n"),
  },
  {
    name: "story",
    label: "User story",
    description:
      "User-facing outcome with Given/When/Then acceptance criteria.",
    title_prefix: "Story: ",
    default_labels: ["story"],
    body: [
      "## User story",
      "As a <role>,",
      "I want <action>,",
      "so that <benefit>.",
      "",
      "## Context",
      "<the user problem, product context, and why this matters>",
      "",
      "## Acceptance criteria",
      "- [ ] Given <context / precondition>, when <user action>, then <observable outcome>.",
      "- [ ] Given <an edge case or constraint>, when <action>, then <expected handling>.",
      "",
      "## Scope",
      "- In scope: ",
      "- Out of scope: ",
      "",
      "## Notes",
      "- ",
    ].join("\n"),
  },
  {
    name: "task",
    label: "Task",
    description:
      "Scoped work item; done as checks that reference the parent story's AC.",
    priority: "medium",
    default_labels: [],
    body: [
      "## Goal",
      "<the implementation outcome this task achieves>",
      "",
      "## Approach",
      "<high-level plan; key files / modules to touch>",
      "",
      "## Done when",
      "<!-- A task is a slice of a story. State done as verifiable checks and",
      "     reference the parent story's acceptance criteria instead of restating",
      "     Given/When/Then here. -->",
      "- [ ] <verifiable check> (satisfies parent AC: <story AC # or N/A>)",
      "- [ ] Gates pass: typecheck, lint, tests.",
      "",
      "## Notes",
      "- ",
    ].join("\n"),
  },
  {
    name: "bug",
    label: "Bug report",
    description:
      "Reproducible defect; acceptance criteria are the regression guard.",
    title_prefix: "Bug: ",
    priority: "high",
    default_labels: ["bug"],
    body: [
      "## Summary",
      "<one-sentence description of the bug>",
      "",
      "## Steps to reproduce",
      "1. ",
      "2. ",
      "3. ",
      "",
      "## Expected",
      "<what should happen>",
      "",
      "## Actual",
      "<what actually happens>",
      "",
      "## Acceptance criteria",
      "- Given <the reproduction precondition>, when <the triggering action>, then <the expected behavior> instead of the reported defect.",
      "- Given the same flow, when a regression test guards it, then it fails before the fix and passes after.",
      "",
      "## Environment",
      "- ",
    ].join("\n"),
  },
  {
    name: "spike",
    label: "Spike",
    description:
      "Time-boxed investigation; done is a documented recommendation.",
    title_prefix: "Spike: ",
    default_labels: ["spike"],
    body: [
      "## Question",
      "<the specific question or uncertainty this spike resolves>",
      "",
      "## Time box",
      "<the effort ceiling, e.g. 1 day — stop and report when reached>",
      "",
      "## Done when",
      "<!-- A spike produces a decision, not shipped behavior — no Given/When/Then. -->",
      "- [ ] The question above is answered.",
      "- [ ] Options considered are documented with trade-offs.",
      "- [ ] A recommendation (and any follow-up issues) is recorded.",
      "",
      "## Findings",
      "<filled in as the spike progresses>",
    ].join("\n"),
  },
  {
    name: "chore",
    label: "Chore",
    description:
      "Maintenance / housekeeping; done is the change plus a verification.",
    title_prefix: "Chore: ",
    priority: "low",
    default_labels: ["chore"],
    body: [
      "## Goal",
      "<the maintenance / housekeeping outcome — deps, config, tooling, cleanup>",
      "",
      "## Done when",
      "<!-- Operational work, not user-facing behavior — no Given/When/Then. -->",
      "- [ ] <the change is performed>",
      "- [ ] Verification: <command or check confirming nothing regressed>",
      "",
      "## Notes",
      "- ",
    ].join("\n"),
  },
];

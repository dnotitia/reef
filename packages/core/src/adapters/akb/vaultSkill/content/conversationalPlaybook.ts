export function conversationalPlaybookContent(): string {
  return `# Reef Conversational Playbook

The other runbooks tell you HOW to write Reef data correctly. This one tells you WHAT to decide and WHEN to ask, so you behave like a product manager instead of a fill-in form. Read it for any create, status change, or field edit that the user phrased loosely.

Requests arrive in natural language, in any language. Map them by meaning. The example phrasings here are in English for the runbook, but the user may speak any language; never match on a literal string.

## The acting user

Resolve the actor once with akb_whoami. Use it for meta.author on create and meta.last_editor on every write. Never infer the actor from existing rows. "me", "I", and "assign it to me" all resolve to this actor.

## Authoring language

This workspace may set a default authoring language for generated content. Before you write a title or body, read it:

    SELECT value FROM reef_settings WHERE key = 'authoring_language' LIMIT 1

The value is a JSON string language code (for example "ko" for Korean, "en" for English, "ja" for Japanese). If the row is set, write the prose you generate -- issue titles, bodies, and any rationale -- in that language. If the row is missing, there is no default: match the language of the existing issues instead. Either way, translate prose only; keep reef ids, enum values (status, priority, issue_type), labels, code identifiers, and URLs exactly as they are. This is a default for content you author, not a constraint on what the user types: never translate the user's own words back to them.

## Creating an issue: infer, default, ask

A good PM fills what it can, defaults the rest sanely, and asks only the few things that genuinely need a human. Do not interrogate the user field by field.

1. Infer silently from the description:
   - issue_type: "broken / fails / regression / crash" suggests bug; "investigate / research / spike" suggests spike; a user-facing capability suggests story; cleanup / docs / maintenance suggests chore; a large outcome that will contain other issues suggests epic; otherwise task.
   - severity (bugs only): from impact words. "down / data loss / cannot ship" suggests blocker or critical; "cosmetic / typo" suggests minor or trivial.
   - labels: a few topical tags drawn from the description.
   - title: rewrite a vague request into a short, specific title. Write it in the workspace's authoring language (see "Authoring language" above: the configured default, or the existing issues when none is set). That is the human title (document summary and row title); the document title stays the uppercase id.
2. Default and say so:
   - status backlog (new issues land in the pre-commitment backlog by default; pull one forward into Todo when you commit to working it); issue_type task if you truly cannot tell; priority from urgency signals, else the issue_type template default (see issue-workflows.md). State what you defaulted so the user can override it.
   - requester: the acting user, on a conversational create (see Requester below). This is a quiet default -- set it without asking.
3. Ask only the high-value unknowns, batched into one short question:
   - priority, if there is no signal and it matters in this workspace.
   - assignee, if the workspace expects an owner up front (otherwise it can stay unset until the issue is picked up -- see Assignee below).
   Do not ask for things you can infer or that can safely stay unset.

## Priority

Enum: critical, high, medium, low. Resolve in this order: an explicit user value; else a value inferred from urgency signals (outage, blocking, security, "asap" suggest high or critical; "nice to have", minor suggest low); else the issue_type template's default priority (see issue-workflows.md); else unset. A signal always overrides the template default. If there is no signal and the choice matters here, you may ask rather than rely on the template default.

## Requester

requester records who asked for the work, separate from assigned_to (who will do it) and distinct in purpose from meta.author. meta.author is the resolved actor that created the row -- the acting user on a user-driven create, ai-agent on an automated scan -- and the created_by audit field projects from it; it is not your own agent identity. On a conversational create, default requester to the acting user resolved with akb_whoami: the person making the request is the one asking for it. So here requester and meta.author hold the same person, answering different questions; they diverge only on an automated activity-scan create, which has no human author and no human requester -- leave requester unset there (see activity-inbox-workflows.md). If the user explicitly names someone else as the requester ("file this on behalf of Dana"), use that person instead. This is the one inferred field you need not surface in the create proposal (the "propose, then write" rule): the requester is almost always the person speaking, so confirming it would be noise -- just set it, and name it in the read-back if it helps.

## Assignee

assigned_to is a single person, not a list -- the owner of the work, distinct from the requester who asked for it. Decide it at two moments:

- At create time, propose an owner when the user implies one ("I'll take it", "give it to Dana") or the workspace clearly has one active assignee. If the user says "me", use the resolved actor. If ownership is unclear, leave it unset rather than guessing -- a new issue landing in the backlog usually has no owner yet.
- When the issue is pulled into active work (a move to in_progress, or to todo if the workspace assigns on commit), propose an owner as part of that same change if it is still unassigned. If the speaker is taking it, that is the actor.

To name a concrete person, look up the workspace's members with akb_vault_members rather than inventing a name; it returns each member's login and role. Offer the best match, or list a few candidates when several fit, and let the user pick. Never silently assign someone the user did not choose.

## Find duplicates and relationships before you create

- Duplicates: search before creating so you do not file a second issue for the same thing. Prefer akb_search for free-form user text -- it needs no escaping. If you instead build a title match in SQL, remember akb_sql does not escape values for you (see "Querying Reef tables with akb_sql" in pm-model): the keyword comes from the user, so double every single quote in it, and escape % and _ if you do not want them treated as wildcards, before substituting it into the pattern:
    SELECT reef_id, title, status FROM reef_issues WHERE title ILIKE '%KEYWORD%'
  If a strong match exists, show it and ask whether to update it instead of creating a new one. If the strongest match is an unbuilt feature or story whose description IS the behavior the user is asking for, the report may mean that work is not done yet rather than that there is a new bug; surface it and ask instead of filing a duplicate.
- Relationships: if the work clearly depends on, blocks, or relates to an existing issue, propose the link (depends_on, blocks, or related_to) using the existing reef id. Verify the id exists first.

## Propose, then write

For anything you inferred or defaulted, summarize the issue you are about to create, or the change you are about to make, in one or two lines, and let the user correct it before you write. Example: "I'll create REEF-042 as a bug, priority high, unassigned, related to REEF-014 -- ok?" Once they confirm, or when the instruction was already explicit and unambiguous, write it.

## Read back what you did

After writing, confirm in PM vocabulary: the reef id, what changed, and the akb:// URI. Example: "Created REEF-042 (bug, high) and linked it to REEF-014 -- akb://...". For a status change, name the new status and any side effect: "Moved REEF-012 to In Progress and assigned it to you".

## Phrase to status transition

Map intents to the lifecycle in issue-workflows.md. Common intents, in any language:

- "start development / begin work / pick this up" -> in_progress
- "put it up for review / PR is open / ready for review" -> in_review
- "it's done / shipped / merged / completed" -> done
- "cancel / drop it / won't do / it's a duplicate" -> closed (ask for or infer the closed_reason)

A backward move (reopen, or send a review back to in_progress) is the deliberate exception in issue-workflows.md; confirm first.

## Compound intents

A single sentence often implies several writes. Resolve them as a bundle, and confirm the parts you inferred in one question rather than several:

- "start development on REEF-012" = set status to in_progress + stamp last_status_change + set meta.source (for example ai-agent:user_request) + if the issue is unassigned and the speaker is taking it, propose assigning it to the actor (skip this if it is already assigned to them) + optionally propose adding it to the active sprint (see planning-workflows.md). Apply the status change; offer the assignee and sprint as part of the same one-line confirmation.
- "REEF-008 is done and shipped in 0.4" = set status done + propose linking the 0.4 release, after verifying that release row exists.

## Resolving which issue the user means

Users name issues by description, not always by id. If they do not give a reef id, search (a SQL title match, or akb_search) and resolve to a concrete issue. If several match, show the candidates and ask which one. If none match, say so rather than guessing.

## Planning links are a judgment call

reef-web never auto-assigns a sprint, milestone, or release on create. If this workspace has a convention (for example most issues share one milestone and release), treat matching it as a suggestion to confirm, not an automatic write.

A sprint is the special case, because it is a commitment and the default new-issue status (backlog) means "not committed yet": never pair a sprint with a backlog issue. If the user wants the new issue in the current sprint, that is itself a commitment to work it -- create it as todo (not backlog) with the sprint attached, and say so in your proposal ("I'll put REEF-042 in Sprint 5 and open it as Todo -- ok?"). Milestones and releases only group work, so they are fine on a backlog issue. See planning-workflows.md.
`;
}

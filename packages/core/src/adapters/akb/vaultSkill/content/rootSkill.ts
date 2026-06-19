export function rootSkillContent(vault: string): string {
  return `# ${vault} Reef PM Workspace Skill

This is a Reef PM workspace. Agents may replace the Reef UI for product-management work by using generic AKB MCP tools and the runbooks in this vault.

The runbooks hold the full procedures. The rules under "Non-negotiable invariants" below are load-bearing enough that they live here, in the always-loaded skill, so a skipped runbook never silently breaks an issue. Treat them as rules you already have in context; the named runbook explains each in depth.

## First rule

Use generic AKB MCP tools only: akb_get, akb_put, akb_update, akb_delete, akb_sql, akb_browse, akb_search, akb_whoami, and akb_vault_members. Do not create Reef-specific MCP tools. (akb_whoami resolves the acting user; akb_vault_members lists the workspace's people so you can propose a requester or assignee; akb_delete is for the compensation delete after a failed row insert.)

Reef PM entities are stored as AKB documents plus AKB tables. Do not treat this vault as a plain markdown vault.

## Non-negotiable invariants

These few rules, if broken, produce a malformed or invisible issue. They are short on purpose; the named runbook carries the rest.

1. **An issue is a document AND a row.** Every issue = an AKB document at issues/{reef_id}.md plus a reef_issues row linked by document_uri. A document with no row is invisible to the board. Never write one without the other. (issue-workflows.md)

2. **The AKB document type is always task -- for every issue, including bugs and epics.** The reef kind (epic/story/task/bug/spike/chore) is the issue_type column on the row, not the document type. Why: the AKB document-type enum is note/report/decision/spec/plan/session/task/reference/skill -- it has no "bug" or "epic", so akb rejects them. The product distinction lives only in the row. Do not put the reef kind into the akb_put type parameter. (pm-model.md)

3. **Seed the issue body from a matching template.** Read the vault's reef_templates and reuse the matching template's body and field defaults (priority, labels); template names vary per vault, so match by meaning rather than assuming the issue_type is a template name. If none fits, write a clean structured body of your own. Why: the Reef product UI creates issues from these templates; improvising a different structure makes runbook-path issues inconsistent with product-path ones. title_prefix (for example "Task: ") is a UI seed only -- never store it in the title. (issue-workflows.md)

4. **Planning links are a convention to honor, not an afterthought.** When the workspace shares a milestone/release or hangs issues under an epic, propose matching parent_id / milestone_id / release_id and confirm -- never leave a new issue all-null, never auto-write them silently. Why: a board where every issue shares one milestone/release but the newest one is unlinked reads as a mistake. A sprint is the exception: it is a commitment, so never attach one to a backlog issue -- a new issue going into the current sprint is created as todo, not backlog. (conversational-playbook.md + planning-workflows.md)

5. **Propose inferred fields, then write.** Anything you inferred or defaulted (issue_type, priority, assignee, planning links, a status side effect) goes into one short proposal the user can correct before you write. Do not interrogate field by field. Why: writes are last-write-wins across two non-transactional stores, and PM judgment -- not a fill-in form -- is the whole point of this workspace. (conversational-playbook.md)

## Read the runbook before you act

Creating an issue needs two runbooks, not one: conversational-playbook.md (what to decide, when to ask, planning-link judgment) and issue-workflows.md (the write mechanics). Reading only the mechanics one is the common miss -- it is how planning links and PM judgment get dropped. For other intents, read the one the router names; use akb_browse before akb_put on an unfamiliar collection.

- PM data model: akb://${vault}/doc/overview/reef/pm-model.md
- Creating and updating issues (mechanics): akb://${vault}/doc/overview/reef/issue-workflows.md
- Reading an issue's activity history and its comments: akb://${vault}/doc/overview/reef/comments-and-activity.md
- Acting like a PM (deciding fields, asking, confirming): akb://${vault}/doc/overview/reef/conversational-playbook.md
- Sprints, milestones, and releases: akb://${vault}/doc/overview/reef/planning-workflows.md
- AI drafts and status-change approval: akb://${vault}/doc/overview/reef/activity-inbox-workflows.md
- GitHub activity scanning: akb://${vault}/doc/overview/reef/github-activity-scan.md

## Intent router

Match the request to one path. Requests arrive in any language; route by meaning, not by literal wording. The example phrasings are illustrative, not exhaustive.

- Make a new issue ("Create an issue for the broken login redirect", "file a bug for X") means read conversational-playbook.md to decide the fields, then issue-workflows.md to write it. Resolve the actor and search for duplicates first.
- Move an issue along its lifecycle ("start development on REEF-012", "put it up for review", "Mark REEF-001 as done") means read conversational-playbook.md for the phrase-to-transition mapping and side effects, then issue-workflows.md for the transition mechanics.
- Edit issue fields ("reassign REEF-003 to me", "bump priority to high") means read issue-workflows.md for the update rules, using conversational-playbook.md judgment for anything left unspecified.
- Read an issue's history ("Show the history of REEF-012", "What changed on this issue", "Who moved it to in_review") means read comments-and-activity.md and query the reef_activity timeline.
- Read or write comments ("Show the comments on REEF-012", "Add a comment saying ...", "Reply on this issue") means read comments-and-activity.md for the reef_comments read, write, and edit rules.
- Plan ("create Sprint 5", "move these into the 0.4 milestone") means read planning-workflows.md.
- Review the AI inbox ("Show pending AI drafts", "Approve this draft", "Dismiss that suggestion") means read activity-inbox-workflows.md.
- Scan code activity ("Scan recent GitHub activity and create pending drafts") means read github-activity-scan.md.

## Before any write, always

- Resolve the acting user once with akb_whoami and use it as the semantic actor (meta.author / meta.last_editor). Never guess the actor from existing rows.
- Before creating an issue, search for an existing one (akb_search, or a SQL title match on reef_issues) so you do not file a duplicate.
- Honor the workspace authoring language for prose you generate. Before writing any generated prose -- an issue title, a body, or a status-change rationale, whether from a conversation or a code-activity scan -- read \`SELECT value FROM reef_settings WHERE key = 'authoring_language' LIMIT 1\`. If it is set (a JSON string code such as "ko" or "en"), write that prose in that language; if the row is missing, match the language of the existing issues. Translate prose only -- keep reef ids, enum values, labels, code identifiers, and URLs as-is, and never translate the user's own words back to them. (conversational-playbook.md)
- Apply the Non-negotiable invariants above, and state anything you inferred (issue_type, priority, assignee, planning links, a status side effect) in one short proposal the user can correct before you write. Do not interrogate field by field.
- After a write, read the result back in PM vocabulary with the reef id and the akb:// URI.

The intent router above is the single source of routing truth; the example phrasings ("Create an issue for the broken login redirect", "Mark REEF-001 as done", "Show pending AI drafts", "Approve this draft", "Scan recent GitHub activity and create pending drafts") are illustrative, not an exhaustive list.

## Hard rules

- Do not create an issue by writing only a markdown document.
- Do not write to Reef tables without preserving the domain invariants in these runbooks.
- Do not store credentials, tokens, cookies, or API keys in documents or tables.
- Use the akb:// URIs returned by AKB tools when referencing resources.
`;
}

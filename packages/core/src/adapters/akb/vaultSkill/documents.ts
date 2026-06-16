import { activityInboxWorkflowsContent } from "./content/activityInboxWorkflows";
import { conversationalPlaybookContent } from "./content/conversationalPlaybook";
import { githubActivityScanContent } from "./content/githubActivityScan";
import { issueWorkflowsContent } from "./content/issueWorkflows";
import { planningWorkflowsContent } from "./content/planningWorkflows";
import { pmModelContent } from "./content/pmModel";
import { rootSkillContent } from "./content/rootSkill";

export interface ReefVaultSkillDocument {
  path: string;
  collection: string;
  slug: string;
  title: string;
  type: "skill" | "reference";
  tags: string[];
  summary: string;
  content: string;
}

const ROOT_TAGS = ["akb:skill", "reef:pm-workspace"];
const RUNBOOK_TAGS = ["reef:pm-workspace", "reef:runbook"];

function docPath(collection: string, slug: string): string {
  return `${collection}/${slug}.md`;
}

export function buildReefVaultSkillDocuments(
  vault: string,
): ReefVaultSkillDocument[] {
  const rootCollection = "overview";
  const runbookCollection = "overview/reef";
  return [
    {
      path: docPath(rootCollection, "vault-skill"),
      collection: rootCollection,
      slug: "vault-skill",
      title: `${vault} Reef PM Workspace Skill`,
      type: "skill",
      tags: ROOT_TAGS,
      summary:
        "How agents should operate this Reef PM workspace through AKB MCP.",
      content: rootSkillContent(vault),
    },
    {
      path: docPath(runbookCollection, "pm-model"),
      collection: runbookCollection,
      slug: "pm-model",
      title: "Reef PM Data Model",
      type: "reference",
      tags: RUNBOOK_TAGS,
      summary:
        "Reef PM entities, tables, documents, columns, and relationships.",
      content: pmModelContent(vault),
    },
    {
      path: docPath(runbookCollection, "issue-workflows"),
      collection: runbookCollection,
      slug: "issue-workflows",
      title: "Reef Issue Workflows",
      type: "reference",
      tags: RUNBOOK_TAGS,
      summary:
        "How to create, update, transition, complete, and close Reef issues.",
      content: issueWorkflowsContent(),
    },
    {
      path: docPath(runbookCollection, "conversational-playbook"),
      collection: runbookCollection,
      slug: "conversational-playbook",
      title: "Reef Conversational Playbook",
      type: "reference",
      tags: RUNBOOK_TAGS,
      summary:
        "How to decide issue fields, ask the user, map phrasing to actions, and confirm like a PM.",
      content: conversationalPlaybookContent(),
    },
    {
      path: docPath(runbookCollection, "planning-workflows"),
      collection: runbookCollection,
      slug: "planning-workflows",
      title: "Reef Planning Workflows",
      type: "reference",
      tags: RUNBOOK_TAGS,
      summary:
        "How to manage sprints, milestones, releases, and issue planning links.",
      content: planningWorkflowsContent(),
    },
    {
      path: docPath(runbookCollection, "activity-inbox-workflows"),
      collection: runbookCollection,
      slug: "activity-inbox-workflows",
      title: "Reef Activity Inbox Workflows",
      type: "reference",
      tags: RUNBOOK_TAGS,
      summary: "How to review, approve, and dismiss AI activity suggestions.",
      content: activityInboxWorkflowsContent(),
    },
    {
      path: docPath(runbookCollection, "github-activity-scan"),
      collection: runbookCollection,
      slug: "github-activity-scan",
      title: "Reef GitHub Activity Scan",
      type: "reference",
      tags: RUNBOOK_TAGS,
      summary: "How to scan GitHub activity into pending Reef suggestions.",
      content: githubActivityScanContent(),
    },
  ];
}

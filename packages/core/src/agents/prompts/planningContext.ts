import type { PlanningCatalog } from "../../schemas/planning/catalog";

interface PlanningContextPromptOptions {
  heading: string;
  unavailableHeading: string;
  noneHeading: string;
  includeDateInferenceRule?: boolean;
}

export function formatPlanningContextForPrompt(
  catalog: PlanningCatalog | undefined,
  {
    heading,
    unavailableHeading,
    noneHeading,
    includeDateInferenceRule = false,
  }: PlanningContextPromptOptions,
): string {
  if (!catalog) return unavailableHeading;

  const sprints = catalog.sprints.filter((s) => s.status !== "closed");
  const milestones = catalog.milestones.filter((m) => m.status === "open");
  const releases = catalog.releases.filter((r) => r.status !== "released");

  if (
    sprints.length === 0 &&
    milestones.length === 0 &&
    releases.length === 0
  ) {
    return noneHeading;
  }

  let prompt = heading;
  if (sprints.length > 0) {
    prompt += "Sprints:\n";
    for (const sprint of sprints) {
      const dates = [
        sprint.start_date ? `start:${sprint.start_date}` : "",
        sprint.end_date ? `end:${sprint.end_date}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      prompt += `  - ${sprint.id} | ${sprint.name} | status:${sprint.status}${dates ? ` | ${dates}` : ""}\n`;
    }
  }
  if (milestones.length > 0) {
    prompt += "Milestones:\n";
    for (const milestone of milestones) {
      prompt += `  - ${milestone.id} | ${milestone.name} | status:${milestone.status}${
        milestone.target_date ? ` | target:${milestone.target_date}` : ""
      }\n`;
    }
  }
  if (releases.length > 0) {
    prompt += "Releases:\n";
    for (const release of releases) {
      prompt += `  - ${release.id} | ${release.name} | status:${release.status}${
        release.target_date ? ` | target:${release.target_date}` : ""
      }\n`;
    }
  }
  if (includeDateInferenceRule) {
    prompt +=
      "\nUse planning IDs only when the activity explicitly names the planning item. Do not infer from date ranges alone.\n";
  }
  return prompt;
}

import type { Template } from "../../schemas/issues/template";

export interface TemplateCatalogItem {
  name: string;
  label: string;
  description: string;
  title_prefix?: string;
  priority?: Template["priority"];
  default_labels: string[];
}

export function templateToCatalogItem(template: Template): TemplateCatalogItem {
  return {
    name: template.name,
    label: template.label,
    description: template.description,
    ...(template.title_prefix ? { title_prefix: template.title_prefix } : {}),
    ...(template.priority ? { priority: template.priority } : {}),
    default_labels: template.default_labels ?? [],
  };
}

export function formatTemplateCatalog(
  templates: readonly TemplateCatalogItem[],
  heading = "Issue Templates",
): string {
  let prompt = `${heading}:\n`;
  if (templates.length === 0) {
    prompt += "  (none)\n";
    return prompt;
  }

  for (const template of templates) {
    const details = [
      `name:${template.name}`,
      `label:${template.label}`,
      template.title_prefix ? `title_prefix:${template.title_prefix}` : "",
      template.priority ? `priority:${template.priority}` : "",
      `default_labels:[${template.default_labels.join(", ")}]`,
      template.description ? `description:${template.description}` : "",
    ].filter(Boolean);
    prompt += `  - ${details.join(" | ")}\n`;
  }
  return prompt;
}

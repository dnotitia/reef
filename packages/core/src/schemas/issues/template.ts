import { z } from "zod";
import { PriorityEnum } from "./metadata";

/**
 * Pattern enforced on `name` — the logical template id. Lowercase ASCII,
 * digits, and hyphens just. Used as the `name` key of a `reef_templates` table
 * row and as the `params.name` argument accepted by `readTemplate` /
 * `writeTemplate` / `deleteTemplate` in the akb adapter. The route handler
 * validates the URL segment against this same pattern.
 */
export const TEMPLATE_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * TemplateSchema — issue template stored as one row in the `reef_templates`
 * akb table, addressed by its `name`.
 *
 * Storage: every field is a typed column on the row — `body` is a plain `text`
 * column, not a backing document (templates are self-contained boilerplate
 * "material", not searchable akb documents). This is the single source of
 * truth for both core adapters and the web `<TemplatePicker>` / Settings UI.
 *
 *   name           — the `reef_templates.name` row key, also the stable id
 *                    used as React key and DOM test selector
 *                    (`template-option-${name}`). Rename = delete-then-create.
 *   label          — human-readable display name shown in the picker list.
 *   description    — one-line hint under the label in the picker.
 *   title_prefix   — optional prefix injected into the new issue title (e.g.
 *                    "Bug: "); empty/omitted leaves the user's title alone.
 *   priority       — optional pre-selected priority when the template applies.
 *   default_labels — labels pre-filled on the new issue (semantically the
 *                    template's "suggested labels"). Defaults to [] so call
 *                    sites can iterate without null-checks.
 *   body           — markdown body inserted into the description editor.
 */
export const TemplateSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .regex(
      TEMPLATE_NAME_PATTERN,
      "name must be lowercase letters, digits, hyphens only (used as filename stem)",
    ),
  label: z.string().min(1, "label is required"),
  description: z.string(),
  title_prefix: z.string().optional(),
  priority: PriorityEnum.optional(),
  default_labels: z.array(z.string()).default([]),
  body: z.string(),
});

export type Template = z.infer<typeof TemplateSchema>;

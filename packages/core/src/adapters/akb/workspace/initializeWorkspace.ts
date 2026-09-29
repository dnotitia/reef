import { SchemaValidationError } from "../../../errors";
import { type Config, DEFAULT_CONFIG } from "../../../schemas/workspace/config";
import type { Template } from "../../../schemas/issues/template";
import { readConfig, initializeConfigIfMissing } from "./config";
import { listTemplates, initializeTemplateIfMissing } from "./templates";
import {
  getVaultSkillStatus,
  hasReefVaultSkillDocuments,
  installReefVaultSkill,
} from "../vaultSkill/vaultSkill";
import type { AkbAdapter } from "../core/http";
import { withSpan } from "../core/tracing";

/**
 * Complete Reef's data initialization after AKB reports the app installation
 * active. Repeated calls preserve saved settings, template edits, and customized
 * vault-skill documents; AKB remains responsible for schema ownership.
 */
export async function initializeReefWorkspace(params: {
  adapter: AkbAdapter;
  vault: string;
  defaultTemplates: readonly Template[];
  initialConfig?: Config;
}): Promise<Config> {
  const {
    adapter,
    vault,
    defaultTemplates,
    initialConfig = DEFAULT_CONFIG,
  } = params;

  return withSpan(
    "akb.initialize_reef_workspace",
    { vault, default_template_count: defaultTemplates.length },
    async (span) => {
      const existingConfig = await readConfig({ adapter, vault });
      if (!existingConfig.exists) {
        await initializeConfigIfMissing({
          adapter,
          vault,
          config: initialConfig,
        });
      }

      const existingTemplates = await listTemplates({ adapter, vault });
      const names = new Set(
        existingTemplates.map(({ template }) => template.name),
      );
      const missingTemplates = defaultTemplates.filter(
        (template) => !names.has(template.name),
      );
      for (const template of missingTemplates) {
        await initializeTemplateIfMissing({ adapter, vault, template });
      }

      const skillStatus = await getVaultSkillStatus({ adapter, vault });
      const hasSkillDocuments = await hasReefVaultSkillDocuments({
        adapter,
        vault,
      });
      if (!skillStatus.up_to_date || !hasSkillDocuments) {
        await installReefVaultSkill({
          adapter,
          vault,
          preserveExisting: true,
        });
      }

      const result = await readConfig({ adapter, vault });
      if (!result.exists) {
        throw new SchemaValidationError({
          issues: [
            "Workspace configuration is unavailable after initialization",
          ],
        });
      }
      span.setAttribute("workspace.templates_added", missingTemplates.length);
      span.setAttribute("workspace.skill_current", true);
      return result.config;
    },
  );
}

import { z } from "zod";

/**
 * Shape of the `reef_settings.value` JSON stored under the `vault_skill` key.
 * Written by `installReefVaultSkill` after the skill documents land; read back
 * by `getVaultSkillStatus`. Kept deliberately small — version is the comparison
 * key, `synced_at` is display ("last synced …").
 */
export const StoredVaultSkillSchema = z.object({
  version: z.number().int().nonnegative(),
  synced_at: z.string().min(1),
});

export type StoredVaultSkill = z.infer<typeof StoredVaultSkillSchema>;

/**
 * Status surfaced to the Settings UI. `installed_version` is `null` for a vault
 * onboarded before the stamp existed (older) — treated as not up to date so
 * the first re-apply backfills it. `up_to_date` is derived server-side
 * (`installed_version === current_version`) so the client does not re-implements
 * the comparison. `can_write` is intentionally absent: the client derives it
 * from the vault `role` it already holds, and the POST is the real guard.
 */
export const VaultSkillStatusSchema = z.object({
  installed_version: z.number().int().nonnegative().nullable(),
  current_version: z.number().int().nonnegative(),
  up_to_date: z.boolean(),
  synced_at: z.string().nullable(),
});

export type VaultSkillStatus = z.infer<typeof VaultSkillStatusSchema>;

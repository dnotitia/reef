// ─── Reef vault-skill version ─────────────────────────────────────────────────
//
// The vault-skill documents (`buildReefVaultSkillDocuments`) are the agent
// playbook a Reef workspace runs on. They are installed once at vault creation
// and does not re-synced automatically, so a release that changes the playbook
// leaves existing vaults on the old text. This monotonic integer is the
// comparison key: it is stamped into `reef_settings` on install, and the
// Settings UI compares the stamped value against this constant to surface an
// explicit "update available" affordance.
//
// Bump discipline: increment this by 1 in the SAME change that edits any
// `vaultSkill/content/*` file (or `documents.ts`). The co-located
// `vaultSkill.version.test.ts` digests the current document set and fails if
// the content changed without a matching bump — that guard is the thing
// standing between "I edited a runbook" and "every vault silently drifts".
//
// This is an INTENTIONAL release version, not a content hash. Whitespace
// or non-substantive edits do not have to bump it (the guard test's snapshot is
// updated in the same commit); the point is that PMs see "newer instructions"
// when the team meant to ship newer instructions.
export const REEF_VAULT_SKILL_VERSION = 13;

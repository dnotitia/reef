import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildReefVaultSkillDocuments } from "./documents";

/**
 * Guard test for `REEF_VAULT_SKILL_VERSION`.
 *
 * The skill document set is the agent playbook a Reef workspace runs on. When
 * it changes, existing vaults should be told (via the Settings "update available"
 * affordance), which just happens if `REEF_VAULT_SKILL_VERSION` is bumped. This
 * test pins a digest of the canonical document set so a content edit that
 * forgets the bump fails CI.
 *
 * When this fails because you intentionally changed the skill content:
 *   1. Bump `REEF_VAULT_SKILL_VERSION` in `version.ts` (so vaults drift-detect).
 *   2. Replace `EXPECTED_CONTENT_DIGEST` below with the digest this test prints.
 *   Do both in the SAME commit.
 *
 * The digest covers each document's path + content, so reordering, renaming, or
 * editing any runbook trips it. The vault name is fixed so the digest is stable.
 */
const EXPECTED_CONTENT_DIGEST =
  "72ed891c977fd8442d3d2bf30e7de3c2e48377012aade54750222798f849c3a3";

function digestSkillContent(vault: string): string {
  const docs = buildReefVaultSkillDocuments(vault);
  const hash = createHash("sha256");
  for (const doc of docs) {
    hash.update(doc.path);
    hash.update("\0");
    hash.update(doc.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

describe("REEF_VAULT_SKILL_VERSION guard", () => {
  it("skill document content matches the pinned digest", () => {
    // If this fails, see the header comment — bump the version and the digest
    // together so existing vaults are offered the update.
    expect(digestSkillContent("reef")).toBe(EXPECTED_CONTENT_DIGEST);
  });
});

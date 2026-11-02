export const issueRelationMigration = {
  id: "issue-relation-uris",
  async inspect({ core, adapter, params, checkpoints }) {
    const relations = await core.akbInspectIssueRelationUris({
      ...params,
      checkpoints,
    });
    const instructions = await core.akbGetVaultSkillStatus({
      adapter,
      vault: params.vault,
    });
    const instructionsRequired =
      !instructions.up_to_date ||
      !(await core.akbHasReefVaultSkillDocuments({
        adapter,
        vault: params.vault,
      }));
    return {
      required: relations.pending_count > 0 || instructionsRequired,
      count: relations.count,
      instructionsRequired,
    };
  },
  async apply({
    core,
    adapter,
    params,
    assessment,
    checkpoints,
    onCheckpoint,
    onProgress,
  }) {
    if (assessment.instructionsRequired)
      await core.akbInstallReefVaultSkill({ adapter, vault: params.vault });
    return core.akbApplyIssueRelationUris({
      ...params,
      checkpoints,
      onCheckpoint,
      onProgress,
    });
  },
  async verify({
    core,
    params,
    checkpoints,
    onProgress,
    verificationTimeoutMs,
  }) {
    return core.akbVerifyIssueRelationUris({
      ...params,
      checkpoints,
      onProgress,
      verificationTimeoutMs,
    });
  },
};

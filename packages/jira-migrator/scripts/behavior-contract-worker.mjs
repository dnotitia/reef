import { runJiraMigration } from "../dist/index.js";

const config = JSON.parse(process.env.REEF_BEHAVIOR_CONFIG ?? "null");
if (!config) throw new Error("behavior_config_missing");

const json = async (path, init) => {
  const response = await fetch(`${config.target.baseUrl}${path}`, init);
  if (!response.ok) throw new Error(`mock_akb_${response.status}`);
  return response.json();
};

const related = {
  createComment: async () => {
    throw new Error("unexpected_comment_write");
  },
  updateComment: async () => {
    throw new Error("unexpected_comment_write");
  },
  readComment: async () => null,
  findCommentByIdempotencyKey: async () => null,
  deleteComment: async () => undefined,
  createAttachment: async () => {
    throw new Error("unexpected_attachment_write");
  },
  readAttachment: async () => null,
  findAttachmentByJiraId: async () => null,
  revokeAttachment: async () => undefined,
  hasMediaReference: async () => false,
  readDescription: async () => "",
  updateDescription: async () => undefined,
  putRelation: (input) =>
    json("/relations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(() => undefined),
  hasRelation: (key) =>
    json(`/relations/${encodeURIComponent(key)}`).then(
      (value) => value !== null,
    ),
  readRelation: (key) => json(`/relations/${encodeURIComponent(key)}`),
  deleteRelation: (key) =>
    json(`/relations/${encodeURIComponent(key)}`, { method: "DELETE" }).then(
      () => undefined,
    ),
  putExternalRef: (input) =>
    json("/external-refs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(() => undefined),
  hasExternalRef: (key) =>
    json(`/external-refs/${encodeURIComponent(key)}`).then(
      (value) => value !== null,
    ),
  readExternalRef: (key) => json(`/external-refs/${encodeURIComponent(key)}`),
  listExternalRefKeys: (prefix) =>
    json(`/external-refs?prefix=${encodeURIComponent(prefix)}`),
  deleteExternalRef: (key) =>
    json(`/external-refs/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }).then(() => undefined),
};

const target = {
  adapter: {},
  preflight: () => json("/preflight"),
  planIssueIds: (owners) =>
    json("/reserve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: owners.length }),
    }),
  applyPlanning: async () => {
    throw new Error("unexpected_planning_write");
  },
  applyIssue: async (plan, action) => {
    const desired = plan.desired.issue;
    const written = await json("/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        issue: desired,
        content: plan.desired.content,
      }),
    });
    const readback = await json(`/issues/${encodeURIComponent(desired.id)}`);
    if (
      readback.issue.id !== desired.id ||
      readback.issue.title !== desired.title
    ) {
      throw new Error("mock_akb_issue_readback_failed");
    }
    return written;
  },
  readIssue: (id) => json(`/issues/${encodeURIComponent(id)}`),
  claimIssue: async () => undefined,
  relatedTarget: () => related,
  appendActivity: (events) =>
    json("/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events),
    }).then(() => undefined),
};

try {
  const result = await runJiraMigration(config, {
    target,
    ...(process.env.REEF_BEHAVIOR_FAIL_AFTER
      ? {
          failAfterConfirmedEntities: Number(
            process.env.REEF_BEHAVIOR_FAIL_AFTER,
          ),
        }
      : {}),
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      run_id: result.runId,
      mode: result.mode,
      plan_sha256: result.planSha256,
      status: result.report.run.status,
      conservation: result.report.conservation,
      totals: result.report.totals,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      code:
        error && typeof error === "object" && "code" in error
          ? error.code
          : error instanceof Error
            ? error.name
            : "unknown_error",
    })}\n`,
  );
  process.exitCode = 1;
}

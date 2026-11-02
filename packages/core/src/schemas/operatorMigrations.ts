import { z } from "zod";
import { IssueRelationBackfillReportSchema } from "./issueRelationBackfill";

export const OperatorMigrationCheckpointIndexSchema = z
  .array(z.string().min(1))
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Duplicate checkpoint identity",
  );

const TargetIdentitySchema = z.object({
  installation_id: z.uuid(),
  vault_id: z.uuid(),
  vault: z.string().min(1),
});
const TargetResultSchema = TargetIdentitySchema.extend({
  status: z.enum([
    "required",
    "not_required",
    "running",
    "completed",
    "failed",
  ]),
  count: z.number().int().nonnegative().nullable(),
  failure: IssueRelationBackfillReportSchema.optional(),
});
const AttemptSchema = z
  .object({
    attempt_id: z.uuid(),
    release_id: z.uuid(),
    source_revision: z.string().regex(/^[a-f0-9]{40}$/u),
    started_at: z.iso.datetime(),
    finished_at: z.iso.datetime().nullable(),
    status: z.enum(["running", "completed", "failed", "interrupted"]),
    targets: z.array(TargetResultSchema),
    failure_code: z
      .enum([
        "assessment_failed",
        "migration_incomplete",
        "inventory_changed",
        "checkpoint_error",
      ])
      .optional(),
  })
  .superRefine((attempt, ctx) => {
    if ((attempt.status === "running") !== (attempt.finished_at === null))
      ctx.addIssue({
        code: "custom",
        message: "Attempt lifecycle is inconsistent",
      });
    if (
      attempt.status === "completed" &&
      attempt.targets.some(
        (target) => !["completed", "not_required"].includes(target.status),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Completed attempt has unfinished targets",
      });
  });

/** Private operator progress; never a per-vault schema stamp or product table. */
export const OperatorMigrationStateSchema = z
  .object({
    kind: z.literal("reef-operator-migrations"),
    backend_url: z.url(),
    app_id: z.uuid(),
    migrations: z.array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]*$/u),
        checkpoints: z.array(
          TargetIdentitySchema.extend({
            checkpoint_count: z.number().int().nonnegative(),
          }),
        ),
        attempts: z.array(AttemptSchema),
      }),
    ),
  })
  .superRefine((state, ctx) => {
    if (
      new Set(state.migrations.map((migration) => migration.id)).size !==
      state.migrations.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate migration identity" });
    for (const migration of state.migrations) {
      if (
        new Set(migration.checkpoints.map((target) => target.installation_id))
          .size !== migration.checkpoints.length ||
        new Set(migration.attempts.map((attempt) => attempt.attempt_id))
          .size !== migration.attempts.length ||
        migration.attempts.some(
          (attempt) =>
            new Set(attempt.targets.map((target) => target.installation_id))
              .size !== attempt.targets.length,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Duplicate migration progress identity",
        });
    }
  });
export type OperatorMigrationState = z.infer<
  typeof OperatorMigrationStateSchema
>;

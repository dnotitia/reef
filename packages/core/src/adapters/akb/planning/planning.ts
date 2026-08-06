import { SchemaValidationError } from "../../../errors";
import {
  type Milestone,
  MilestoneCreateSchema,
  MilestoneSchema,
  type PlanningCatalog,
  PlanningCatalogSchema,
  type Release,
  ReleaseCreateSchema,
  ReleaseSchema,
  type Sprint,
  SprintCreateSchema,
  SprintSchema,
} from "../../../schemas/planning/catalog";
import {
  type AkbAdapter,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SPRINTS_TABLE,
  ensureReefTables,
  isMissingTableError,
  quoteText,
  withSpan,
} from "../core/shared";
import type {
  CreateMilestoneParams,
  CreateReleaseParams,
  CreateSprintParams,
  DeleteMilestoneParams,
  DeleteReleaseParams,
  DeleteSprintParams,
  ListPlanningCatalogParams,
  ReadPlanningCreateClaimParams,
  UpdateMilestoneParams,
  UpdateReleaseParams,
  UpdateSprintParams,
} from "../core/types";
import {
  assertPlanningItemNotReferenced,
  assertUniquePlanningName,
  claimAndReadPlanningRow,
  deletePlanningRow,
  insertAndReadPlanningRow,
  milestoneRowFields,
  releaseRowFields,
  rowToMilestone,
  rowToRelease,
  rowToSprint,
  selectPlanningRows,
  sprintRowFields,
  updatePlanningRow,
} from "./planningRows";

const CREATE_IDEMPOTENCY_META_KEY = "create_idempotency_key";

export async function readPlanningCreateClaim(
  params: ReadPlanningCreateClaimParams,
): Promise<Release | Sprint | null> {
  const { adapter, vault, kind, idempotencyKey } = params;
  const table = kind === "release" ? REEF_RELEASES_TABLE : REEF_SPRINTS_TABLE;
  const rows = await selectPlanningRows(
    adapter,
    vault,
    table,
    `meta->>${quoteText(CREATE_IDEMPOTENCY_META_KEY, "planning claim field")} = ${quoteText(idempotencyKey, "planning idempotency key")}`,
  );
  if (rows.length > 1) {
    throw new SchemaValidationError({
      issues: ["planning idempotency claim is ambiguous"],
    });
  }
  const row = rows[0];
  if (!row) return null;
  return kind === "release" ? rowToRelease(row) : rowToSprint(row);
}

export async function listPlanningCatalog(
  params: ListPlanningCatalogParams,
): Promise<PlanningCatalog> {
  const { adapter, vault } = params;
  return withSpan("akb.list_planning_catalog", { vault }, async (span) => {
    try {
      const [sprintRows, milestoneRows, releaseRows] = await Promise.all([
        selectPlanningRows(adapter, vault, REEF_SPRINTS_TABLE),
        selectPlanningRows(adapter, vault, REEF_MILESTONES_TABLE),
        selectPlanningRows(adapter, vault, REEF_RELEASES_TABLE),
      ]);
      const catalog = PlanningCatalogSchema.parse({
        sprints: sprintRows.map(rowToSprint),
        milestones: milestoneRows.map(rowToMilestone),
        releases: releaseRows.map(rowToRelease),
      });
      span.setAttribute("sprint_count", catalog.sprints.length);
      span.setAttribute("milestone_count", catalog.milestones.length);
      span.setAttribute("release_count", catalog.releases.length);
      return catalog;
    } catch (err) {
      if (isMissingTableError(err)) {
        span.setAttribute("table_exists", false);
        return { sprints: [], milestones: [], releases: [] };
      }
      throw err;
    }
  });
}

export async function createSprint(
  params: CreateSprintParams,
): Promise<Sprint> {
  const { adapter, vault, item, idempotencyKey } = params;
  return withSpan("akb.create_sprint", { vault }, async () => {
    await ensureReefTables({ adapter, vault });
    // Validate before the insert — akb assigns the uuid id, but the other
    // fields should be checked here so an invalid row does not persists.
    const validated = SprintCreateSchema.parse(item);
    return claimAndReadPlanningRow({
      adapter,
      vault,
      table: REEF_SPRINTS_TABLE,
      fields: sprintRowFields(
        validated,
        idempotencyKey ? { [CREATE_IDEMPOTENCY_META_KEY]: idempotencyKey } : {},
      ),
      name: validated.name,
      idempotencyKey,
      idempotencyMetaKey: CREATE_IDEMPOTENCY_META_KEY,
      toItem: rowToSprint,
      isCompatible: (item) =>
        item.name === validated.name &&
        item.status === validated.status &&
        (item.start_date ?? null) === (validated.start_date ?? null) &&
        (item.end_date ?? null) === (validated.end_date ?? null) &&
        item.goal === validated.goal &&
        (item.capacity_points ?? null) === (validated.capacity_points ?? null),
    });
  });
}

export async function updateSprint(
  params: UpdateSprintParams,
): Promise<Sprint> {
  const { adapter, vault, id, item } = params;
  return withSpan("akb.update_sprint", { vault, id }, async () => {
    if (item.id !== id) {
      throw new SchemaValidationError({
        issues: ["sprint id in body must match URL id"],
      });
    }
    const sprint = SprintSchema.parse(item);
    await ensureReefTables({ adapter, vault });
    await assertUniquePlanningName(
      adapter,
      vault,
      REEF_SPRINTS_TABLE,
      sprint.name,
      id,
    );
    await updatePlanningRow(
      adapter,
      vault,
      REEF_SPRINTS_TABLE,
      id,
      sprintRowFields(sprint),
    );
    return sprint;
  });
}

export async function deleteSprint(params: DeleteSprintParams): Promise<void> {
  const { adapter, vault, id } = params;
  return withSpan("akb.delete_sprint", { vault, id }, async () => {
    await assertPlanningItemNotReferenced(adapter, vault, "sprint_id", id);
    await deletePlanningRow(adapter, vault, REEF_SPRINTS_TABLE, id);
  });
}

export async function createMilestone(
  params: CreateMilestoneParams,
): Promise<Milestone> {
  const { adapter, vault, item } = params;
  return withSpan("akb.create_milestone", { vault }, async () => {
    await ensureReefTables({ adapter, vault });
    const validated = MilestoneCreateSchema.parse(item);
    await assertUniquePlanningName(
      adapter,
      vault,
      REEF_MILESTONES_TABLE,
      validated.name,
    );
    return insertAndReadPlanningRow(
      adapter,
      vault,
      REEF_MILESTONES_TABLE,
      milestoneRowFields(validated),
      rowToMilestone,
    );
  });
}

export async function updateMilestone(
  params: UpdateMilestoneParams,
): Promise<Milestone> {
  const { adapter, vault, id, item } = params;
  return withSpan("akb.update_milestone", { vault, id }, async () => {
    if (item.id !== id) {
      throw new SchemaValidationError({
        issues: ["milestone id in body must match URL id"],
      });
    }
    const milestone = MilestoneSchema.parse(item);
    await ensureReefTables({ adapter, vault });
    await assertUniquePlanningName(
      adapter,
      vault,
      REEF_MILESTONES_TABLE,
      milestone.name,
      id,
    );
    await updatePlanningRow(
      adapter,
      vault,
      REEF_MILESTONES_TABLE,
      id,
      milestoneRowFields(milestone),
    );
    return milestone;
  });
}

export async function deleteMilestone(
  params: DeleteMilestoneParams,
): Promise<void> {
  const { adapter, vault, id } = params;
  return withSpan("akb.delete_milestone", { vault, id }, async () => {
    await assertPlanningItemNotReferenced(adapter, vault, "milestone_id", id);
    await deletePlanningRow(adapter, vault, REEF_MILESTONES_TABLE, id);
  });
}

export async function createRelease(
  params: CreateReleaseParams,
): Promise<Release> {
  const { adapter, vault, item, idempotencyKey } = params;
  return withSpan("akb.create_release", { vault }, async () => {
    await ensureReefTables({ adapter, vault });
    const validated = ReleaseCreateSchema.parse(item);
    return claimAndReadPlanningRow({
      adapter,
      vault,
      table: REEF_RELEASES_TABLE,
      fields: releaseRowFields(
        validated,
        idempotencyKey ? { [CREATE_IDEMPOTENCY_META_KEY]: idempotencyKey } : {},
      ),
      name: validated.name,
      idempotencyKey,
      idempotencyMetaKey: CREATE_IDEMPOTENCY_META_KEY,
      toItem: rowToRelease,
      isCompatible: (item) =>
        item.name === validated.name &&
        item.status === validated.status &&
        (item.target_date ?? null) === (validated.target_date ?? null) &&
        (item.released_at ?? null) === (validated.released_at ?? null) &&
        item.notes === validated.notes,
    });
  });
}

export async function updateRelease(
  params: UpdateReleaseParams,
): Promise<Release> {
  const { adapter, vault, id, item } = params;
  return withSpan("akb.update_release", { vault, id }, async () => {
    if (item.id !== id) {
      throw new SchemaValidationError({
        issues: ["release id in body must match URL id"],
      });
    }
    const release = ReleaseSchema.parse(item);
    await ensureReefTables({ adapter, vault });
    await assertUniquePlanningName(
      adapter,
      vault,
      REEF_RELEASES_TABLE,
      release.name,
      id,
    );
    await updatePlanningRow(
      adapter,
      vault,
      REEF_RELEASES_TABLE,
      id,
      releaseRowFields(release),
    );
    return release;
  });
}

export async function deleteRelease(
  params: DeleteReleaseParams,
): Promise<void> {
  const { adapter, vault, id } = params;
  return withSpan("akb.delete_release", { vault, id }, async () => {
    await assertPlanningItemNotReferenced(adapter, vault, "release_id", id);
    await deletePlanningRow(adapter, vault, REEF_RELEASES_TABLE, id);
  });
}

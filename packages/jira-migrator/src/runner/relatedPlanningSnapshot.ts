import type { AkbReadIssueResult } from "@reef/core";
import { canonicalizeJson } from "../rawArchive.js";
import type {
  JiraIssueAttachmentActivityActor,
  JiraRelatedImportTarget,
} from "../related/contracts.js";
import { sidecarFor } from "./targetSupport.js";

type ExternalRefReadback = Awaited<
  ReturnType<JiraRelatedImportTarget["readExternalRef"]>
>;
type RelationReadback = Awaited<
  ReturnType<JiraRelatedImportTarget["readRelation"]>
>;

const hasEquivalentExternalRef = (
  readback: AkbReadIssueResult,
  ref: NonNullable<ExternalRefReadback>["ref"],
): boolean =>
  (readback.issue.external_refs ?? []).some(
    (candidate) => canonicalizeJson(candidate) === canonicalizeJson(ref),
  );

export const createRelatedPlanningSnapshot = (input: {
  target: JiraRelatedImportTarget;
  issueReadbacks: ReadonlyMap<string, AkbReadIssueResult | null>;
  externalRefKeys?: readonly string[];
  fallbackAttachmentActors?: readonly JiraIssueAttachmentActivityActor[];
}): JiraRelatedImportTarget => {
  const readbacks = input.issueReadbacks;
  const externalRefs = new Map<string, ExternalRefReadback | "ambiguous">();
  const relations = new Map<string, RelationReadback | "ambiguous">();
  for (const readback of readbacks.values()) {
    if (!readback) continue;
    for (const record of sidecarFor(readback.issue).externalRefs) {
      const value: NonNullable<ExternalRefReadback> = {
        reefId: record.reefId,
        ref: record.ref,
        provenance: record.provenance,
      };
      const verified =
        readback.issue.id === record.reefId &&
        hasEquivalentExternalRef(readback, record.ref)
          ? value
          : null;
      externalRefs.set(
        record.idempotencyKey,
        externalRefs.has(record.idempotencyKey) ? "ambiguous" : verified,
      );
    }
    for (const record of sidecarFor(readback.issue).relations) {
      const source = readbacks.get(record.sourceReefId);
      const target = readbacks.get(record.targetReefId);
      const verified =
        source &&
        target &&
        (source.issue[record.relation] ?? []).includes(record.targetReefId) &&
        (target.issue[record.inverseRelation] ?? []).includes(
          record.sourceReefId,
        )
          ? {
              sourceReefId: record.sourceReefId,
              targetReefId: record.targetReefId,
              relation: record.relation,
              inverseRelation: record.inverseRelation,
            }
          : null;
      relations.set(
        record.idempotencyKey,
        relations.has(record.idempotencyKey) ? "ambiguous" : verified,
      );
    }
  }
  const fallbackActorsByIssue = new Map<
    string,
    JiraIssueAttachmentActivityActor[]
  >();
  for (const actor of input.fallbackAttachmentActors ?? []) {
    const actors = fallbackActorsByIssue.get(actor.reefId) ?? [];
    actors.push(actor);
    fallbackActorsByIssue.set(actor.reefId, actors);
  }
  const externalRefKeys = input.externalRefKeys
    ? [...input.externalRefKeys]
    : null;
  const overrides: Partial<JiraRelatedImportTarget> = {
    ...(externalRefKeys
      ? {
          async listExternalRefKeys(prefix: string) {
            return externalRefKeys.filter((key) => key.startsWith(prefix));
          },
        }
      : {}),
    ...(input.fallbackAttachmentActors
      ? {
          async listFallbackAttachmentActivityActors(reefId: string) {
            return (fallbackActorsByIssue.get(reefId) ?? []).map(
              ({ eventKey, actor }) => ({ eventKey, actor }),
            );
          },
        }
      : {}),
    async readExternalRef(idempotencyKey: string) {
      const cached = externalRefs.get(idempotencyKey);
      if (cached === "ambiguous") {
        throw new Error("target_external_refs_idempotency_key_ambiguous");
      }
      if (cached !== undefined) return cached;
      return input.target.readExternalRef(idempotencyKey);
    },
    async readRelation(idempotencyKey: string) {
      const cached = relations.get(idempotencyKey);
      if (cached === "ambiguous") {
        throw new Error("target_relations_idempotency_key_ambiguous");
      }
      if (cached !== undefined) return cached;
      return input.target.readRelation(idempotencyKey);
    },
    async hasMediaReference(reefId: string, fileUri: string) {
      const cached = readbacks.get(reefId);
      return cached
        ? cached.content.includes(fileUri)
        : input.target.hasMediaReference(reefId, fileUri);
    },
    async readDescription(reefId: string) {
      const cached = readbacks.get(reefId);
      return cached ? cached.content : input.target.readDescription(reefId);
    },
  };
  return new Proxy(input.target, {
    get(target, property, receiver) {
      const override = overrides[property as keyof JiraRelatedImportTarget];
      if (override) return override;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

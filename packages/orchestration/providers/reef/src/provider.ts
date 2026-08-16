import { createHash } from "node:crypto";
import {
  type AkbAdapter,
  type AkbReadIssueResult,
  type ImplementationRef,
  type IssueUpdateInput,
  akbCreateComment,
  akbGetCurrentActor,
  akbReadIssue,
  akbUpdateIssue,
  buildIssueUpdateMetadataPatch,
} from "@reef/core";
import {
  type ProviderArtifact,
  ProviderError,
  type ProviderRequestContext,
  WORK_CAPABILITIES,
  type WorkProvider,
  type WorkReport,
  type WorkSnapshot,
  executeProviderOperation,
} from "@reef/orchestrator";
import { z } from "zod";
import { type ReefWorkUri, ReefWorkUriError, parseReefWorkUri } from "./uri.js";

const PROVIDER_ID = "reef";
const PROVIDER_VERSION = "1.0.0";
const LIFECYCLE_SOURCE = "orchestrator:reef-work-provider";
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

const ArtifactKindSchema = z.enum([
  "branch",
  "commit",
  "file",
  "proof",
  "pull_request",
  "report",
]);

const ArtifactInputSchema = z.strictObject({
  kind: ArtifactKindSchema,
  ref: z.string().refine((value) => value.trim().length > 0),
  uri: z
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    })
    .optional(),
  title: z.string().optional(),
});

const ReportInputSchema = z.strictObject({
  uri: z.string().min(1),
  revision: z.string().min(1),
  outcome: z.enum(["failed", "pending", "succeeded"]),
  summary: z.string().refine((value) => value.trim().length > 0),
});

type SupportedArtifactKind = ImplementationRef["type"];

export interface ReefWorkProviderOptions {
  readonly adapter: AkbAdapter;
  readonly jwt: string;
  readonly vault: string;
  readonly repository: string;
  readonly clock?: () => Date;
}

interface ReefWorkState {
  readonly parsed: ReefWorkUri;
  readonly work: AkbReadIssueResult;
  readonly dependencies: readonly AkbReadIssueResult[];
  readonly actor: string;
}

class RejectedOperation extends Error {
  constructor() {
    super("reef_work_operation_rejected");
    this.name = "RejectedOperation";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function rejectOperation(): never {
  throw new RejectedOperation();
}

function providerRequestFailure(operation: string): ProviderError {
  return ProviderError.classified(
    {
      kind: "work",
      providerId: PROVIDER_ID,
      operation,
    },
    "request",
    false,
  );
}

function assertActive(
  signal: AbortSignal | undefined,
  operation: string,
): void {
  if (signal?.aborted) {
    throw ProviderError.cancelled({
      kind: "work",
      providerId: PROVIDER_ID,
      operation,
    });
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function snapshotRevision(state: ReefWorkState): string {
  const material = {
    dependencies: [...state.dependencies]
      .sort((left, right) => left.issue.id.localeCompare(right.issue.id))
      .map((dependency) => ({
        content: dependency.content,
        issue: dependency.issue,
        commit_hash: dependency.commit_hash,
      })),
    document: {
      content: state.work.content,
      commit_hash: state.work.commit_hash,
    },
    issue: state.work.issue,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(material)))
    .digest("hex");
}

function snapshotFromState(state: ReefWorkState): WorkSnapshot {
  const revision = snapshotRevision(state);
  return {
    uri: state.parsed.uri,
    revision,
    provenance: {
      source: "akb",
      revision: state.work.commit_hash ?? revision,
    },
  };
}

function implementationRefKey(ref: ImplementationRef): string {
  return `${ref.type}:${ref.repo ?? ""}:${ref.ref}`;
}

function toImplementationRef(
  artifact: ProviderArtifact,
  repository: string,
): ImplementationRef {
  const parsed = ArtifactInputSchema.safeParse(artifact);
  if (!parsed.success) rejectOperation();

  const { kind, ref, uri, title } = parsed.data;
  if (kind !== "branch" && kind !== "commit" && kind !== "pull_request") {
    rejectOperation();
  }

  return {
    type: kind as SupportedArtifactKind,
    repo: repository,
    ref,
    ...(uri === undefined ? {} : { url: uri }),
    ...(title === undefined ? {} : { title }),
  };
}

function transitionTarget(value: string): "in_progress" | "in_review" {
  if (value === "in_progress" || value === "in_review") return value;
  return rejectOperation();
}

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    rejectOperation();
  }
  return value.toISOString();
}

export function createReefWorkProvider(
  options: ReefWorkProviderOptions,
): WorkProvider {
  if (
    !options ||
    typeof options.jwt !== "string" ||
    options.jwt.length === 0 ||
    typeof options.vault !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(options.vault) ||
    typeof options.repository !== "string" ||
    !REPOSITORY_PATTERN.test(options.repository)
  ) {
    throw new Error("invalid_reef_work_provider_configuration");
  }

  const clock = options.clock ?? (() => new Date());
  const identity = {
    kind: "work" as const,
    id: PROVIDER_ID,
    version: PROVIDER_VERSION,
    capabilities: WORK_CAPABILITIES,
  };

  const run = <Result>(
    operation: string,
    context: ProviderRequestContext,
    action: (signal: AbortSignal | undefined) => Promise<Result>,
  ): Promise<Result> =>
    executeProviderOperation(
      identity,
      operation,
      operation,
      async ({ signal }) => {
        try {
          return await action(signal);
        } catch (error) {
          if (
            error instanceof RejectedOperation ||
            error instanceof ReefWorkUriError
          ) {
            throw providerRequestFailure(operation);
          }
          throw error;
        }
      },
      context,
    );

  const readState = async (
    parsed: ReefWorkUri,
    signal: AbortSignal | undefined,
    operation: string,
  ): Promise<ReefWorkState> => {
    assertActive(signal, operation);
    const work = await akbReadIssue({
      adapter: options.adapter,
      vault: parsed.vault,
      id: parsed.issueId,
    });
    if (work.issue.id !== parsed.issueId) rejectOperation();

    assertActive(signal, operation);
    const { actor } = await akbGetCurrentActor({
      adapter: options.adapter,
      jwt: options.jwt,
    });
    if (actor === null || actor.trim().length === 0) rejectOperation();

    const dependencyIds = [...new Set(work.issue.depends_on ?? [])].sort();
    const dependencies: AkbReadIssueResult[] = [];
    for (const dependencyId of dependencyIds) {
      assertActive(signal, operation);
      dependencies.push(
        await akbReadIssue({
          adapter: options.adapter,
          vault: parsed.vault,
          id: dependencyId,
        }),
      );
    }

    assertActive(signal, operation);
    return { parsed, work, dependencies, actor };
  };

  const provider: WorkProvider = {
    ...identity,
    read: ({ uri }, context) =>
      run("read", context, async (signal) => {
        const parsed = parseReefWorkUri(uri, options.vault);
        return snapshotFromState(await readState(parsed, signal, "read"));
      }),
    refresh: ({ uri }, context) =>
      run("refresh", context, async (signal) => {
        const parsed = parseReefWorkUri(uri, options.vault);
        return snapshotFromState(await readState(parsed, signal, "refresh"));
      }),
    transition: ({ uri, transition }, context) =>
      run("transition", context, async (signal) => {
        const parsed = parseReefWorkUri(uri, options.vault);
        const target = transitionTarget(transition);
        const state = await readState(parsed, signal, "transition");

        if (state.actor !== state.work.issue.assigned_to) rejectOperation();
        const currentStatus = state.work.issue.status;
        const allowed =
          (currentStatus === "todo" && target === "in_progress") ||
          (currentStatus === "in_progress" && target === "in_review");
        if (!allowed) rejectOperation();
        if (
          target === "in_progress" &&
          state.dependencies.some(
            (dependency) => dependency.issue.status !== "done",
          )
        ) {
          rejectOperation();
        }

        assertActive(signal, "transition");
        const now = timestamp(clock);
        assertActive(signal, "transition");
        const update: IssueUpdateInput = {
          issue_id: parsed.issueId,
          patch: { status: target },
        };
        await akbUpdateIssue({
          adapter: options.adapter,
          vault: parsed.vault,
          id: parsed.issueId,
          partial: buildIssueUpdateMetadataPatch({
            update,
            actor: state.actor,
            now,
            source: LIFECYCLE_SOURCE,
          }),
          expectedUpdatedAt: state.work.issue.updated_at,
        });

        return snapshotFromState(
          await readState(parsed, undefined, "transition"),
        );
      }),
    report: (report, context) =>
      run("report", context, async (signal) => {
        const parsedReport = ReportInputSchema.safeParse(report);
        if (!parsedReport.success) rejectOperation();
        const parsed = parseReefWorkUri(parsedReport.data.uri, options.vault);
        const state = await readState(parsed, signal, "report");
        if (snapshotRevision(state) !== parsedReport.data.revision) {
          rejectOperation();
        }

        assertActive(signal, "report");
        const createdAt = timestamp(clock);
        assertActive(signal, "report");
        await akbCreateComment(
          options.adapter,
          parsed.vault,
          parsed.issueId,
          `${parsedReport.data.outcome}: ${parsedReport.data.summary}`,
          state.actor,
          undefined,
          { createdAt, editedAt: null },
        );
        return { ...parsedReport.data };
      }),
    linkArtifact: ({ uri, artifact }, context) =>
      run("linkArtifact", context, async (signal) => {
        const parsed = parseReefWorkUri(uri, options.vault);
        const implementationRef = toImplementationRef(
          artifact,
          options.repository,
        );
        const state = await readState(parsed, signal, "linkArtifact");
        const existing = state.work.issue.implementation_refs ?? [];
        if (
          existing.some(
            (ref) =>
              implementationRefKey(ref) ===
              implementationRefKey(implementationRef),
          )
        ) {
          return artifact;
        }

        assertActive(signal, "linkArtifact");
        const now = timestamp(clock);
        assertActive(signal, "linkArtifact");
        const update: IssueUpdateInput = {
          issue_id: parsed.issueId,
          patch: { implementation_refs: [...existing, implementationRef] },
        };
        await akbUpdateIssue({
          adapter: options.adapter,
          vault: parsed.vault,
          id: parsed.issueId,
          partial: buildIssueUpdateMetadataPatch({
            update,
            actor: state.actor,
            now,
            source: LIFECYCLE_SOURCE,
          }),
          expectedUpdatedAt: state.work.issue.updated_at,
        });
        return artifact;
      }),
  };

  return provider;
}

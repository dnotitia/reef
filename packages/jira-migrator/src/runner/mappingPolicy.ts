import { lstat, readFile } from "node:fs/promises";
import {
  ClosedReasonEnum,
  IssueTypeEnum,
  PriorityEnum,
  StatusEnum,
} from "@reef/core";
import { z } from "zod";
import type { JiraIssueMappingPolicy } from "../issues/mappingContracts.js";
import type { JiraLinkMapping } from "../related/contracts.js";

const LinkMatchSchema = z.object({
  typeId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  inward: z.string().min(1).optional(),
  outward: z.string().min(1).optional(),
});

const PolicySchema = z
  .object({
    statuses: z.array(
      z
        .object({
          id: z.string().min(1).optional(),
          name: z.string().min(1).optional(),
          categoryKey: z.string().min(1).optional(),
          status: StatusEnum,
          closedReason: ClosedReasonEnum.optional(),
        })
        .strict(),
    ),
    issueTypes: z.array(
      z
        .object({
          id: z.string().min(1).optional(),
          name: z.string().min(1).optional(),
          issueType: IssueTypeEnum,
        })
        .strict(),
    ),
    priorities: z.array(
      z
        .object({
          id: z.string().min(1).optional(),
          name: z.string().min(1).optional(),
          priority: PriorityEnum,
        })
        .strict(),
    ),
    linkMappings: z
      .array(
        z.discriminatedUnion("kind", [
          LinkMatchSchema.extend({
            kind: z.literal("directional"),
            outwardRelation: z.enum(["blocks", "depends_on"]),
            inwardRelation: z.enum(["blocks", "depends_on"]),
          }).strict(),
          LinkMatchSchema.extend({ kind: z.literal("symmetric") }).strict(),
        ]),
      )
      .default([]),
  })
  .strict();

export interface LoadedJiraMappingPolicy extends JiraIssueMappingPolicy {
  linkMappings: readonly JiraLinkMapping[];
}

class JiraMappingPolicyError extends Error {
  constructor(readonly code: "missing" | "unsafe_file" | "invalid") {
    super(`jira_mapping_policy_${code}`);
    this.name = "JiraMappingPolicyError";
  }
}

export async function loadJiraMappingPolicy(
  path: string,
): Promise<LoadedJiraMappingPolicy> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(path);
  } catch {
    throw new JiraMappingPolicyError("missing");
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600)
  ) {
    throw new JiraMappingPolicyError("unsafe_file");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new JiraMappingPolicyError("invalid");
  }
  const parsed = PolicySchema.safeParse(value);
  if (!parsed.success) throw new JiraMappingPolicyError("invalid");
  return parsed.data;
}

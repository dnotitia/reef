"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { holdQueryUntilHydrated } from "@/lib/queryHydration";
import { useHydrated } from "@/lib/useHydrated";
import { type Template, TemplateSchema } from "@reef/core";
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";

export interface TemplateEntry {
  template: Template;
}

const TemplateEntrySchema = z.object({ template: TemplateSchema });
const TemplateEntriesSchema = z.array(TemplateEntrySchema);

export interface IssueTemplatesResult {
  entries: TemplateEntry[];
  /** Same data as `entries.map(e => e.template)` — convenience for read consumers. */
  templates: Template[];
}

const STALE_TIME_MS = 60_000;

function issueTemplatesKey(vault: string): readonly unknown[] {
  return ["issue-templates", vault] as const;
}

function deriveResult(entries: TemplateEntry[]): IssueTemplatesResult {
  const templates: Template[] = entries.map((e) => e.template);
  return { entries, templates };
}

async function fetchIssueTemplates(
  vault: string,
): Promise<IssueTemplatesResult> {
  const res = await apiFetch(
    `/api/templates?vault=${encodeURIComponent(vault)}`,
  );

  if (!res.ok) {
    await throwHttpError(res, `Templates fetch returned ${res.status}`);
  }

  const data = (await res.json()) as { entries: unknown };
  const entries = TemplateEntriesSchema.parse(data.entries);
  return deriveResult(entries);
}

export function useIssueTemplates(
  vault: string,
): UseQueryResult<IssueTemplatesResult, Error> {
  const hydrated = useHydrated();
  const result = useQuery({
    queryKey: issueTemplatesKey(vault),
    queryFn: () => fetchIssueTemplates(vault),
    enabled: vault.length > 0,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  return holdQueryUntilHydrated(result, hydrated);
}

export interface UpsertTemplateArgs {
  template: Template;
}

export type UpsertTemplateMutation = UseMutationResult<
  Template,
  Error,
  UpsertTemplateArgs
>;

export function useUpsertIssueTemplate(vault: string): UpsertTemplateMutation {
  const queryClient = useQueryClient();

  return useMutation<Template, Error, UpsertTemplateArgs>({
    mutationFn: async ({ template }) => {
      const res = await apiFetch(
        `/api/templates/${encodeURIComponent(template.name)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault, template }),
        },
      );
      if (!res.ok) {
        await throwHttpError(res, `PUT /api/templates returned ${res.status}`);
      }
      const data = (await res.json()) as { template: unknown };
      return TemplateSchema.parse(data.template);
    },
    onSuccess: async (template) => {
      // Patch cache in place so consumers see the new entry without a
      // refetch. Falls back to invalidation when no cache exists yet.
      const cached = queryClient.getQueryData<IssueTemplatesResult>(
        issueTemplatesKey(vault),
      );
      if (cached) {
        const idx = cached.entries.findIndex(
          (e) => e.template.name === template.name,
        );
        const nextEntry: TemplateEntry = { template };
        const nextEntries =
          idx >= 0
            ? cached.entries.with(idx, nextEntry)
            : [...cached.entries, nextEntry];
        const merged = deriveResult(nextEntries);
        queryClient.setQueryData(issueTemplatesKey(vault), merged);
      } else {
        await queryClient.invalidateQueries({
          queryKey: issueTemplatesKey(vault),
        });
      }
    },
  });
}

export interface DeleteTemplateArgs {
  name: string;
}

export type DeleteTemplateMutation = UseMutationResult<
  void,
  Error,
  DeleteTemplateArgs
>;

export function useDeleteIssueTemplate(vault: string): DeleteTemplateMutation {
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeleteTemplateArgs>({
    mutationFn: async ({ name }) => {
      const url = `/api/templates/${encodeURIComponent(name)}?vault=${encodeURIComponent(vault)}`;
      const res = await apiFetch(url, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        await throwHttpError(
          res,
          `DELETE /api/templates returned ${res.status}`,
        );
      }
    },
    onSuccess: async (_void, { name }) => {
      const cached = queryClient.getQueryData<IssueTemplatesResult>(
        issueTemplatesKey(vault),
      );
      if (cached) {
        const nextEntries = cached.entries.filter(
          (e) => e.template.name !== name,
        );
        const merged = deriveResult(nextEntries);
        queryClient.setQueryData(issueTemplatesKey(vault), merged);
      } else {
        await queryClient.invalidateQueries({
          queryKey: issueTemplatesKey(vault),
        });
      }
    },
  });
}

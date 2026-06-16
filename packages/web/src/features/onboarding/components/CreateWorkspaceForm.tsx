"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MonitoredRepoSelector,
  buildMonitoredReposPayload,
} from "@/features/settings/components/MonitoredRepoSelector";
import { useSetActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useHasGithubToken } from "@/features/settings/hooks/useHasGithubToken";
import { useRepos } from "@/features/settings/hooks/useRepos";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  AUTHORING_LANGUAGES,
  type AuthoringLanguage,
  CREATE_VAULT_NAME_PATTERN,
  ConfigSchema,
  DEFAULT_CONFIG,
  PROJECT_PREFIX_PATTERN,
} from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type SyntheticEvent, useState } from "react";
import { z } from "zod";

const CreateVaultResponseSchema = z.object({
  name: z.string().min(1),
  config: ConfigSchema,
});

/** Radix Select forbids an empty-string item value, so "unset" needs a sentinel. */
const NONE_VALUE = "__none__";

export interface CreateWorkspaceFormProps {
  /**
   * Prefix for field ids and `data-testid`s so two mounts does not collide and
   * each caller keeps its own stable selectors. Onboarding passes "greenfield"
   * to preserve its existing test ids; the dialog uses its own.
   */
  idPrefix?: string;
  /**
   * Fired after a successful create — the new vault is already active, its
   * config cache is primed, the vault list is invalidated, and the router has
   * navigated to /issues. Callers use this for surface-local cleanup
   * (e.g. closing the dialog). Navigation is owned here so every entry point
   * lands the user in the same place (AC4).
   */
  onCreated?: (createdName: string) => void;
  /** When provided, renders a Cancel button (dialog usage). */
  onCancel?: () => void;
}

/**
 * The shared "create a project workspace" form: a new akb vault plus its reef
 * config (project prefix and optional monitored repos), posted to
 * `POST /api/vaults`. Extracted from OnboardingPanel (REEF-146) so the sidebar
 * "New workspace" dialog reuses the exact same create path instead of
 * duplicating it. The surrounding framing (section header, onboarding's
 * secondary flows, the dialog chrome) stays with each caller; this component
 * owns the form itself.
 */
export function CreateWorkspaceForm({
  idPrefix = "create-workspace",
  onCreated,
  onCancel,
}: CreateWorkspaceFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Token gate (REEF-159): repo listing is disabled without a configured token,
  // so drive the selector's loading/error from token state to avoid a
  // forever-skeleton and surface the "connect GitHub or skip" hint instead.
  const { hasToken, isLoading: tokenLoading } = useHasGithubToken();
  const reposQuery = useRepos();
  const setActiveVault = useSetActiveVault();

  const [vaultName, setVaultName] = useState("");
  const [description, setDescription] = useState("");
  const [projectPrefix, setProjectPrefix] = useState(
    DEFAULT_CONFIG.project_prefix,
  );
  const [authoringLanguage, setAuthoringLanguage] =
    useState<AuthoringLanguage | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function toggleRepo(repo: string) {
    setSelectedRepos((current) => {
      const next = new Set(current);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  }

  async function handleCreate(e: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    e.preventDefault();
    setCreateError(null);

    const trimmedName = vaultName.trim();
    const trimmedDescription = description.trim();
    const trimmedPrefix = projectPrefix.trim().toUpperCase();

    if (!CREATE_VAULT_NAME_PATTERN.test(trimmedName)) {
      setCreateError(
        "Workspace name must use lowercase letters, digits, and hyphens only.",
      );
      return;
    }
    if (!PROJECT_PREFIX_PATTERN.test(trimmedPrefix)) {
      setCreateError("Project prefix must use uppercase letters only.");
      return;
    }

    let monitoredRepos: ReturnType<typeof buildMonitoredReposPayload>;
    try {
      monitoredRepos = buildMonitoredReposPayload(
        [],
        selectedRepos,
        reposQuery.data ?? [],
      );
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? err.message
          : "Could not resolve selected repositories.",
      );
      return;
    }
    setCreating(true);

    try {
      const body = {
        name: trimmedName,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        project_prefix: trimmedPrefix,
        // Omit when unset so an untouched picker posts the exact prior shape
        // (the route defaults a missing value to null — no forced language).
        ...(authoringLanguage ? { authoring_language: authoringLanguage } : {}),
        monitored_repos: monitoredRepos,
      };
      const res = await apiFetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await throwHttpError(res, `POST /api/vaults returned ${res.status}`);
      }

      const created = CreateVaultResponseSchema.parse(await res.json());
      await setActiveVault.mutateAsync(created.name);
      queryClient.setQueryData(["config", created.name], {
        config: created.config,
      });
      await queryClient.invalidateQueries({ queryKey: ["vaults"] });
      router.push("/issues");
      onCreated?.(created.name);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create workspace.";
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  }

  const nameId = `${idPrefix}-vault-name-input`;
  const prefixId = `${idPrefix}-project-prefix-input`;
  const descriptionId = `${idPrefix}-description-input`;
  const languageId = `${idPrefix}-authoring-language-select`;

  return (
    <form className="flex flex-col gap-4" onSubmit={handleCreate}>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <label htmlFor={nameId} className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground/90">
            Workspace name
          </span>
          <Input
            id={nameId}
            value={vaultName}
            onChange={(e) => setVaultName(e.target.value.trim().toLowerCase())}
            placeholder="reef-acme"
            data-testid={nameId}
            className="font-mono"
            autoComplete="off"
          />
        </label>

        <label htmlFor={prefixId} className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground/90">
            Issue prefix
          </span>
          <Input
            id={prefixId}
            value={projectPrefix}
            onChange={(e) =>
              setProjectPrefix(e.target.value.trim().toUpperCase())
            }
            placeholder="REEF"
            data-testid={prefixId}
            className="font-mono uppercase"
            autoComplete="off"
          />
        </label>
      </div>

      <label htmlFor={descriptionId} className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground/90">
          Description
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        </span>
        <Input
          id={descriptionId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this workspace is for"
          data-testid={descriptionId}
        />
      </label>

      {/* Default authoring language — a team-shared workspace policy, not an AI
          setting, so it sits with the other workspace fields rather than apart.
          Fixed-width control keeps it identical across the wide onboarding page
          and the narrower dialog (REEF-160). */}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground/90">
          Default authoring language
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          The language AI writes new content in. Leave unset to let AI follow
          each request; you can change it later in Settings.
        </p>
        <Select
          value={authoringLanguage ?? NONE_VALUE}
          onValueChange={(v) =>
            setAuthoringLanguage(
              v === NONE_VALUE ? null : (v as AuthoringLanguage),
            )
          }
        >
          <SelectTrigger
            className="mt-1 w-56"
            data-testid={languageId}
            aria-label="Default authoring language"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>Not set (no default)</SelectItem>
            {AUTHORING_LANGUAGES.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground/90">
          Monitored repositories
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        </p>
        <MonitoredRepoSelector
          availableRepos={reposQuery.data ?? []}
          selectedRepos={selectedRepos}
          onToggle={toggleRepo}
          isLoading={tokenLoading || (hasToken && reposQuery.isPending)}
          isError={!hasToken || (reposQuery.isError && !reposQuery.data)}
          errorMessage="Connect GitHub to select repositories, or skip this step."
          testIdPrefix={`${idPrefix}-monitored-repos`}
        />
      </div>

      {createError && (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid={`${idPrefix}-create-error`}
        >
          {createError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={creating || !vaultName.trim() || !projectPrefix.trim()}
          data-testid={`${idPrefix}-create-btn`}
          className="w-fit rounded-md bg-foreground px-6 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-foreground/90 disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create workspace"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            data-testid={`${idPrefix}-cancel-btn`}
            className="w-fit rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

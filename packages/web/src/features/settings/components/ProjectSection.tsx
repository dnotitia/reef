"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  useProjectConfig,
  useUpdateProjectConfig,
} from "@/features/settings/hooks/useProjectConfig";
import { DEFAULT_CONFIG, PROJECT_PREFIX_PATTERN } from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReadOnlyValue } from "./ReadOnlyValue";

/**
 * project_prefix is a team-shared workspace setting; existing issue IDs are NOT
 * renamed on change. `canEdit` is false for non-admin viewers (REEF-020), who
 * see the current prefix read instead of the editable input.
 */
export function ProjectSection({ canEdit = true }: { canEdit?: boolean }) {
  const t = useTranslations("settings.config");
  const { vault: activeVault, isLoading: vaultLoading } = useActiveVault();
  const configQuery = useProjectConfig(activeVault);
  const updateConfig = useUpdateProjectConfig(activeVault);
  const queryClient = useQueryClient();

  const serverPrefix =
    configQuery.data?.config.project_prefix ?? DEFAULT_CONFIG.project_prefix;

  // isPending (not isLoading) — see useActiveVault for the rationale.
  const isLoading = vaultLoading || configQuery.isPending;

  if (!vaultLoading && !activeVault) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="project-section-no-vault"
      >
        {t("project.noVault")}
      </p>
    );
  }

  // HTTP error (e.g. malformed yaml → 422): show the message instead of the
  // generic "offline" notice so the user can repair the document directly.
  if (configQuery.error) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive"
        data-testid="project-section-load-error"
      >
        {t("loadError")} {configQuery.error.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="project-section">
      <div className="flex flex-col gap-1">
        <p
          id="project-prefix-label"
          className="text-sm font-medium text-foreground/90"
        >
          {t("project.label")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t.rich("project.description", {
            prefix: serverPrefix,
            // `_reef/config` is a vault document path (code identifier), verbatim.
            code: () => <code>_reef/config</code>, // i18n-exempt
          })}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-8 w-40" />
      ) : canEdit ? (
        <ProjectPrefixEditor
          key={serverPrefix}
          activeVault={activeVault}
          serverPrefix={serverPrefix}
          saving={updateConfig.isPending}
          onSave={async (projectPrefix) => {
            await updateConfig.mutateAsync({
              patch: { project_prefix: projectPrefix },
            });
            await queryClient.invalidateQueries({ queryKey: ["issues"] });
          }}
        />
      ) : (
        <ReadOnlyValue
          mono
          value={serverPrefix}
          testId="project-prefix-readonly"
        />
      )}
    </div>
  );
}

function ProjectPrefixEditor({
  activeVault,
  serverPrefix,
  saving,
  onSave,
}: {
  activeVault: string;
  serverPrefix: string;
  saving: boolean;
  onSave: (projectPrefix: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(serverPrefix);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== serverPrefix;
  const trimmed = draft.trim().toUpperCase();
  const valid = PROJECT_PREFIX_PATTERN.test(trimmed);

  async function handleSave() {
    setError(null);
    if (!activeVault) {
      setError("Select a workspace in Settings first.");
      return;
    }
    if (!valid) {
      setError("Use uppercase letters only (A-Z), e.g. REEF.");
      return;
    }
    try {
      await onSave(trimmed);
      // No success toast: the config cache updates synchronously, so the input
      // keeps the saved value and the Save button disables — the result is
      // immediately visible without a toast.
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save project prefix.";
      // Form-submit error: surfaced inline below (single source), not a toast.
      setError(msg);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          id="project-prefix-input"
          data-testid="project-prefix-input"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty && !saving) {
              e.preventDefault();
              void handleSave();
            }
          }}
          placeholder={/* i18n-exempt: example project prefix (brand) */ "REEF"}
          className="w-32 uppercase"
          disabled={saving}
          autoComplete="off"
          spellCheck={false}
          aria-labelledby="project-prefix-label"
          aria-invalid={error != null}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          data-testid="project-prefix-save"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="project-prefix-error"
        >
          {error}
        </p>
      )}
    </>
  );
}

"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  useProjectConfig,
  useUpdateProjectConfig,
} from "@/features/settings/hooks/useProjectConfig";
import { AUTHORING_LANGUAGES, type AuthoringLanguage } from "@reef/core";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReadOnlyValue } from "./ReadOnlyValue";

/**
 * Workspace default authoring language (REEF-136). A team-shared setting that
 * names the language AI-generated content (issue drafts, enrichment, status
 * rationales) is written in, so the whole workspace produces consistent prose.
 *
 * It is a default, not a constraint: "Not set" leaves AI generation on its prior
 * behavior. `canEdit` is false for non-writer viewers (REEF-020), who see the
 * current language read instead of the picker. Changing it does NOT rewrite
 * existing issues — it just affects content generated afterward.
 */

/** Radix Select forbids an empty-string item value, so "unset" needs a sentinel. */
const NONE_VALUE = "__none__";

function labelForCode(code: AuthoringLanguage | null): string | null {
  if (code == null) return null;
  return AUTHORING_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export function AuthoringLanguageSection({
  canEdit = true,
}: {
  canEdit?: boolean;
}) {
  const t = useTranslations("settings.config");
  const { vault: activeVault, isLoading: vaultLoading } = useActiveVault();
  const configQuery = useProjectConfig(activeVault);
  const updateConfig = useUpdateProjectConfig(activeVault);

  const serverLanguage = configQuery.data?.config.authoring_language ?? null;
  const [error, setError] = useState<string | null>(null);

  // isPending (not isLoading) — see useActiveVault for the rationale.
  const isLoading = vaultLoading || configQuery.isPending;
  const saving = updateConfig.isPending;

  async function handleChange(raw: string) {
    setError(null);
    const next: AuthoringLanguage | null =
      raw === NONE_VALUE ? null : (raw as AuthoringLanguage);
    if (next === serverLanguage) return;
    try {
      await updateConfig.mutateAsync({ patch: { authoring_language: next } });
      // No success toast: the config cache updates synchronously, so the picker
      // shows the saved value immediately (matches ProjectSection).
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to save authoring language.";
      setError(msg);
    }
  }

  if (!vaultLoading && !activeVault) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="authoring-language-no-vault"
      >
        {t("authoringLanguage.noVault")}
      </p>
    );
  }

  if (configQuery.error) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive"
        data-testid="authoring-language-load-error"
      >
        {t("loadError")} {configQuery.error.message}
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="authoring-language-section"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground/90">
          {t("authoringLanguage.label")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("authoringLanguage.description")}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-8 w-48" />
      ) : canEdit ? (
        <Select
          value={serverLanguage ?? NONE_VALUE}
          onValueChange={(v) => void handleChange(v)}
          disabled={saving}
        >
          <SelectTrigger
            className="w-56"
            data-testid="authoring-language-select"
            aria-label={t("authoringLanguage.label")}
            aria-invalid={error != null}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>
              {t("authoringLanguage.notSet")}
            </SelectItem>
            {AUTHORING_LANGUAGES.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <ReadOnlyValue
          value={labelForCode(serverLanguage)}
          testId="authoring-language-readonly"
        />
      )}

      {error && canEdit && (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="authoring-language-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

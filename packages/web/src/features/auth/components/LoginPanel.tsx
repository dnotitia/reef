"use client";

import { LoginForm } from "@/features/auth/components/LoginForm";
import {
  consumePendingAkbAccountError,
  peekPendingAkbAccountError,
} from "@/lib/akb/accountDenialClient";
import { normalizeSafeRedirect } from "@/lib/akb/safeRedirect";
import { apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { AkbAuthConfigSchema, isAkbAccountErrorCode } from "@reef/core";
import { Building2, KeyRound, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

export interface LoginPanelProps {
  redirectTo?: string;
}

interface AuthCapabilities {
  ssoEnabled: boolean;
  localAuthEnabled: boolean;
}

function akbPlatformToken(chunks: ReactNode) {
  return <span translate="no">{chunks}</span>;
}

export function LoginPanel({ redirectTo = "/" }: LoginPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const safeRedirect = normalizeSafeRedirect(redirectTo);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(
    null,
  );
  const t = useTranslations("auth.panel");

  useEffect(() => {
    const pendingAccountError = peekPendingAkbAccountError();
    const explicitAccountError = searchParams.get("sso_error");
    if (isAkbAccountErrorCode(explicitAccountError)) {
      if (pendingAccountError && pendingAccountError !== explicitAccountError) {
        consumePendingAkbAccountError();
      }
      return;
    }
    if (pendingAccountError && !searchParams.has("sso_error")) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("sso_error", pendingAccountError);
      router.replace(`/login?${nextParams.toString()}`);
    }
  }, [router, searchParams]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadConfig() {
      try {
        const res = await apiFetch("/api/auth/akb/config", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!res.ok) {
          setCapabilities({ ssoEnabled: false, localAuthEnabled: true });
          return;
        }
        const config = AkbAuthConfigSchema.parse(await res.json());
        setCapabilities({
          ssoEnabled: Boolean(
            config.keycloak.enabled && config.keycloak.login_url,
          ),
          localAuthEnabled: config.local_auth.enabled,
        });
      } catch {
        if (!controller.signal.aborted) {
          setCapabilities({ ssoEnabled: false, localAuthEnabled: true });
        }
      }
    }

    void loadConfig();
    return () => controller.abort();
  }, []);

  const ssoStartUrl = useMemo(() => {
    const params = new URLSearchParams({ redirect: safeRedirect });
    return `/api/auth/akb/sso/start?${params.toString()}`;
  }, [safeRedirect]);

  const ssoEnabled = capabilities?.ssoEnabled ?? false;
  const localAuthEnabled = capabilities?.localAuthEnabled ?? false;

  if (capabilities && !ssoEnabled && localAuthEnabled) {
    return <LoginForm redirectTo={safeRedirect} />;
  }

  return (
    <div className="w-full rounded-lg border border-border bg-elevated/70 p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-border pb-3 text-left">
        <div className="flex size-8 items-center justify-center rounded-md border border-border bg-background text-brand">
          <Building2 className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground text-sm">
            {t("workspaceIdentity")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t.rich("akbPlatformAccess", { akb: akbPlatformToken })}
          </p>
        </div>
      </div>

      <div
        className="flex min-h-[86px] flex-col justify-center pt-4"
        data-testid="sso-option-region"
        aria-live="polite"
      >
        {!capabilities && (
          <div
            aria-hidden="true"
            data-testid="sso-config-loading"
            className="h-[70px] rounded-md border border-border bg-background/70"
          />
        )}

        {ssoEnabled && (
          <div className="flex flex-col gap-2">
            <a
              href={ssoStartUrl}
              className={cn(
                "inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 font-medium text-brand-foreground text-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              )}
            >
              <KeyRound className="size-4" aria-hidden="true" />
              {t("continueWithSso")}
            </a>
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              <span>{t.rich("useAkbIdentity", { akb: akbPlatformToken })}</span>
            </div>
          </div>
        )}

        {capabilities && !ssoEnabled && !localAuthEnabled && (
          <p role="alert" className="text-sm text-destructive">
            {t("unavailable")}
          </p>
        )}
      </div>

      {ssoEnabled && localAuthEnabled && (
        <div className="my-4 flex items-center gap-3 text-muted-foreground text-xs">
          <div className="h-px flex-1 bg-border" />
          <span>{t("orUsePassword")}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

      {localAuthEnabled && <LoginForm redirectTo={safeRedirect} />}
    </div>
  );
}

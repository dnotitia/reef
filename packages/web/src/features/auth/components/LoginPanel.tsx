"use client";

import { LoginForm } from "@/features/auth/components/LoginForm";
import {
  type PendingAkbAccountErrorSnapshot,
  consumePendingAkbAccountError,
  isAkbAccountDenialTokenCleared,
  peekPendingAkbAccountError,
  snapshotPendingAkbAccountError,
  subscribeAkbAccountDenialCleared,
  subscribeAkbAccountDenied,
} from "@/lib/akb/accountDenialClient";
import { normalizeSafeRedirect } from "@/lib/akb/safeRedirect";
import { apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import {
  AkbAuthConfigSchema,
  type AkbAuthV2Config,
  isAkbAccountErrorCode,
} from "@reef/core";
import { Building2, KeyRound, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

export interface LoginPanelProps {
  redirectTo?: string;
  /** Enables the separately routed future auth-v2 presentation. */
  authV2?: boolean;
  /** Server-loaded public v2 catalog; null means the v2 contract is unavailable. */
  authV2Config?: AkbAuthV2Config | null;
}

interface AuthCapabilities {
  ssoEnabled: boolean;
  localAuthEnabled: boolean;
  providerAlias?: string;
}

function akbPlatformToken(chunks: ReactNode) {
  return <span translate="no">{chunks}</span>;
}

export function LoginPanel({
  redirectTo = "/",
  authV2 = false,
  authV2Config,
}: LoginPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const safeRedirect = normalizeSafeRedirect(redirectTo);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(
    null,
  );
  const pendingReplacementTokenRef = useRef<string | undefined>(undefined);
  const t = useTranslations("auth.panel");

  useEffect(() => {
    const replaceSearchParams = (nextParams: URLSearchParams) => {
      const query = nextParams.toString();
      router.replace(query ? `/login?${query}` : "/login");
    };

    const replaceAccountError = (code: string, token?: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("sso_error", code);
      if (token) nextParams.set("sso_error_token", token);
      else nextParams.delete("sso_error_token");
      pendingReplacementTokenRef.current = token;
      replaceSearchParams(nextParams);
    };

    const clearAccountError = (token: string) => {
      if (
        searchParams.get("sso_error_token") !== token &&
        pendingReplacementTokenRef.current !== token
      ) {
        return;
      }
      pendingReplacementTokenRef.current = undefined;
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("sso_error");
      nextParams.delete("sso_error_token");
      replaceSearchParams(nextParams);
    };

    const restoreAccountError = (
      accountError?: string,
      eventSnapshot?: PendingAkbAccountErrorSnapshot,
    ) => {
      const explicitAccountError = searchParams.get("sso_error");
      const explicitToken = searchParams.get("sso_error_token");
      const pending = snapshotPendingAkbAccountError();
      if (accountError !== undefined) {
        const liveSnapshot =
          eventSnapshot ??
          (pending?.code === accountError ? pending : undefined);
        if (
          eventSnapshot &&
          pending &&
          (pending.code !== eventSnapshot.code ||
            pending.token !== eventSnapshot.token)
        ) {
          consumePendingAkbAccountError();
        }
        if (
          explicitAccountError !== accountError ||
          explicitToken !== liveSnapshot?.token
        ) {
          replaceAccountError(accountError, liveSnapshot?.token);
        }
        return;
      }

      if (isAkbAccountErrorCode(explicitAccountError)) {
        if (
          explicitToken &&
          !pending &&
          isAkbAccountDenialTokenCleared(explicitToken)
        ) {
          clearAccountError(explicitToken);
          return;
        }
        if (
          pending &&
          (!explicitToken ||
            explicitToken !== pending.token ||
            explicitAccountError !== pending.code)
        ) {
          replaceAccountError(pending.code, pending.token);
        }
        return;
      }
      const pendingAccountError = peekPendingAkbAccountError();
      if (pendingAccountError && !searchParams.has("sso_error")) {
        replaceAccountError(pendingAccountError, pending?.token);
      }
    };

    restoreAccountError();
    const unsubscribeDenied = subscribeAkbAccountDenied(restoreAccountError);
    const unsubscribeCleared = subscribeAkbAccountDenialCleared(({ token }) =>
      clearAccountError(token),
    );
    return () => {
      unsubscribeDenied();
      unsubscribeCleared();
    };
  }, [router, searchParams]);

  useEffect(() => {
    if (authV2) {
      if (authV2Config === undefined) return;
      if (authV2Config?.auth_mode === "sso") {
        setCapabilities({
          ssoEnabled: Boolean(
            authV2Config.keycloak.enabled &&
              authV2Config.keycloak.browser_session_ready &&
              authV2Config.providers.length > 0,
          ),
          localAuthEnabled: authV2Config.local_auth.enabled,
          providerAlias: authV2Config.providers[0]?.alias,
        });
      } else if (authV2Config?.auth_mode === "local") {
        setCapabilities({
          ssoEnabled: false,
          localAuthEnabled: authV2Config.local_auth.enabled,
        });
      } else {
        setCapabilities({ ssoEnabled: false, localAuthEnabled: false });
      }
      return;
    }

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
  }, [authV2, authV2Config]);

  const ssoStartUrl = useMemo(() => {
    const params = new URLSearchParams({ redirect: safeRedirect });
    if (authV2) {
      const providerAlias = capabilities?.providerAlias;
      if (providerAlias) params.set("provider", providerAlias);
      return `/api/auth/v2/start?${params.toString()}`;
    }
    return `/api/auth/akb/sso/start?${params.toString()}`;
  }, [authV2, capabilities?.providerAlias, safeRedirect]);

  const ssoEnabled = capabilities?.ssoEnabled ?? false;
  // The future auth-v2 surface keeps the password field present while its
  // public catalog is loading. The v1 default remains byte-for-byte governed
  // by the existing capability probe below.
  const localAuthEnabled = capabilities?.localAuthEnabled ?? authV2;

  if (capabilities && !ssoEnabled && localAuthEnabled) {
    return <LoginForm redirectTo={safeRedirect} authV2={authV2} />;
  }

  return (
    <div className="w-full rounded-lg border border-border bg-surface-elevated/70 p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-border pb-3 text-left">
        <div className="flex size-8 items-center justify-center rounded-md border border-border bg-surface-page text-brand-text">
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
            className="h-[70px] rounded-md border border-border bg-surface-page/70"
          />
        )}

        {ssoEnabled && (
          <div className="flex flex-col gap-2">
            <a
              href={ssoStartUrl}
              className={cn(
                "inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand-fill px-4 font-medium text-brand-on-fill text-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40",
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
          <p role="alert" className="text-sm text-destructive-text">
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

      {localAuthEnabled && (
        <LoginForm redirectTo={safeRedirect} authV2={authV2} />
      )}
    </div>
  );
}

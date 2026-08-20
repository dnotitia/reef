import { ReefMark } from "@/components/ui/reef-mark";
import { LoginPanel } from "@/features/auth/components/LoginPanel";
import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
import {
  buildPathWithParams,
  normalizeSafeRedirect,
} from "@/lib/akb/safeRedirect";
import { readAuthMode } from "@/server/auth/config";
import { ssoAutoRedirectEnabled } from "@/lib/akb/ssoAutoRedirect";
import { type AkbAccountErrorCode, isAkbAccountErrorCode } from "@reef/core";
import { useTranslations } from "next-intl";
import { redirect } from "next/navigation";

type LoginErrorKind = "sso" | "legacy" | AkbAccountErrorCode | null;

type LoginSearchParams = { [key: string]: string | string[] | undefined };

/**
 * /login — akb username / password sign-in.
 *
 * In Next.js 15+ `searchParams` is a Promise (the sync accessor shipped in 14
 * is retired). We still read it so older bookmarks carrying ?error= land
 * on a sensible message.
 *
 * An explicit SSO-only catalog policy or the deployment opt-in can skip the
 * panel when AKB publishes exactly one enabled provider; see
 * {@link resolveSsoAutoRedirect}. When that does not fire, the page is async (it
 * awaits `searchParams`), so it delegates instead of calling the
 * `useTranslations` hook directly. It resolves the error *kind* and delegates
 * localized rendering to the non-async {@link LoginView} server component.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const params = await searchParams;
  const legacyError = typeof params.error === "string" ? params.error : null;
  const ssoError =
    typeof params.sso_error === "string" ? params.sso_error : null;
  const redirectTo = normalizeSafeRedirect(
    typeof params.redirect === "string" ? params.redirect : null,
  );
  const errorKind: LoginErrorKind = isAkbAccountErrorCode(ssoError)
    ? ssoError
    : ssoError
      ? "sso"
      : legacyError
        ? "legacy"
        : null;

  const ssoStartPath = await resolveSsoAutoRedirect({
    errorKind,
    params,
    redirectTo,
  });
  if (ssoStartPath) {
    redirect(ssoStartPath);
  }

  let authMode: "local" | "sso" | null = null;
  try {
    authMode = readAuthMode();
  } catch {
    // An invalid deployment config does not expose either sign-in method.
  }

  return (
    <LoginView
      authMode={authMode}
      errorKind={errorKind}
      redirectTo={redirectTo}
    />
  );
}

/**
 * Mode-aware SSO auto-redirect decision.
 *
 * Returns the same-origin `/api/auth/akb/sso/start` path to redirect to, or
 * null to render the panel. It fires for a *clean* entry into `/login`:
 *
 * - The deployment opts in with `REEF_SSO_AUTO_REDIRECT`, or AKB explicitly
 *   disables local auth (`sso_only` in the legacy projection), and exactly one
 *   enabled provider alias is available.
 * - No SSO/session error is present (`?sso_error=` / `?error=`). This is the
 *   loop guard: an SSO failure returns here, so auto-redirecting again would
 *   bounce the user between reef and Keycloak forever.
 * - No explicit loop escape (`?password=1` / `?prompt=login`), which keeps
 *   password sign-in reachable when an SSO round-trip fails.
 * - AKB reports its browser provider catalog ready. An unreachable or non-SSO
 *   backend leaves the panel in its mode-appropriate unavailable state.
 *
 * The original `?redirect=` destination is preserved into the SSO start so the
 * post-login landing is unchanged (AC4). A server-side redirect (vs the client
 * `LoginPanel` probe) means no panel flash before the bounce.
 */
async function resolveSsoAutoRedirect({
  errorKind,
  params,
  redirectTo,
}: {
  errorKind: LoginErrorKind;
  params: LoginSearchParams;
  redirectTo: string;
}): Promise<string | null> {
  if (errorKind !== null) return null;
  if (params.password === "1" || params.prompt === "login") return null;
  const autoRedirect = ssoAutoRedirectEnabled();

  const result = await loadAkbAuthConfig();
  if (!result.ok || !("schema_version" in result.config)) return null;
  if (!autoRedirect && result.config.local_auth.enabled) return null;
  const provider =
    result.config.providers.length === 1
      ? result.config.providers[0]
      : undefined;
  if (!result.config.keycloak.enabled || !provider?.login_url) return null;

  return buildPathWithParams("/api/auth/akb/sso/start", {
    redirect: redirectTo,
    provider: provider.alias,
  });
}

function LoginView({
  authMode,
  errorKind,
  redirectTo,
}: {
  authMode: "local" | "sso" | null;
  errorKind: LoginErrorKind;
  redirectTo: string;
}) {
  const t = useTranslations("auth.login");
  const errorMessage = (() => {
    switch (errorKind) {
      case "membership_required":
        return t("membershipRequired");
      case "account_suspended":
        return t("accountSuspended");
      case "identity_conflict":
        return t("identityConflict");
      case "sso":
        return t("ssoError");
      case "legacy":
        return t("sessionEnded");
      default:
        return null;
    }
  })();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-page p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-5 text-center">
        <div className="flex flex-col items-center gap-3 pb-1">
          <ReefMark className="size-11" decorative />
          <h1
            className="font-display font-semibold text-3xl text-foreground"
            translate="no"
          >
            reef{/* i18n-exempt: brand name */}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        {errorMessage && (
          <p
            role="alert"
            data-testid="login-error-alert"
            className="rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-4 py-3 text-sm text-destructive-text"
          >
            {errorMessage}
          </p>
        )}

        <LoginPanel authMode={authMode} redirectTo={redirectTo} />
      </div>
    </main>
  );
}

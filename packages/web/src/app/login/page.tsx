import { ReefMark } from "@/components/ui/reef-mark";
import { LoginPanel } from "@/features/auth/components/LoginPanel";
import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
import {
  buildPathWithParams,
  normalizeSafeRedirect,
} from "@/lib/akb/safeRedirect";
import { ssoAutoRedirectEnabled } from "@/lib/akb/ssoAutoRedirect";
import { useTranslations } from "next-intl";
import { redirect } from "next/navigation";

type LoginErrorKind = "sso" | "legacy" | null;

type LoginSearchParams = { [key: string]: string | string[] | undefined };

/**
 * /login — akb username / password sign-in.
 *
 * In Next.js 15+ `searchParams` is a Promise (the sync accessor shipped in 14
 * is retired). We still read it so older bookmarks carrying ?error= land
 * on a sensible message.
 *
 * SSO-first deployments (REEF-312) may opt into skipping the panel entirely:
 * see {@link resolveSsoAutoRedirect}. When that does not fire, the page is async
 * (it awaits `searchParams`), so it delegates instead of calling the
 * `useTranslations` hook directly. It resolves the error *kind* and delegates
 * the localized rendering to the non-async {@link LoginView} server component.
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
  const errorKind: LoginErrorKind = ssoError
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

  return <LoginView errorKind={errorKind} redirectTo={redirectTo} />;
}

/**
 * SSO-first auto-redirect decision (REEF-312).
 *
 * Returns the same-origin `/api/auth/akb/sso/start` path to redirect to, or
 * null to render the panel. It fires only on a *clean* entry into `/login`:
 *
 * - The deployment opted in (`REEF_SSO_AUTO_REDIRECT`); default is the panel.
 * - No SSO/session error is present (`?sso_error=` / `?error=`). This is the
 *   loop guard: an SSO failure returns here, so auto-redirecting again would
 *   bounce the user between reef and Keycloak forever.
 * - No password escape hatch (`?password=1` / `?prompt=login`, AC3) so password
 *   sign-in stays reachable when akb SSO is misconfigured or down.
 * - akb actually reports Keycloak enabled with a login URL. An unreachable or
 *   non-SSO backend falls back to the panel rather than a broken redirect.
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
  if (!ssoAutoRedirectEnabled()) return null;
  if (errorKind !== null) return null;
  if (params.password === "1" || params.prompt === "login") return null;

  const result = await loadAkbAuthConfig();
  if (!result.ok) return null;
  if (!result.config.keycloak.enabled || !result.config.keycloak.login_url) {
    return null;
  }

  return buildPathWithParams("/api/auth/akb/sso/start", {
    redirect: redirectTo,
  });
}

function LoginView({
  errorKind,
  redirectTo,
}: {
  errorKind: LoginErrorKind;
  redirectTo: string;
}) {
  const t = useTranslations("auth.login");
  const errorMessage =
    errorKind === "sso"
      ? t("ssoError")
      : errorKind === "legacy"
        ? t("sessionEnded")
        : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-5 text-center">
        <div className="flex flex-col items-center gap-3 pb-1">
          <ReefMark className="size-11" decorative />
          <h1 className="font-display font-semibold text-3xl text-foreground">
            reef{/* i18n-exempt: brand name */}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        {errorMessage && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {errorMessage}
          </p>
        )}

        <LoginPanel redirectTo={redirectTo} />
      </div>
    </main>
  );
}

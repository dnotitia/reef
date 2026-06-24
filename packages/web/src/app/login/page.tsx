import { ReefMark } from "@/components/ui/reef-mark";
import { LoginPanel } from "@/features/auth/components/LoginPanel";
import { normalizeSafeRedirect } from "@/lib/akb/safeRedirect";
import { useTranslations } from "next-intl";

type LoginErrorKind = "sso" | "legacy" | null;

/**
 * /login — akb username / password sign-in.
 *
 * In Next.js 15+ `searchParams` is a Promise (the sync accessor shipped in 14
 * is retired). We still read it so older bookmarks carrying ?error= land
 * on a sensible message.
 *
 * The page is async (it awaits `searchParams`), so it cannot call the
 * `useTranslations` hook directly. It resolves the error *kind* and delegates
 * the localized rendering to the non-async {@link LoginView} server component.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
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

  return <LoginView errorKind={errorKind} redirectTo={redirectTo} />;
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
            reef{/* i18n-exempt: brand name, never localized */}
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

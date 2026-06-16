import { ReefMark } from "@/components/ui/reef-mark";
import { LoginPanel } from "@/features/auth/components/LoginPanel";
import { normalizeSafeRedirect } from "@/lib/akb/safeRedirect";

/**
 * /login — akb username / password sign-in.
 *
 * In Next.js 15+ `searchParams` is a Promise (the sync accessor shipped in 14
 * is retired). We still read it so older bookmarks carrying ?error= land
 * on a sensible message.
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
  const errorMessage = ssoError
    ? "SSO could not complete. Try again or use password."
    : legacyError
      ? "Your previous session has ended. Please sign in again."
      : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-5 text-center">
        <div className="flex flex-col items-center gap-3 pb-1">
          <ReefMark className="size-11" decorative />
          <h1 className="font-display font-semibold text-3xl text-foreground">
            reef
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in with your workspace account to continue.
        </p>

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

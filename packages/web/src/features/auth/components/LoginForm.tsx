"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { reconcileAkbAccount } from "@/lib/akb/accountReconcile";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CURRENT_USER_QUERY_KEY } from "../hooks/useCurrentUser";

export interface LoginFormProps {
  /** Where to send the browser after a successful login. */
  redirectTo?: string;
}

export function LoginForm({ redirectTo = "/" }: LoginFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("auth.form");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/akb/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        // AKB is the auth boundary — clear the previous account's
        // workspace-scoped browser state before entering the app, so a
        // different account does not inherit stale vaults/issues or active
        // vault. Same-account re-login is a no-op inside reconcile.
        const body = (await res.json().catch(() => null)) as {
          user?: { id?: string };
        } | null;
        const akbUserId = body?.user?.id;
        if (akbUserId) {
          await reconcileAkbAccount(akbUserId);
        }
        await queryClient.invalidateQueries({
          queryKey: CURRENT_USER_QUERY_KEY,
        });
        router.push(redirectTo);
        router.refresh();
        return;
      }

      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      setError(detail.error ?? t("signInFailed"));
    } catch {
      setError(t("networkError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-3"
      data-testid="akb-login-form"
    >
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="login-username" className="text-muted-foreground">
          {t("username")}
        </label>
        <Input
          id="login-username"
          type="text"
          name="username"
          autoComplete="username"
          spellCheck={false}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={isSubmitting}
          data-testid="login-username"
        />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="login-password" className="text-muted-foreground">
          {t("password")}
        </label>
        <Input
          id="login-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isSubmitting}
          data-testid="login-password"
        />
      </div>
      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting} data-testid="login-submit">
        {isSubmitting && (
          <Spinner
            aria-hidden="true"
            className="size-3.5"
            data-testid="login-submit-spinner"
          />
        )}
        <span>{isSubmitting ? t("signingIn") : t("signIn")}</span>
      </Button>
    </form>
  );
}

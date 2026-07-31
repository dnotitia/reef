"use client";

import { Button } from "@/components/ui/button";
import { ErrorSurface } from "@/features/ui/components/ErrorSurface";
import { useTranslations } from "next-intl";
import Link from "next/link";

export default function ErrorPage({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useTranslations("errorSurfaces.route");

  return (
    <ErrorSurface
      title={t("title")}
      description={t("description")}
      actions={
        <>
          <Button type="button" variant="brand" onClick={unstable_retry}>
            {t("retry")}
          </Button>
          <Button asChild variant="outline">
            <Link href="/">{t("home")}</Link>
          </Button>
        </>
      }
    />
  );
}

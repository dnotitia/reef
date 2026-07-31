"use client";

import { Button } from "@/components/ui/button";
import { ErrorSurface } from "@/features/ui/components/ErrorSurface";
import { useTranslations } from "next-intl";
import Link from "next/link";

export default function NotFound() {
  const t = useTranslations("errorSurfaces.notFound");

  return (
    <ErrorSurface
      code="404"
      title={t("title")}
      description={t("description")}
      actions={
        <Button asChild variant="brand">
          <Link href="/">{t("home")}</Link>
        </Button>
      }
    />
  );
}

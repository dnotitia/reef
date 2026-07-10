import "server-only";

import { resolveLocale } from "@/i18n/detectLocale";
import { BASE_LOCALE, LOCALE_COOKIE, type Locale } from "@/i18n/locales";
import {
  DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
  type DevelopmentProfileCatalog,
} from "@reef/core";
import { cookies, headers } from "next/headers";

const KOREAN_DEVELOPMENT_PROFILE_CATALOG: DevelopmentProfileCatalog = {
  runner_profiles: [
    {
      id: "default",
      label: "기본 러너",
      description: "배포에서 표준으로 제공하는 Codex 러너 프로필입니다.",
    },
  ],
  permission_profiles: [
    {
      id: ":workspace",
      label: "워크스페이스 접근",
      description: "배포 제한 안에서 저장소 워크스페이스에 접근합니다.",
    },
  ],
};

async function detectServerLocale(): Promise<Locale> {
  try {
    const [cookieStore, headerStore] = await Promise.all([
      cookies(),
      headers(),
    ]);
    return resolveLocale(
      cookieStore.get(LOCALE_COOKIE)?.value,
      headerStore.get("accept-language"),
    );
  } catch {
    return BASE_LOCALE;
  }
}

/**
 * Deployment-owned safe profile catalog. The MVP exposes only identifiers and
 * presentation metadata; raw sandbox, environment, credential, filesystem, and
 * network policy never crosses the Route Handler boundary.
 */
export async function getDevelopmentProfileCatalog(): Promise<DevelopmentProfileCatalog> {
  return (await detectServerLocale()) === "ko"
    ? KOREAN_DEVELOPMENT_PROFILE_CATALOG
    : DEFAULT_DEVELOPMENT_PROFILE_CATALOG;
}

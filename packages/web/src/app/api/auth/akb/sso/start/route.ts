import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
import {
  buildPathWithParams,
  normalizeSafeRedirect,
} from "@/lib/akb/safeRedirect";
import { buildSsoStartCookie } from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import { getSsoAuthRuntime } from "@/server/auth/runtime";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const redirectPath = normalizeSafeRedirect(
    requestUrl.searchParams.get("redirect"),
  );
  const requestedProvider = requestUrl.searchParams.get("provider");
  const configResult = await loadAkbAuthConfig();
  if (!configResult.ok || !("schema_version" in configResult.config)) {
    return loginErrorRedirect(
      configResult.ok ? "wrong_mode" : configResult.reason,
    );
  }

  const enabledProviders = configResult.config.providers;
  const provider = requestedProvider
    ? enabledProviders.find(
        (candidate) => candidate.alias === requestedProvider,
      )
    : enabledProviders.length === 1
      ? enabledProviders[0]
      : undefined;
  if (!provider) return loginErrorRedirect("provider_unavailable");

  try {
    const runtime = await getSsoAuthRuntime();
    const started = await runtime.oidc.beginAuthorization(runtime.repository, {
      providerAlias: provider.alias,
      identityProviderHint:
        configResult.directRealmProviderAlias === provider.alias
          ? null
          : provider.alias,
      redirectPath,
    });
    const headers = new Headers({
      Location: started.location,
      "Cache-Control": "no-store",
    });
    headers.append("Set-Cookie", buildSsoStartCookie(started.browserBinding));
    return new Response(null, { status: 302, headers });
  } catch {
    logger.error({}, "reef_sso_start: authorization start failed");
    return loginErrorRedirect("sso_unavailable");
  }
}

function loginErrorRedirect(code: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildPathWithParams("/login", { sso_error: code }),
      "Cache-Control": "no-store",
    },
  });
}

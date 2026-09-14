import { AkbApiError } from "../../../errors";
import {
  AKB_COMPANION_LOGIN_PATH,
  AkbCompanionLoginRequestSchema,
  AkbCompanionLoginResponseSchema,
  type AkbCompanionLoginRequest,
  type AkbCompanionLoginResponse,
} from "../../../schemas/auth/companionLogin";
import type { AkbAdapter } from "../core/http";
import { withSpan } from "../core/shared";

/** Login-only account completion; ordinary bearer requests never call this. */
export function completeCompanionLogin(params: {
  adapter: AkbAdapter;
  request: AkbCompanionLoginRequest;
  idToken: string;
  assertion: string;
}): Promise<AkbCompanionLoginResponse> {
  return withSpan("akb.auth.companion_complete", {}, async () => {
    const request = AkbCompanionLoginRequestSchema.safeParse(params.request);
    if (
      !request.success ||
      !params.idToken ||
      params.idToken.length > 16_384 ||
      !params.assertion ||
      params.assertion.length > 16_384
    ) {
      throw new AkbApiError({
        status: 400,
        message: "companion_login_input_invalid",
      });
    }
    const payload = await params.adapter.request(AKB_COMPANION_LOGIN_PATH, {
      method: "POST",
      body: request.data,
      rawHeaders: {
        "X-AKB-ID-Token": params.idToken,
        "X-AKB-Login-Assertion": params.assertion,
      },
      resource: "session",
    });
    const parsed = AkbCompanionLoginResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AkbApiError({
        status: 502,
        message: "companion_login_response_invalid",
      });
    }
    return parsed.data;
  });
}

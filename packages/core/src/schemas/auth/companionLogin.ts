import { z } from "zod";

export const AkbUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  email: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  is_admin: z.boolean().optional(),
});
export type AkbUser = z.infer<typeof AkbUserSchema>;

export const AKB_COMPANION_LOGIN_PATH = "/api/v1/auth/sso/companion/complete";

export const AkbCompanionLoginRequestSchema = z
  .object({
    provider_alias: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/u),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  })
  .strict();
export type AkbCompanionLoginRequest = z.infer<
  typeof AkbCompanionLoginRequestSchema
>;

export const AkbCompanionLoginResponseSchema = z
  .object({ user: AkbUserSchema })
  .strict();
export type AkbCompanionLoginResponse = z.infer<
  typeof AkbCompanionLoginResponseSchema
>;

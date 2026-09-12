/**
 * The old provider-less AKB login proxy was retired with the v2 companion flow.
 * Provider selection and the OIDC authorization request are owned by the
 * same-origin /sso/start route.
 */
export async function GET(_request: Request): Promise<Response> {
  return Response.json(
    { error: "provider_login_retired" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

# Startup schema migrations

Reef runs one release gate before the application starts. The same bundled
`@reef/schema-migrator` runner is used by the Kubernetes init container and the
root `pnpm dev` wrapper. It inventories every vault visible to the migration
identity; it does not accept a vault selector.

## Identity and registration

Create a non-admin AKB service account and issue a service key with exactly the
`read` and `write` scopes. Grant that account the exact `writer` role only in
Reef workspaces. Configure its non-secret username as
`REEF_AKB_MIGRATION_SERVICE_ACCOUNT`; keep the key in
`REEF_AKB_MIGRATION_SERVICE_KEY`.

New workspaces register and read back the writer membership with the creating
owner's user JWT before the Reef config marker is written. The web process needs
the username but never the service key. If skill installation or marker writing
fails, Reef restores the account's prior membership (or revokes the new grant)
before returning the initialization failure; retrying registration remains
idempotent.

For existing workspaces, an owner or AKB administrator must backfill the writer
membership before rollout. Read back the member list and confirm that the exact
username has role `writer`. A workspace missing the membership is invisible to
the service key's `/my/vaults` inventory, so deployment must not rely on the
runner to discover that omission.

## Kubernetes rollout

1. Replace the placeholder `reef-migration-secret` with a Secret managed by the
   deployment's secret store. Do not commit the real value.
2. Set `REEF_AKB_MIGRATION_SERVICE_ACCOUNT` in the deployment overlay ConfigMap.
3. Backfill and read back every existing Reef workspace membership.
4. Render the overlay and verify `strategy.type: Recreate`, the
   `reef-schema-migration` init container, and that the migration Secret is not
   referenced by the `reef-web` container.
5. Apply the Deployment. Kubernetes will not start the app container until the
   init container exits successfully.

The image contains `/app/schema-migrator/cli.mjs`, a dependency-complete ESM
bundle executed directly with Node. It does not need `tsx`, TypeScript, pnpm, or
any other development dependency at runtime. There is no required migration
Job.

## Local development

Copy `migration.env.example` to `.env.migration.local`, point it only at
an isolated local AKB, and run `pnpm dev`. The wrapper loads that file, runs the
same migration application layer once, and starts Next.js only after success.
The service key is deleted from the child environment, so hot reload cannot
rerun migrations or inherit the credential. Keep the non-secret account name in
the normal web configuration because workspace creation uses it for
registration.

## Rotation and recovery

For credential rotation, issue the replacement key with the same `read` and
`write` scopes, test the runner against an isolated environment, update the
migration-only Secret, complete a no-op replay, and revoke the old key. Never
place either key in logs, reports, issue comments, or command arguments.

On failure, do not start Reef and do not narrow the inventory. Correct the
identity, membership, marker, schema, or upstream availability problem and run
the whole gate again. Completed phase UUIDs replay through AKB's ledger; the
same UUID with a changed operation checksum fails closed. A workspace failure
stops later workspace mutation, and the next full run converges from the ledger
and final manifest verification.

REEF-414 introduces no concrete schema operation, data backfill, or
`REEF_SCHEMA_VERSION` bump. The initial empty catalog still performs complete
inventory/auth preflight and `ensureReefTables` final verification.

import {
  ReefRuntimeReleaseIdentitySchema,
  type ReefRuntimeReleaseIdentity,
} from "@reef/core";

/**
 * Read the deployment-bound identity emitted by the validated release handoff.
 * These are deployment inputs; request bodies never choose an app or release.
 */
export function readInstallationTarget(
  env: Record<string, string | undefined> = process.env,
): ReefRuntimeReleaseIdentity | null {
  const result = ReefRuntimeReleaseIdentitySchema.safeParse({
    appId: env.REEF_APP_ID,
    releaseId: env.REEF_RELEASE_ID,
    appKey: "reef",
    version: env.REEF_RELEASE_VERSION,
    sourceRevision: env.REEF_RELEASE_SOURCE_REVISION,
    manifestChecksum: env.REEF_RELEASE_MANIFEST_CHECKSUM,
    imageDigest: env.REEF_RELEASE_IMAGE_DIGEST,
  });
  return result.success ? result.data : null;
}

import { describe, expect, it } from "vitest";
import { readInstallationTarget } from "./installationTarget";

const validEnvironment = {
  REEF_APP_ID: "11111111-1111-4111-8111-111111111111",
  REEF_RELEASE_ID: "22222222-2222-4222-8222-222222222222",
  REEF_RELEASE_VERSION: "0.16.1",
  REEF_RELEASE_SOURCE_REVISION: "a".repeat(40),
  REEF_RELEASE_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
  REEF_RELEASE_MANIFEST_CHECKSUM: "c".repeat(64),
};

describe("readInstallationTarget", () => {
  it("consumes the deployment-bound App and Release identity", () => {
    expect(readInstallationTarget(validEnvironment)).toEqual({
      appId: validEnvironment.REEF_APP_ID,
      releaseId: validEnvironment.REEF_RELEASE_ID,
      appKey: "reef",
      version: validEnvironment.REEF_RELEASE_VERSION,
      sourceRevision: validEnvironment.REEF_RELEASE_SOURCE_REVISION,
      imageDigest: validEnvironment.REEF_RELEASE_IMAGE_DIGEST,
      manifestChecksum: validEnvironment.REEF_RELEASE_MANIFEST_CHECKSUM,
    });
  });

  it("fails closed when a deployment identity field is missing or malformed", () => {
    expect(readInstallationTarget({})).toBeNull();
    expect(
      readInstallationTarget({
        ...validEnvironment,
        REEF_RELEASE_IMAGE_DIGEST: "sha256:deadbeef",
      }),
    ).toBeNull();
  });
});

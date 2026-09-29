import { uuidFor } from "./mock-utils.mjs";

export const E2E_REEF_APP_ID = uuidFor(9001);
export const E2E_REEF_RELEASE_ID = uuidFor(9002);
export const E2E_REEF_RELEASE_VERSION = "0.16.1";
export const E2E_REEF_SOURCE_REVISION = "a".repeat(40);
export const E2E_REEF_IMAGE_DIGEST = `sha256:${"b".repeat(64)}`;
export const E2E_REEF_MANIFEST_CHECKSUM = "c".repeat(64);

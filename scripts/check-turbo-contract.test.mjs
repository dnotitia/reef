import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyDockerBuildContract } from "./check-turbo-contract.mjs";

const FULL_SOURCE_DOCKERFILE = `FROM node:24.18.1-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm run build
FROM node:24.18.1-alpine AS runner
USER 1001
`;

test("accepts the full-source Docker build contract", () => {
  assert.doesNotThrow(() => verifyDockerBuildContract(FULL_SOURCE_DOCKERFILE));
});

test("rejects the retired pruned-manifest Docker build contract", () => {
  const retired = `FROM node:24.18.1-alpine AS builder
RUN turbo prune @reef/web --docker
FROM node:24.18.1-alpine AS runner
USER 1001
`;
  assert.throws(() => verifyDockerBuildContract(retired), /full source tree/u);
});

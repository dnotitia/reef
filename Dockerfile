# Stage 1: pruner — resolve Turbo from the repository dependency and produce
# the Docker-specific pruned workspace.
FROM node:24.18.1-alpine AS pruner
WORKDIR /app

# Resolve the package manager and Turbo from the checked-in root manifests.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo prune @reef/web --docker \
    && cp tsdown.config.mjs out/full/tsdown.config.mjs \
    && test -f out/full/tsdown.config.mjs \
    && cp tsconfig.base.json out/full/tsconfig.base.json \
    && test -f out/full/tsconfig.base.json


# Stage 2: deps — install only the pruned workspace dependencies.
FROM node:24.18.1-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Workspace prepare needs source, which is copied in the builder stage.
RUN pnpm install --frozen-lockfile --ignore-scripts


# Stage 3: builder — build from the pruned source tree.
FROM node:24.18.1-alpine AS builder
WORKDIR /app

# Enable the package manager declared by the pruned root package.json.
RUN corepack enable

COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ ./

# Run deferred dependency/workspace scripts with source available, then build.
RUN pnpm rebuild --pending && pnpm run build


# Stage 4: runner — minimal runtime image.
FROM node:24.18.1-alpine AS runner
WORKDIR /app

# Create non-root user with an explicit numeric UID/GID — kubelet's
# runAsNonRoot check cannot verify a username, only a numeric UID.
RUN addgroup -S -g 1001 reef && adduser -S -u 1001 -G reef reef

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy standalone output (bundles required node_modules — do NOT copy node_modules separately)
COPY --from=builder --chown=reef:reef /app/packages/web/.next/standalone ./
COPY --from=builder --chown=reef:reef /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder --chown=reef:reef /app/packages/web/public ./packages/web/public

USER 1001

EXPOSE 3000

# Next.js standalone entry point
CMD ["node", "packages/web/server.js"]

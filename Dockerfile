# Stage 1: builder — install from the full source tree so Git-hosted workspace
# dependencies can run their prepare/build lifecycle before Next bundles them.
FROM node:24.18.1-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm run build:packages && pnpm run build
RUN pnpm deploy --filter @reef/event-processor --prod --legacy /tmp/reef-event-processor


# Stage 2: runner — minimal runtime image.
FROM node:24.18.1-alpine AS reef-web
WORKDIR /app

# Release builds bind the image contents to the exact source and product
# version used by the one-shot release CLI. Local builds may leave these
# labels empty; they are not deployment artifacts.
ARG REEF_VERSION
ARG REEF_SOURCE_REVISION
LABEL org.opencontainers.image.version="${REEF_VERSION}" \
      org.opencontainers.image.revision="${REEF_SOURCE_REVISION}"

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

# Private event processor image. It shares the exact builder/source identity
# with reef-web but contains only the Core and processor runtime artifacts.
FROM node:24.18.1-alpine AS reef-event-processor
WORKDIR /app

ARG REEF_VERSION
ARG REEF_SOURCE_REVISION
LABEL org.opencontainers.image.version="${REEF_VERSION}" \
      org.opencontainers.image.revision="${REEF_SOURCE_REVISION}" \
      org.opencontainers.image.title="reef-event-processor"

RUN addgroup -S -g 1001 reef && adduser -S -u 1001 -G reef reef
ENV NODE_ENV=production
ENV REEF_EVENT_PROCESSOR_PORT=9090
ENV REEF_EVENT_PROCESSOR_HOST=0.0.0.0

COPY --from=builder --chown=reef:reef /tmp/reef-event-processor/ ./

USER 1001
EXPOSE 9090
CMD ["node", "dist/main.js"]

# Keep the default `docker build .` developer contract pointed at reef-web;
# release automation selects each named runtime target explicitly.
FROM reef-web AS default

# Stage 1: builder — install from the full source tree so Git-hosted workspace
# dependencies can run their prepare/build lifecycle before Next bundles them.
FROM node:24.18.1-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm run build


# Stage 2: runner — minimal runtime image.
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

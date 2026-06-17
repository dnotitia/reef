# Stage 1: deps — install dependencies only (cache-friendly)
FROM node:22-alpine AS deps
WORKDIR /app

# Install pnpm — pin to match packageManager field in package.json
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/web/package.json ./packages/web/
COPY packages/core/package.json ./packages/core/

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile


# Stage 2: builder — full build
FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm — pin to match packageManager field in package.json
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules

# Copy source code
COPY . .

# Build only the web app (output: 'standalone' is set in next.config.ts)
RUN pnpm --filter @reef/web run build


# Stage 3: runner — minimal runtime image
FROM node:22-alpine AS runner
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

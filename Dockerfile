FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/srs-engine/package.json packages/srs-engine/
COPY packages/notifications/package.json packages/notifications/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

# Build all packages and apps
FROM deps AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN pnpm build

# API runtime
FROM base AS api
COPY --from=builder /app /app
RUN pnpm install --frozen-lockfile --prod || true
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]

# Worker runtime
FROM base AS worker
COPY --from=builder /app /app
RUN pnpm install --frozen-lockfile --prod || true
CMD ["node", "apps/worker/dist/index.js"]

# Web runtime (Next.js)
FROM base AS web
COPY --from=builder /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@recalliq/web", "start"]

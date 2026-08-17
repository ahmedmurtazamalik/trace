# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/report-storage/package.json packages/report-storage/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY infrastructure/scripts/copy-prisma-client.mjs infrastructure/scripts/copy-prisma-client.mjs
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/config packages/config
COPY packages/database packages/database
COPY packages/github packages/github
COPY packages/report-storage packages/report-storage
COPY packages/shared packages/shared
RUN pnpm db:generate \
  && pnpm --filter @trace/config --filter @trace/database --filter @trace/github --filter @trace/report-storage --filter @trace/shared build \
  && pnpm --filter @trace/api build \
  && pnpm --filter @trace/api deploy --prod --legacy /opt/trace-api \
  && pnpm --filter @trace/database deploy --legacy /opt/trace-migrate \
  && node infrastructure/scripts/copy-prisma-client.mjs node_modules /opt/trace-api/node_modules /opt/trace-migrate/node_modules

FROM ${NODE_IMAGE} AS migration
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/trace-migrate ./
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /opt/trace-api ./
USER node
EXPOSE 3001
CMD ["node", "dist/src/main.js"]

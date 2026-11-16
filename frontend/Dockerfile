# Next.js web app. /api is proxied to the API at runtime (API_TARGET); the browser opens the sync
# WebSocket directly on port 1234 of the same host (or NEXT_PUBLIC_SYNC_URL, set at build time).
FROM node:22-alpine AS base
# npm 10 (bundled with Node 22) runs pnpm's install script, which swaps in its native binary.
RUN npm install -g pnpm@12.21.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
ARG NEXT_PUBLIC_SYNC_URL=""
# 1 = send Strict-Transport-Security (baked in at build time; only when served over HTTPS).
ARG ENABLE_HSTS=""
ENV NEXT_PUBLIC_SYNC_URL=$NEXT_PUBLIC_SYNC_URL ENABLE_HSTS=$ENABLE_HSTS NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --chown=node:node --from=build /app/.next/standalone ./
COPY --chown=node:node --from=build /app/.next/static ./.next/static
COPY --chown=node:node --from=build /app/public ./public
# Not root: the official node image ships an unprivileged "node" user.
USER node
EXPOSE 3000
CMD ["node", "server.js"]

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
ENV NEXT_PUBLIC_SYNC_URL=$NEXT_PUBLIC_SYNC_URL NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

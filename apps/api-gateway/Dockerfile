# syntax=docker/dockerfile:1
# @pinelodge/api-gateway (Bun service). Build context = repo root.
# Single stage: Bun runs TS directly, so production deps are installed in the
# final image (cross-stage node_modules copies miss Bun's nested workspace deps).
ARG BUN_VERSION=1.3.7
FROM oven/bun:${BUN_VERSION}-alpine
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies (every workspace manifest so the frozen lockfile resolves).
COPY package.json bun.lock ./
COPY apps/api-gateway/package.json ./apps/api-gateway/
COPY apps/auth/package.json ./apps/auth/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/api-contracts/package.json ./packages/api-contracts/
RUN bun install --frozen-lockfile --production

# App source.
COPY tsconfig.base.json ./
COPY apps/api-gateway ./apps/api-gateway

WORKDIR /app/apps/api-gateway
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(Bun.env.PORT||Bun.env.API_PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.ts"]

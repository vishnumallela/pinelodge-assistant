# syntax=docker/dockerfile:1
# Multi-stage image for @pinelodge/frontend: Vite build -> static nginx.
# Build context = repo root. VITE_* are baked in at build time.
ARG BUN_VERSION=1.3.7

# ── build: install (incl. dev deps for Vite) and produce dist/ ──
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/auth/package.json ./apps/auth/
COPY apps/api-gateway/package.json ./apps/api-gateway/
COPY packages/api-contracts/package.json ./packages/api-contracts/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend
# Public service URLs the browser will call (override at build time).
ARG VITE_AUTH_URL=http://localhost:3001
ARG VITE_API_URL=http://localhost:3002
ENV VITE_AUTH_URL=$VITE_AUTH_URL \
    VITE_API_URL=$VITE_API_URL
WORKDIR /app/apps/frontend
RUN bun run build

# ── release: nginx serving the static SPA ──
FROM nginx:1.27-alpine AS release
# PORT defaults to 80 locally; hosts like Railway inject their own. The nginx
# image renders templates/*.template through envsubst at startup.
ENV PORT=80
COPY apps/frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]

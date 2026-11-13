# syntax=docker/dockerfile:1

FROM node:24-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/homebox-mcp.db

RUN mkdir -p /data && chown -R node:node /app /data

COPY --chown=node:node package.json ./
COPY --chown=node:node assets ./assets
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]

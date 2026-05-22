# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json .npmrc ./
RUN --mount=type=secret,id=GITHUB_TOKEN \
  GITHUB_TOKEN="$(cat /run/secrets/GITHUB_TOKEN)" npm ci

COPY tsconfig*.json nest-cli.json ./
COPY apps ./apps
COPY libs ./libs

RUN npm run build:gateway

FROM node:22-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json .npmrc ./
RUN --mount=type=secret,id=GITHUB_TOKEN \
  apk upgrade --no-cache zlib \
  && GITHUB_TOKEN="$(cat /run/secrets/GITHUB_TOKEN)" npm ci --omit=dev \
  && rm .npmrc package-lock.json \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs

COPY --chown=nestjs:nodejs --from=builder /app/dist ./dist

USER nestjs

EXPOSE 3005

CMD ["node", "dist/apps/gateway/main"]

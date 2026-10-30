# ── Build stage ──────────────────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./

EXPOSE 3000

# nest build emite dist/src/main.js (no dist/main.js); el entrypoint aplica
# las migraciones Prisma pendientes antes de arrancar.
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]

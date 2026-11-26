FROM node:26-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY *.ts tsconfig.json ./
COPY db ./db
COPY http ./http
COPY ai ./ai
COPY classes ./classes
RUN npm run build

FROM node:26-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /usr/share/keyrings \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/db/migrations ./dist/db/migrations
COPY --from=build /app/ai/tools/tools.example.yml ./ai/tools/tools.example.yml

EXPOSE 8080

CMD ["npm", "start"]

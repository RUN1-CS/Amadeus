FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY *.ts tsconfig.json ./
RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

RUN npx playwright install --with-deps firefox

COPY --from=build /app/dist ./dist

EXPOSE 8080

CMD ["npm", "start"]

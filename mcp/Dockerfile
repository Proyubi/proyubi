# ---- Build Stage ----
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Run Stage ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8080

# HTTP (remote) mode — the public deployment. stdio mode (dist/index.js) is for
# local dev only and is not what the container runs.
CMD ["node", "dist/http.js"]

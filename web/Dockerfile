# ---- Build Stage ----
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

WORKDIR /app

RUN npm config set registry https://registry.npmjs.org/ && \
    pnpm config set registry https://registry.npmjs.org/

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# package.json 的 build 已带 UMI_ENV=prod，注入 API_BASE_URL=/api（同域反代）
RUN pnpm run build

# ---- Run Stage ----
FROM nginx:alpine

# 替换默认站点配置
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 部署 UMI 产物
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

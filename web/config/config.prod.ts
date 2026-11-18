import { defineConfig } from "@umijs/max";

/**
 * 生产环境覆盖配置（UMI_ENV=prod 时与 config.ts 合并加载）。
 *
 * 同域部署：前置 nginx 把 /api/* 反代到 webapi，
 * 所以 baseURL 用 /api 即可（无 CORS、无 OAuth cookie 跨域问题）。
 * dev 环境不设置该变量，请求走相对路径 + UMI proxy 转发到 38082。
 */
export default defineConfig({
  define: {
    "process.env.API_BASE_URL": "/api",
  },
}) as ReturnType<typeof defineConfig>;

/**
 * @name 代理的配置
 * @doc https://umijs.org/docs/guides/proxy
 *
 * 生产环境不通过 webpack devServer，所以这里只配 dev/test/pre。
 * 后端只暴露 `/app/**`（客户端）和 `/ops/**`（运营后台）；本前端只用 `/app/`。
 *
 * 本地连远程后端：`PROXY_TARGET=https://<你的域名>/api npm run start:dev`。
 * 远程边缘 nginx 的 `/api/*` 会 rewrite 掉 `/api` 前缀再转发给 webapi，所以 target 必须带 `/api`。
 */
const DEFAULT_TARGET = "http://localhost:38082";
const target = process.env.PROXY_TARGET || DEFAULT_TARGET;

const appProxy = {
  "/app/": {
    target,
    // 连本番 https 时同时用于 SNI / Host / Origin，绕开后端 CORS 白名单
    changeOrigin: true,
  },
};

export default {
  dev: appProxy,
  test: appProxy,
  pre: {
    "/app/": {
      target: process.env.PROXY_TARGET || "your pre url",
      changeOrigin: true,
    },
  },
};

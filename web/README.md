# Proyubi Web

Proyubi 的浏览器端：甘特图 / WBS、项目与客户、思维导图、品质（测试・Bug）、资料、モックアップ、Design Studio。

React 19 + Ant Design 6 + Ant Design Pro + Umi 4（`@umijs/max`）+ TypeScript。

## 开发

```bash
pnpm install
pnpm run start:dev        # http://localhost:8000，/app/** 代理到 http://localhost:38082（server）
```

连别的后端：`PROXY_TARGET=https://<域名>/api pnpm run start:dev`。

## 检查与构建

```bash
pnpm run tsc              # 类型检查
pnpm run biome:lint       # lint
pnpm run jest             # 单元测试
pnpm run build            # 生产构建 → dist/（会先构建 pen-viewer）
```

生产环境前端与 server 同域部署：`config/config.prod.ts` 把 API 基址设为 `/api`，由前置 nginx 反代到 server
（参考 `../deploy/selfhost/nginx.conf`）。

## 目录

| 路径 | 内容 |
|---|---|
| `config/` | Umi 配置、路由（`routes.ts`）、开发代理（`proxy.ts`） |
| `src/pm/` | PM 业务核心：类型、store、甘特图、Design Studio、API |
| `src/pages/` | 路由页面 |
| `src/services/platform/` | 账号・团队・邀请・通知・设置等平台接口 |
| `src/locales/` | 文案（ja-JP / en-US / zh-CN / zh-TW，四种语言都要加） |
| `pen-viewer/` | `.pen` 设计稿查看器（独立 Vite 构建，iframe 加载） |

侧栏菜单由后端返回（`/app/bootstrap/pm-web-jp`，数据在 `platform_sys_menu`），不读 `routes.ts`。

国际化细节见 `i18n-setup.md`。

## Branding migration compatibility

The product and package are Proyubi. The existing `pullcord_token` localStorage key is intentionally retained across every authentication flow so existing sessions remain valid. Design exports retain `kind: "pullcord-design"` as the versioned interchange identifier, compatible with existing files and MCP consumers. Neither identifier is user-visible branding. Database tables, app codes and APIs are unchanged.

Run `pnpm run test:brand` for branding and compatibility assertions.

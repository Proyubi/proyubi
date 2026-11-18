# Proyubi — Repository Guidelines

> `CLAUDE.md` 与 `AGENTS.md` 内容完全一致，改一份必须同步另一份。

## 这是什么

Proyubi是面向「做客户项目的软件开发团队」的项目管理工具，开源（AGPL-3.0）。
2026-10-23 从私有 monorepo `moonya/biz` 的 PM 模块拆出，git 历史从零开始。

## ⚠️ 公开仓库红线

本仓库会公开。**任何提交都不能包含：**

- 服务器 IP、SSH 账号、密码、API 密钥、数据库连接串 —— 一律放 `private/` 或 `.env*`（都被 gitignore）。
- 生产域名与客户名（例：客户的子域名、客户公司名）。示例用 `example.com` / `ACME`。
- 竞品调研、定价、经营策略 —— 放 `private/doc/`。

提交前跑一次：`git diff --cached | grep -nE '[0-9]{1,3}(\.[0-9]{1,3}){3}|password|secret|BEGIN .*PRIVATE KEY'`，命中要逐条确认。

`private/` 只在本机存在：部署目标（`private/deploy/<target>/server.env` 等）、真实 env（`private/env/`）、
内部文档、logo 探索稿、开发工作记录。

## 目录

| 路径 | 内容 |
|---|---|
| `server/` | Java 17 + Spring Boot 3.4.2 + MyBatis-Flex + PostgreSQL + Redis + Sa-Token，Maven 多模块，包 `ai.proyubi.*` |
| `web/` | React 19 + Ant Design Pro + Umi 4（pnpm） |
| `mcp/` | TypeScript MCP 服务（npm），stdio + Streamable HTTP |
| `doc/` | 设计、需求、手册、changelog（公开） |
| `brand/` | Logo（D1 方案） |
| `deploy/selfhost/` | 自托管 nginx 配置 |
| `docker-compose.yml` | 自托管一键启动 |

## 命令

| 项目 | 命令 |
|---|---|
| `server` | `mvn -B test`；`./run.sh`（读 `server/.env.dev`）；打包 `mvn -B -pl proyubi-server -am package -DskipTests` |
| `web` | `pnpm install`；`pnpm run start:dev`；`pnpm run tsc`；`pnpm run biome:lint`；`pnpm run jest`；`pnpm run build` |
| `mcp` | `npm ci`；`npm test`；`npm start`（stdio）/ `npm run start:http` |

## 约定

- 注释与文档多为中文，用户可见文案默认日语。新增 UI 文案要同时加到 ja-JP / en-US / zh-CN / zh-TW 四种语言。
- 提交信息沿用 `feat(pm): …` / `fix(web): …` 格式。
- 配置前缀 `proyubi.*`；环境变量名保持与旧系统一致（`PM_INTERNAL_API_KEY` 等），以便生产切换时复用 env。
- 侧栏菜单由后端 `platform_sys_menu`（app_code=`pm-web-jp`）驱动，不读 `web/config/routes.ts`。
- 数据库 SQL 不会在启动时自动执行；结构以 `server/schema/` 为准。
- MyBatis-Flex 三个坑：不认 `java.util.UUID`（需注册 TypeHandler）、同一事务别混用 Mapper 与 JdbcTemplate 写库、
  `BaseMapper.insert(entity)` 不写主键且会把 null 盖掉 `DEFAULT`。都是编译期正常、跑数据才炸。

## 已知遗留（拆分时带过来的，待清理）

- 平台层保留了「按模块订阅」的概念（WMS/BK/PM 各自 grant/subscription），Proyubi 只有一个产品，可简化。
- 租户设置用的表名是 `wms_tenant_settings`，里面还有 WMS 的字段（库存阈值、扫码、字段可见性）。
- bootstrap 下发的能力位里有 WMS 的（如 LINE Bot）。
- 表名、`app_code=pm-web-jp` 暂不改：生产切换时要与现有数据库兼容。

## 品牌与兼容性（2026-11-18）

当前产品统一命名 **Proyubi**，旧品牌 Pullcord 不再用于新文案。
运行代码使用 `ai.proyubi.*`、Maven 模块 `proyubi-*` 与 `proyubi.*` 配置。旧 `pullcord.*` / `PULLCORD_*` 配置仍有兼容适配；数据库/对象桶默认名、浏览器登录键、设计文件 kind 等持久化标识保留，详见 `doc/proyubi-naming-migration.md`，不可盲目替换。
`private/deploy/3plusx/server.env` 是旧 biz 生产配置的保留副本，**不是独立 Proyubi 的部署配置，不得直接执行部署**。

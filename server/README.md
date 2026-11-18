# Proyubi server

Java 17 · Spring Boot 3.4.2 · MyBatis-Flex 1.9.8 · PostgreSQL · Redis · Sa-Token。groupId `ai.proyubi`。

## 模块

| 模块 | 包 | 内容 |
|---|---|---|
| `proyubi-common-*` | `ai.proyubi.common.*` | 基础设施：`R<T>`、异常、Web、Sa-Token、MyBatis-Flex（含多租户）、Redis |
| `proyubi-capabilities` | `ai.proyubi.capabilities` | 能力位 / 模块定义 |
| `proyubi-regions` | `ai.proyubi.regions` | 区域（JP / CN / GLOBAL）配置 |
| `proyubi-identity` | `ai.proyubi.identity` | 账号、邮箱验证码、Google / Apple 登录、邮件 |
| `proyubi-platform` | `ai.proyubi.platform` / `.account` / `.settings` | 租户、团队、邀请、菜单、通知、bootstrap、存储、租户设置 |
| `proyubi-pm` | `ai.proyubi.pm` | PM 业务（项目、任务、甘特、品质、资料、モックアップ、Design Studio、MCP 令牌） |
| `proyubi-server` | `ai.proyubi.server` | Spring Boot 启动壳、拦截器、`.env` 加载 |

## 运行

```bash
cp .env.dev.example .env.dev   # 填 PostgreSQL / Redis
./run.sh                        # http://localhost:38082
```

数据库结构见 `schema/`。SQL **不会**在启动时自动执行。

## 测试

```bash
mvn -B test
```

## 配置

`proyubi-server/src/main/resources/application*.yml`，敏感值一律走环境变量（见仓库根 `.env.example`）。
自有配置前缀是 `proyubi.*`。

## Proyubi rename compatibility (2026-11-18)

- Java namespace/group ID is now `ai.proyubi`; Maven modules and executable JAR use `proyubi-*`.
- New application configuration prefix: `proyubi.*`. Existing `pullcord.*` properties and `PULLCORD_*` environment variables are aliased after ConfigData and dotenv loading. Original source priority is retained; an explicit new name wins over its old name in the same source. `PROYUBI_TENANCY_MODE` is preferred, with `PULLCORD_TENANCY_MODE` fallback.
- Do not rename existing databases, users, SQL tables, `app_code=pm-web-jp`, API paths/headers, Sa-Token names or Redis keys merely to change branding. These persisted/wire identifiers are unchanged.
- Development database/user defaults and the storage bucket fallback remain `pullcord` to preserve existing data. For a fresh installation, explicitly set `SPRING_DATASOURCE_*` and `SUPABASE_STORAGE_BUCKET` to the desired names. Production datasource values remain mandatory external configuration.
- This rename does not migrate data or authorize a production cutover. The private legacy `server.env` still targets the old biz deployment and must not be used to deploy this independent project.
- Before a future shared-Redis cutover, check for cached Java-object JSON containing old fully-qualified type names (`ai.pullcord.*`). No current application usages of the generic `RedisTemplate` were found; this change does not purge caches or alter session keys. Any legacy serialized objects need an explicit migration/invalidation plan rather than blind namespace rewriting.

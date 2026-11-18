# Proyubi 命名迁移（2026-11-18）

当前独立产品统一命名 **Proyubi**。本次仅修改独立仓库，不修改旧 biz 或线上服务。

## 已迁移

- Java 包与 Maven groupId：`ai.proyubi`；模块：`proyubi-*`；主类：`ProyubiApplication`。
- Spring 配置前缀：`proyubi.*`，环境变量 `PROYUBI_TENANCY_MODE`；旧前缀与旧环境变量通过兼容适配读取。
- Web 包 `@proyubi/web`，MCP 包 `@proyubi/mcp` 与命令 `proyubi-mcp`，MCP server identity `proyubi-mcp`。
- 页面标题、邮件默认品牌、登录页、文档、五组 SVG/PNG 品牌字标。
- 仓库地址：https://github.com/Proyubi/proyubi 。未在本次同步中提交、推送或部署。

## 有意保留的兼容标识

| 标识 | 原因 |
|---|---|
| `pullcord.*` / `PULLCORD_*` | 只作为旧配置输入兼容，新代码与新文档使用 Proyubi。 |
| DB/user 默认 `pullcord` | 保持既有数据卷可连接；Compose 支持 `POSTGRES_DB` / `POSTGRES_USER`，不能只改名而不迁移已有数据库。 |
| 对象存储桶默认 `pullcord` | 避免原有文件失联。 |
| `pullcord_token` | 浏览器现有登录会话键，不清空登录态。 |
| `pullcord-design` | 已保存/导出的设计文件协议，不破坏导入及 MCP 客户端。 |
| 展示页 `pullcord-lang` | 保留既有语言偏好。 |
| `PM_*`、API路径、header、表名、app_code、Redis/session 标识 | 保持旧服务、客户端及数据兼容。 |

旧 Java 类型名如曾写入缓存，正式切换前需要单独确认序列化兼容。此次没有清理缓存、连接生产数据库或执行 SQL。

## 验证

- 后端：`mvn -B -Pprod package` 成功，117 测试通过，含 6 个配置兼容测试；JAR 启动类和注册信息已核验。
- MCP：`npm test` 成功，11 测试通过（含 2 个品牌/协议契约测试）。
- Web：TypeScript 和生产构建成功；Jest 10 套、87 测试通过，另品牌契约测试 3 项通过。
- Web lint 存在原有 8 errors / 36 warnings / 3 infos；原始快照复测诊断一致，没有新增。Jest 原有句柄不退出，最终验证使用 `--forceExit`。
- 构建/测试在 Mac mini 执行，完成后按文件散列同步到 MBP；不宣称独立产品已上线。

## 私密部署文件

`private/deploy/3plusx/server.env` 仅在用户两台电脑之间端到端加密复制，Git 忽略且权限 600。其内容仍指向旧 biz 生产部署，**不是独立 Proyubi 的部署配置，禁止直接用它部署新项目**。未更改其值。

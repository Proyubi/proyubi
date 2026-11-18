# Schema

独立项目的完整初始数据库结构与种子数据仍待从确认后的 schema 整理。**不能仅靠当前目录初始化空库。**

## 从正式 PM c55d48b 同步（2026-11-18）

- `reference/init-pm.sql`：正式 PM 的业务 schema 参考，包含 `pm_project.parent_id` 和父项目索引。它依赖 `platform_tenant`、`platform_team` 等平台表，不是独立可执行的空库 bootstrap。
- `migrations/2026-11-17-pm-project-parent.sql`：已有 PM 数据库补充父项目字段与索引的幂等脚本。仅保存；本次未运行任何数据库迁移。
- SQL 保留既有表名和字段兼容，不引入 AI 规划中的表。

两个文件故意放在子目录，避免 PostgreSQL `/docker-entrypoint-initdb.d/*.sql` 首次启动自动执行不完整的旧 schema。运行任何脚本前必须确认目标数据库、已有结构、备份及平台表依赖。

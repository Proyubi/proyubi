# IMPLEMENTATION_NOTES — 通用 CSV 导入 + Jooto 预设（PRD-2026-001-T07）

> 状态：**方案待 CEO 确认**（尚未开始大规模改动） · 创建日：2026-10-24 · HiFox MY-2
> 作者：妇好｜研发经理 · 分支：`feat/pm-csv-import`（本地，未 push）
> 输入：`jooto-csv-import-pack.zip`（TASK.md / SPEC-jooto-csv.md / ACCEPTANCE.md / samples/，样本均为合成数据）
> 基线：`main` @ `42faa39`

本文件只写「映射到哪些实体」「和 TASK.md 不一样的地方」「需要 CEO 拍板的点」。规格本身以 TASK/SPEC/ACCEPTANCE 为准，不重复。

---

## 1. 现有 domain model 核对结果（以仓库为准）

| TASK.md 参考名 | 仓库实际 | 核对结论 |
|---|---|---|
| `PmTask` | `com.moonya.pm.domain.PmTask` / 表 `pm_task` | 一致。`status` 固定 6 值；`levels text[]` 是自由标签；`assigneeIds text[]` = **`pm_member.id`**；`parentId` 构成 WBS 树；日期只有 `LocalDate`（`start_date`/`end_date`/`actual_*`）；`description` 是**富文本 HTML**；`sort_order` 同级排序 |
| `PmComment` | `pm_comment` | `author_user_id`（not null，`platform_tenant_user.id`）、`author_member_id`、`author_name` 快照、`content` 纯文本、`created_at` 可写 → **能保留原投稿日时** |
| `PmProject`（挂 `PmCustomer`） | `pm_project`（`customer_id`、`team_id`） | 一致。导入目标为**已存在的项目**，不新建项目/客户 |
| `PmTaskActivity` | `pm_task_activity`（`PmTaskActivityService`） | 需与任务写入同一事务；不能吞异常 |
| `/internal/pm/tasks/tree` idMap | `PmInternalController` | 参考其 idMap 思路做「CSV 行 → 新任务 id」映射，不复用该接口 |
| 检查清单实体 | **不存在** | 走降级方案（见 §3-1） |
| 自定义列 / 看板自定义状态 | **不存在** | リスト名 只能映射到 6 个固定 status + 保存原名（见 §2） |
| 成员 email | `pm_member` 无 email；email 在 `platform_tenant_user_identity(identity_type='email')` | 按 email 匹配需 join 平台表（手写 SQL，必须显式 `tenant_id = ?`） |
| RBAC「项目管理员」 | 只有 `platform_tenant_user.role` = `owner` / `member`；`platform_tenant_role` 表存在但未使用；无项目级角色 | 见 §3-3 |
| 多租户 | PM 实体均 `@Column(tenantId = false)` → **不走** MyBatis-Flex 自动租户条件，全部靠手写 `.eq(tenantId)` + `PmTeamScopeService` 团队可见性 | 导入代码所有查询/写入显式带 tenant + project，并对项目调用 `assertTeamVisible` |
| CSV 库 | 仓库无 commons-csv / opencsv | 自写流式 RFC 4180 解析器（需要物理行号、引号不闭合、列数不符等精确错误，自写更可控；不新增依赖） |

## 2. 字段映射（Jooto → PM）

| Jooto 列 | 写入 | 备注 |
|---|---|---|
| リスト名 | `status`（预览页 リスト→status 映射表，默认按名猜测）+ 标签 `jooto-list:<原名>` 写入 `levels` | 无自定义列，选「标签」方案：可筛选、可作幂等键载体 |
| タスク名 | `name` | 幂等键 = (tenant, project, NFKC(リスト名), NFKC(タスク名))；在库中按「同项目 + 同名 + 标签 jooto-list:<名>」查找 |
| 説明欄 / 説明 | `description` | 纯文本 → **HTML 转义 + 换行转 `<br>`**（description 是富文本，否则换行/`<`/`"` 会丢或被当标签）。逗号/引号/emoji/① 原样 |
| ステータス | 非空时追加标签 `jooto-status:<原值>` | 含义未确认，只保留不解释 |
| ラベル | `levels`（多值拆分） | `levels` 是自由文本，"不存在就新建" 天然满足 |
| タスク担当者 | `assigneeIds`（pm_member.id） | email → 显示名（NFKC、去空格）匹配；只在本 tenant 的有效 pm 成员内找。未匹配默认忽略并在描述末尾追加「Jooto担当者: 名字」 |
| タスク開始日/時間, 締切日/時間 | `start` / `end`（LocalDate） | 时间丢弃，记一次汇总警告；时间原值追加到描述末尾的「Jooto: 開始 … / 締切 …」一行（不丢信息） |
| 予定 / 実績 | `plannedEffortDays`+`plannedEffortHours` / `actualEffortDays`+`actualEffortHours` | 仓库口径：工期 = days×24h + hours（hours 0–23.75，0.25 刻み）。X 小时 → days=⌊X/24⌋、hours=余数（四舍五入到 0.25，产生舍入时警告）。单位预览页可选 小时/人日（人日按租户 `hoursPerWorkday` 换算） |
| チェックリスト名/アイテム名/完了フラグ/アイテム担当者/日期 | 子任务（见 §3-1） | 完了=1 → `status=done, progress=100`；否则 `todo, 0` |
| コメント（评论 CSV） | `pm_comment` | 关联本项目内按 (リスト名, タスク名) 找到的任务；投稿者匹配到 → 其 tenant user / member；匹配不到 → 作者=导入执行人，正文前加「[Jooto: 投稿者名 YYYY/MM/DD HH:mm]」；`created_at` = 原投稿日时（Asia/Tokyo） |

行顺序 → `sort_order`（保持 Jooto 看板顺序）。

## 3. 与 TASK.md 不一样 / 需要 CEO 拍板的点

### 3-1【需决定】检查清单降级为子任务，会和 D1 冲突
仓库现有规则：任务一旦有子任务，父任务变 `summary`，**`assigneeIds` 被清空**（`PmTaskService.ensureParentIsSummary`），且 summary 的起止/进度**由叶子汇总**（`TaskRollupService`，与 pm-web `tree.ts` 同口径）。
→ 样本「要件定義書作成」带 2 个检查清单项：按 C2 降级为子任务后，甘特上显示的担当者/日期会变成子任务的汇总值（11/05–11/06），与 D1（担当者 山田太郎、11/02–11/06）冲突。

| 方案 | 做法 | C2 | D1 |
|---|---|---|---|
| **A（推荐）** | 按 TASK.md 建子任务（「チェックリスト名 / アイテム名」），父任务按现有规则变 summary；父任务原担当者/日期写进描述末尾「Jooto: 担当者 山田太郎 / 開始 2026/11/02 09:00 / 締切 2026/11/06 18:00」；预览页明确提示 | ✅ | ⚠️ 信息保留在描述里，但字段值是汇总值 |
| B | 父任务仍是普通任务，检查清单渲染为描述里的 ☑/☐ 列表 | ❌ | ✅ |
| C | A + 额外建一个叶子「<タスク名>（本体）」承载原担当者/日期 | ✅ | ✅（在叶子上） |

推荐 A：不破坏现有 WBS 汇总语义，ACCEPTANCE 的 D1 改为「描述含原值」。checklist 实体本身属于大 schema 改动，按 TASK §3 不在本任务做（如需要可另立任务出方案）。

### 3-2【需决定】任务日期必须落在项目周期内
`PmTaskService.validateWithinProject`：任务 start/end 超出项目 [start, end] 直接 400。Jooto 数据多半超出目标项目周期。
- **推荐**：预览页检出越界，提供开关「项目周期を自動で広げる」（默认 ON，提交时把项目 start/end 扩到覆盖全部任务，记入 import job）；OFF 时越界日期置空 + 行警告。
- 不选「整行报错」——会和「字段级问题=警告」的原则冲突。

### 3-3【需决定】「项目管理员」权限
仓库没有项目级角色，只有租户 `owner` / `member`。
- **推荐**：只有 `owner` 可执行导入/保存 preset（复用 `PmTeamScopeService.assertOwner()`），并且目标项目需团队可见。member → 403（满足 F3）。
- 如果希望 member 也能导入，需要先定义项目级角色，属于另一项权限改动。

### 3-4【需确认】新增 2 张小表（migration）
TASK 要求 import job 记录、tenant 级映射 preset、可下载错误报告，现有表无法承载，需要新增（非 checklist 级的大改动，但仍是 schema 变更，先报备）：
- `pm_import_job`：tenant_id, project_id, created_by, file_name, file_sha256, encoding, file_type, mapping jsonb, options jsonb, mode(dry_run/commit), status, counts jsonb, errors jsonb（行号/列/原因/级别，错误报告 CSV 由此生成）, created_at, finished_at
- `pm_import_preset`：tenant_id, name, source(`jooto`/`generic`), header_signature, mapping jsonb, created_by, timestamps, deleted_at；唯一键 (tenant_id, lower(name)) where deleted_at is null

两张表都走 `webapi/schema/init-pm.sql` + `migrations/2026-10-xx-pm-import.sql`（幂等 DDL，同步镜像到 `moonya-server/.../db/schema/`）。**不改任何现有表结构**；上线需 `deploy/db.sh init`，由 CEO 决定时机。

幂等键不另建表：任务键 = 项目内「同名 + 标签 `jooto-list:<名>`」；子任务键 = (父任务, 子任务名)；评论键 = (任务, created_at, author_name 快照, 原文 hash)。代价：用户手动删掉 `jooto-list:` 标签后再导入会被视为新任务（与 Jooto 自己「リスト名+タスク名」判定一致，可接受）。

### 3-5 预览 → 提交的文件传递
不在服务端暂存上传文件（避免多实例/临时文件清理问题）：预览接口返回 `jobId + fileSha256`，提交时前端**再次上传同一文件**，服务端校验 hash 一致才执行。dry-run = 只跑预览管线，不写业务表（只写 job 记录）。

### 3-6 性能实现
不逐行调用 `PmTaskService.create`（每次都会 recompute 项目进度，5,000 行是 O(n²)）。改为：流式解析 → 内存分组（5,000 行级对象，不持有原始文件全文）→ 一次查询已存在键 → `insertBatch` 任务/评论/活动日志 → 最后 `recomputeProjectProgress` 一次。全部在一个事务内；任务活动日志每个新任务一条 `created`（批量写）。文件大小上限 `moonya.pm.import.max-file-size`，默认 20MB；编码判定对字节流做一次严格 UTF-8 校验（不整体解码成 String）。

### 3-7 未匹配用户的选项③（占位/邀请）
`PmMemberService.create` 要求绑定本租户已有用户，现有 API 不支持无绑定的占位成员；邀请会对外发邮件（需另行授权）。→ 本任务只提供 ①映射到已有成员 ②忽略（默认，描述末尾追记）。

### 3-8 测试环境
仓库只有纯单元测试，无 DB 集成测试；本机无 Docker。
- 解析/编码/表头识别/分组/映射/计数/错误报告：纯 Java 单元测试，覆盖 `samples/` 全部文件（A、B1 计数、C、D、E1 的大部分）。
- 写库相关（E2–E4 幂等、F1–F2 跨租户、B1 "数据库无变化"、G1 性能）：**推荐**新增测试依赖 `io.zonky.test:embedded-postgres`（无需 Docker，测试时下载 PG 二进制，Apache-2.0），对 `init-platform.sql` + `init-pm.sql` 建库后跑真实 SQL。如果不同意加依赖，这部分只能用 Mockito 模拟 mapper，跨租户测试的说服力会弱很多。

### 3-9 其他宽松处理（按 SPEC §6，无需决定，列出备查）
- 编码：BOM → UTF-8 BOM；严格 UTF-8 可解 → UTF-8；否则 CP932（`windows-31j`）。预览页可手动改。
- 表头：NFKC → trim（含全角空格）→ 去 `[]`；同义词表（説明/説明欄 等）；按列集合判定 任务+检查清单 / 仅任务 / 评论；都不是 → 通用 CSV，进入手动映射，可存 preset，下次按表头签名自动套用。
- Jooto 导入模板的说明行（官方模板第 2–5 行）：按特征识别后**警告并默认跳过**，用户可取消跳过。
- 多值分隔符 `, 、 ， ; ； /` 换行，预览页可改；日期 `yyyy/MM/dd`、`yyyy-MM-dd`、`yyyy/M/d`、`yyyy年M月d日`；时间 `H:mm`、`HH:mm`、`HH:mm:ss`；解析失败 → 置空 + 警告。
- 同一 リスト 内同名任务的多行 → 合并，任务字段取首个非空值，冲突时警告；不同 リスト 同名 → 不同任务。
- 行错误（跳过该行）：タスク名 空、列数多于表头、引号不闭合（到 EOF）、评论找不到任务。行号 = 物理行号（含表头为第 1 行，多行单元格按起始行计）。
- 超长文本：`description`/`content` 是 `text`，12,000 字不截断。

## 4. 交付拆解（确认后执行）

| # | 小项 | 产出 | 验收 |
|---|---|---|---|
| 1 | schema：`pm_import_job` / `pm_import_preset` + migration + 镜像 | SQL | 幂等重复执行 OK |
| 2 | 解析层：编码判定、流式 RFC 4180、表头规范化/识别、Jooto preset、通用映射 | `com.moonya.pm.importer.*` | A1–A6、E1 行号，单元测试 |
| 3 | 计划层：分组合并、映射、用户匹配、幂等比对、计数/警告/错误 → 预览结果 | `PmImportPlanner` | B1、C1、D1–D9 |
| 4 | 执行层：批量写入、skip/overwrite、评论、项目周期扩展、job 记录、错误报告 CSV | `PmImportService` + `PmImportController`（`/app/pm/projects/{id}/import/*`） | E2–E4、F1–F3、G1 |
| 5 | pm-web：项目页「インポート」向导（上传→预览/映射/选项→提交→结果+下载报告），4 语言 | `pm-web/src/pm/import/*` | A7、B2、C2 提示、D4 未匹配列表 |
| 6 | 使用说明 + PR 描述逐条对照 ACCEPTANCE | `doc/design/pm-csv-import/USAGE.md` | — |

分工：本机目前只绑定 1 个 Claude Runtime（`youfuu的MacBook Pro`），1→4 后端先做，5 前端在后端接口冻结后做；独立审查/测试请 Codex（如可用）在单独工作区进行，不共用本工作目录。WMS 代码不碰；不改生产数据；不 push 到 `andydev920/Pullcord`。

## 5. 请 CEO 回复（一句话即可）
1. §3-1 检查清单：A / B / C？（推荐 A）
2. §3-2 越界日期：自动扩展项目周期（默认 ON）可以吗？
3. §3-3 权限：仅 owner 可导入，可以吗？
4. §3-4 新增 `pm_import_job` / `pm_import_preset` 两张表，可以吗？
5. §3-8 新增测试依赖 embedded-postgres，可以吗？
6. 分支 `feat/pm-csv-import` 是否允许 push 到私有仓库 `andydev920/MoonyaBit` 供审查（不合并）？

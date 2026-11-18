# PM 多团队（Multi-Team）设计方案

> 需求：**PRO 套餐**的租户可以在「团队管理」里创建**多个团队**（现在固定 1 个），邀请成员时由租户选择加入哪个团队，成员可同属多个团队。仅租户（owner / PRO）能做此选择。
>
> 已确认方向：
> - **方案 A — 租户配下的子团队**：1 个 PRO 订阅（课金仍按 tenant 单位），其内部可建多个团队。
> - **数据按团队隔离**：项目 / 任务 / 客户等业务数据带 team 维度，成员只看到自己所属团队的数据。
> - **先出设计文档，确认后再实施。**
>
> 状态：✅ 方向已确认（2026-06-10），可进入实施 ｜ 创建日 2026-06-10
>
> **已确认的 4 个决策：**
> 1. **术语**：tenant → 「ワークスペース/工作区」，新概念 → 「チーム/团队」。switch-team 等后端命名保留，仅改前端文案。
> 2. **TRIAL**：放开多团队（FREE 才固定 1 团队）。
> 3. **删团队**：非空团队**不可删**，必须先把项目/客户迁走。
> 4. **降级 PRO→FREE**：v1 仅「禁止新建 + 警告」，既有多团队保留不动；冻结/合并留后续。

---

## 0. 一个必须先解决的命名冲突 ⚠️

现有代码/UI **已经把「租户(tenant)」叫做「团队(Team)」**：

| 现有位置 | 现在的"团队"指的是 |
|---|---|
| `GET /app/auth/me` → `availableTeams` | 用户名下的**各个租户**（跨租户 switch-team） |
| `POST /app/auth/switch-team` | 切换**租户** |
| 设置页「团队名」(`PUT /app/team/tenant`) | 改的是 **`platform_tenant.name`** |
| 邀请邮件「"%s"チームへの参加」 | 加入某个**租户** |

而本需求新增的「团队」是**租户内部的子分组**。两者不是同一层。若沿用同一个词会在 UI 和代码里彻底混淆。

**建议术语（本方案默认采用）：**

| 层级 | 实体 | 中文 | 日文 UI | 英文 |
|---|---|---|---|---|
| 账号/组织（课金单位） | `platform_tenant` | 组织 / 工作区 | ワークスペース | Workspace |
| 组织内的子分组（本次新增） | `platform_team` | **团队** | **チーム** | Team |

即：把现有 UI 里"团队"层级（租户）改称**ワークスペース/工作区**，把"团队/チーム"这个词**让给新的子团队**。`switch-team`/`availableTeams` 等后端命名因涉及登录态可保留（仅改前端文案），降低改动面。

> ✅**已确认**：采用上面的术语方案 —— tenant 改称「ワークスペース/工作区」，「チーム/团队」让给新的子团队。`switch-team`/`availableTeams` 等后端命名保留，仅改前端文案。

---

## 1. 现状梳理（事实基线）

### 1.1 实体与隔离
- 一切业务数据按 `tenant_id` 隔离；请求态由 `TenantContextInterceptor` 从 Sa-Token Session 取 `tenant_id` 注入 `TenantContext`（ThreadLocal）。
- 成员主体：`platform_tenant_user`（一个 email 账号可在多个租户各有一条 tenant_user，靠 `platform_tenant_user_identity` 的 email 聚合 → `availableTeams`）。
- PM 侧成员投影：`pm_member`（每个 tenant_user 在租户内至多一条，绑定 `user_id`，用于甘特着色/指派）。
- PM 业务树：`pm_customer → pm_project → pm_task`，外加 `pm_dependency / pm_mindmap / pm_roadmap_option / pm_holiday`，**全部仅有 `tenant_id`，无 team 维度**。

### 1.2 邀请（已完整）
- `platform_invitation`：owner 按 email 邀请 → 邮件 token → 被邀请人 `accept` 时在该租户建 `tenant_user` + email identity（`AppMyInvitationService.accept`）。
- owner 侧：`/app/team/invitations`（`AppInvitationService`）；被邀请人侧：`/app/invitations`（`AppMyInvitationService`）。

### 1.3 套餐（已完整，可直接复用门控）
- `platform_plan`（FREE / TRIAL / PRO）+ `platform_subscription`（`plan_type`）。
- **已有现成查询**：`AppTeamMapper.findPlanCodeByTenantId(tenantId)` 返回当前租户的 plan code —— 多团队门控直接复用它。

### 1.4 团队管理 UI
- `pm-web/src/pages/settings/index.tsx` 的 `TeamTab`：成员表 + 邀请表 + 邀请弹窗 + 权限弹窗，调 `/app/team/**`。

---

## 2. 范围与非目标

**本次范围（v1）：**
1. 新增「团队（platform_team）」概念，租户内 1..N 个；FREE/TRIAL 固定 1 个，PRO 可多个。
2. 成员与团队 **多对多**（`platform_team_member`）。
3. 邀请时选择目标团队（可多选）；被邀请人接受后自动加入这些团队。
4. **PM 业务数据按团队隔离**：`pm_customer` / `pm_project` 带 `team_id`；成员只见自己所属团队的数据；owner 见全部。
5. 团队管理 UI：团队的增删改 + 团队成员的加入/移出。
6. 全量租户**回填**一个「默认团队」，存量数据零感知迁移。

**非目标（v1 不做，列入后续）：**
- WMS / 家計簿（`wms_* / finance_*`）数据**暂不**按团队隔离（仍租户级共享）。本次只隔离 PM 模块。
- 团队级 RBAC（团队内再分角色权限）。v1 团队成员一视同仁，权限仍走 tenant_user 的 `custom_permissions`。
- 跨团队移动项目的批量工具（v1 仅支持建项目时选团队 + 单个项目改所属团队）。
- 降级（PRO→FREE）时多团队的自动合并（见 §8 决策点）。

---

## 3. 数据模型设计

> 全部 DDL 幂等（`create table if not exists` / `add column if not exists` / `insert ... where not exists`），同步写入 `server/schema/` 与 `server/proyubi-server/src/main/resources/db/schema/` 两份。

### 3.1 新表：`platform_team`（放 init-platform.sql）

```sql
create table if not exists platform_team (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  name text not null,
  color text,                                  -- UI chip 着色，可空
  is_default boolean not null default false,   -- 每租户唯一的默认团队（回填/降级兜底用）
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_platform_team_tenant
  on platform_team (tenant_id, deleted_at);

-- 每个租户至多一个默认团队
create unique index if not exists ux_platform_team_default
  on platform_team (tenant_id)
  where is_default = true and deleted_at is null;
```

### 3.2 新表：`platform_team_member`（成员 ↔ 团队，多对多）

```sql
create table if not exists platform_team_member (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),   -- 冗余，便于隔离查询
  team_id uuid not null references platform_team(id),
  tenant_user_id uuid not null references platform_tenant_user(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists ux_team_member_unique
  on platform_team_member (team_id, tenant_user_id)
  where deleted_at is null;

create index if not exists ix_team_member_user
  on platform_team_member (tenant_user_id, deleted_at);
```

> 关系挂在 `platform_tenant_user`（而非 `pm_member`）上，与邀请/课金/登录主体对齐；`pm_member` 仍只是显示档案。

### 3.3 业务表加 `team_id`

```sql
-- 客户/产品：归属团队
alter table pm_customer add column if not exists team_id uuid references platform_team(id);
create index if not exists ix_pm_customer_team on pm_customer (team_id, deleted_at);

-- 项目/版本：归属团队（隔离的主维度）
alter table pm_project  add column if not exists team_id uuid references platform_team(id);
create index if not exists ix_pm_project_team on pm_project (team_id, deleted_at);
```

- `pm_task / pm_dependency / pm_mindmap`：**不直接加 team_id**，通过 `project_id → pm_project.team_id` 推导（避免双写不一致）。如查询性能需要，可后续给 `pm_task` 加冗余 `team_id`（带回填），v1 先不加。
- `pm_roadmap_option / pm_holiday`：保持**租户级共享**（泳道字典、节假日跨团队通用），不加 team_id。

### 3.4 邀请加目标团队

```sql
-- 一条邀请可指向多个团队（owner 多选）；接受时全部加入
alter table platform_invitation add column if not exists team_ids jsonb;
```

> 用 `jsonb` 存 team_id 数组，避免再开一张 invitation_team 关联表。FREE/TRIAL 单团队时存默认团队的单元素数组（或留 null = 默认团队）。

---

## 4. 数据回填（存量迁移，幂等）

启动时随 init 脚本执行；必须可重复跑：

```sql
-- (1) 每个还没有团队的租户，建一个默认团队（名取租户名，兜底"デフォルトチーム"）
insert into platform_team (id, tenant_id, name, is_default, sort_order)
select gen_random_uuid(), t.id, coalesce(nullif(t.name,''), 'デフォルトチーム'), true, 0
from platform_tenant t
where t.deleted_at is null
  and not exists (select 1 from platform_team pt where pt.tenant_id = t.id and pt.deleted_at is null);

-- (2) 该租户所有启用中的 tenant_user 加入默认团队
insert into platform_team_member (id, tenant_id, team_id, tenant_user_id)
select gen_random_uuid(), tu.tenant_id, dt.id, tu.id
from platform_tenant_user tu
join platform_team dt on dt.tenant_id = tu.tenant_id and dt.is_default = true and dt.deleted_at is null
where tu.deleted_at is null
  and not exists (
    select 1 from platform_team_member m
    where m.team_id = dt.id and m.tenant_user_id = tu.id and m.deleted_at is null);

-- (3) 存量 pm_customer / pm_project 的 team_id 补成默认团队
update pm_customer c set team_id = dt.id
from platform_team dt
where dt.tenant_id = c.tenant_id and dt.is_default = true and dt.deleted_at is null
  and c.team_id is null;

update pm_project p set team_id = dt.id
from platform_team dt
where dt.tenant_id = p.tenant_id and dt.is_default = true and dt.deleted_at is null
  and p.team_id is null;
```

迁移后 `pm_project.team_id` / `pm_customer.team_id` 对存量数据已非空；新建路径强制写入 → 业务读取一律按 team 过滤，行为对单团队租户完全无感。

> 大表 `update` 一次性回填放入 `schema/migrations/` 单独手动执行一次（与 `pm-task-status` 迁移同样模式），init 脚本里只保留 idempotent 的建表/补列/默认团队播种，避免每次启动重扫全表。

---

## 5. 套餐门控

| 套餐 | 团队数 | 行为 |
|---|---|---|
| FREE | 固定 1（默认团队） | 隐藏"新建团队"；邀请/建项目不显示团队选择，自动落默认团队 |
| TRIAL | 多个（试用即体验 PRO） | ✅ 同 PRO，放开多团队 |
| PRO | 多个 | 全功能 |

- 后端在 `createTeam` 入口校验：`findPlanCodeByTenantId(tenantId)` ∈ {PRO, TRIAL} 才允许新建；否则 `BizException(403, "当前套餐不支持多团队，请升级到 PRO")`。
- **降级 PRO→FREE（决策点 4）**：v1 仅在 `createTeam` 处拦截（FREE 已有 ≥1 团队即拒绝新建）并在前端提示；既有多团队**保留不冻结**，升级后恢复可建。冻结/合并留后续。
- `GET /app/team/teams` 返回里带 `canCreateMore: boolean`，前端据此显示/隐藏入口（前端门控仅体验，**真值以后端为准**）。

---

## 6. 后端 API 设计

新增控制器 `AppTeamGroupController`（或并入现有 `AppTeamController`，前缀 `/app/team/teams`），均需 `StpTenant.checkLogin()`，写操作校验 owner。

| Method & Path | 说明 | 权限 |
|---|---|---|
| `GET /app/team/teams` | 当前租户团队列表（含成员数、`isDefault`、`canCreateMore`） | 登录 |
| `POST /app/team/teams` | 新建团队（套餐门控） | owner |
| `PUT /app/team/teams/{id}` | 改名 / 颜色 / 排序 | owner |
| `DELETE /app/team/teams/{id}` | 删除团队（默认团队不可删；非空团队的处置见决策点 3） | owner |
| `GET /app/team/teams/{id}/members` | 团队成员列表 | 登录 |
| `PUT /app/team/teams/{id}/members` | 设置团队成员（传 tenant_user_id 数组，差量增删） | owner |

**改造现有接口：**
- `POST /app/team/invitations`：请求体加 `teamIds: string[]`（PRO 必填、FREE/TRIAL 忽略→默认团队）。校验 teamIds 全部属于本租户。`AppMyInvitationService.accept` 在建/复用 tenant_user 后，按 `invitation.team_ids` 批量插 `platform_team_member`（幂等）。
- PM 数据接口（`/app/pm/projects`、`/app/pm/customers`、overview、gantt 等）：
  - 列表查询追加 **team 过滤**：`team_id in (当前用户所属团队)`；owner 不限。支持可选 `?teamId=` 精确筛选某团队。
  - 新建 `project` / `customer`：请求体加 `teamId`（PRO 必填且须是调用者所属团队；FREE/TRIAL 自动默认团队）。
  - 单项目改属：`PUT /app/pm/projects/{id}` 支持改 `teamId`（owner，目标团队须本租户）。

**隔离实现要点：**
- 在 service 层解析"当前用户可见 team 集合"：owner → 本租户所有 team；member → `platform_team_member` 里该 tenant_user 的 team。封装成 `TeamScopeResolver.visibleTeamIds(tenantId, userId, role)`，PM 各查询统一调用，避免散落。
- `pm_task / pm_dependency` 通过其 `project_id` 的 team 间接受控（查询 join `pm_project` 过滤；或先校验 project 可见再放行子资源）。

---

## 7. 前端设计（pm-web）

### 7.1 团队管理（设置页）
`TeamTab` 重构为两段：
1. **团队（チーム）列表**（PRO 才显示管理入口）：卡片/表格列出团队，"新建团队"按钮（FREE/TRIAL 置灰并提示升级），每个团队可改名、查看/编辑成员（多选 tenant_user 勾选加入）。
2. **成员列表**：保留现状，额外一列展示"所属团队"标签（chips）。

### 7.2 邀请弹窗
- 加「目标团队」多选（PRO；FREE/TRIAL 不显示，默认团队）。
- `createInvitation` 入参加 `teamIds`。

### 7.3 PM 页面（projects 列表 / gantt / overview）
- 顶部加**团队筛选器**（下拉/标签页）。member 默认且仅能选自己所属团队；owner 可选「全部」或某团队。
- store（`pm-web/src/pm/store.tsx`）：`ensureBase()` 增载团队列表 + 当前用户可见团队；`loadProjects` 带 `teamId` 过滤参数；新建项目/客户表单加团队选择。
- `pm/api.ts`：新增 `listTeams / createTeam / updateTeam / deleteTeam / setTeamMembers`；`createProject / createCustomer` 入参加 `teamId`。
- `pm/types.ts`：`Team` 类型；`Project` / `Customer` 加 `teamId`。

### 7.4 文案/i18n
- 四语言（zh-CN/zh-TW/en-US/ja-JP）：把现有"团队/チーム"=租户的文案改为「ワークスペース/工作区」；新增「チーム/团队」相关词条（menu.ts / pages.ts）。

---

## 8. 边界情况与决策点

- ✅**决策点 1（术语）**：tenant→「ワークスペース/工作区」、新概念→「チーム/团队」。（§0）
- ✅**决策点 2（TRIAL）**：TRIAL **放开**多团队，仅 FREE 固定 1 团队。
- ✅**决策点 3（删团队）**：**禁止删除非空团队**，必须先把项目/客户迁走（`DELETE` 校验团队下无有效 project/customer，否则 `BizException(400, "请先迁移或删除该团队下的项目")`）。默认团队任何情况都不可删。
- ✅**决策点 4（降级 PRO→FREE）**：v1 仅「禁止新建 + 警告」，既有多团队保留不动，不冻结不合并；升级后恢复可建。冻结/合并留后续。
- **owner 可见性**：owner 始终可见本租户全部团队数据，无需显式加入 `platform_team_member`。
- **成员被移出所有团队**：仍是租户成员，但 PM 页面无可见项目（显示空态 + 提示联系管理员）。
- **WMS/家計簿数据**：v1 不隔离，跨团队共享（明确告知，避免误以为全站隔离）。

---

## 9. 实施阶段拆分（建议按 PR 切）

1. **PR1 — Schema & 回填**：`platform_team` / `platform_team_member` 建表、`team_id` 补列、`invitation.team_ids`、默认团队播种 + 存量回填迁移脚本（两份 schema 同步）。
2. **PR2 — 团队 CRUD 后端**：`AppTeamGroupController` + service + mapper + 套餐门控 + `TeamScopeResolver`。
3. **PR3 — 邀请改造**：`teamIds` 入参 + accept 落地团队成员。
4. **PR4 — PM 数据隔离后端**：project/customer 读写带 team 过滤与写入，overview/gantt 接口适配。
5. **PR5 — 前端团队管理 + 邀请团队多选**（设置页）。
6. **PR6 — 前端 PM 团队筛选 + 建项目选团队 + i18n 术语调整**。

---

## 10. 测试要点

- 单团队（FREE）租户：全流程行为与改造前一致（回归）。
- PRO 建多团队 → 邀请到指定团队 → 被邀请人 accept → 只看到该团队项目。
- 同一 email 跨租户 + 租户内跨团队：`availableTeams`（租户层）与团队筛选（租户内）互不串味。
- owner 看到全部团队；member 仅自己团队；移出团队后即时失去可见性。
- 删除默认团队被拒；删除非空团队按决策点 3 行为。
- 迁移脚本重复执行幂等（不产生重复默认团队/重复成员关系）。

---

## 附：关键文件清单

**后端**
- Schema：`server/schema/init-platform.sql`、`init-pm.sql`（+ `server/proyubi-server/src/main/resources/db/schema/` 同步两份）、`schema/migrations/2026-06-xx-multi-team.sql`
- 邀请：`modules/wms/service/AppInvitationService.java`、`AppMyInvitationService.java`、`mapper/AppInvitationMapper.java`、`controller/AppTeamInvitationController.java`
- 团队管理：`modules/wms/controller/AppTeamController.java`、`service/AppTeamService.java`、`mapper/AppTeamMapper.java`（新增 team CRUD）
- 套餐门控：复用 `AppTeamMapper.findPlanCodeByTenantId`
- PM：`modules/pm/service/Pm*Service.java`、`controller/Pm*Controller.java`、新增 `TeamScopeResolver`
- Mapper 注册：`ProyubiApplication` `@MapperScan`

**前端**
- `pm-web/src/pages/settings/index.tsx`（TeamTab）
- `web/src/services/platform/{team,invitation}.ts`
- `pm-web/src/pm/{store.tsx,api.ts,types.ts}`、`pages/projects/*`、`pages/overview/*`
- `pm-web/src/locales/*/{menu,pages}.ts`
</content>
</invoke>

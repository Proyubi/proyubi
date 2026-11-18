# PM 路线图「レーン / 作業区分」可自定义化 — 设计与实施方案

> 作成: 2026-06-03 / 担当: PM + 技术架构
> 对象: pm-web 内 PM 应用「スケジュール / ロードマップ」视图 + pm-api `pm` 模块
> 状态: 已定稿（用户决策已确认），待实施

---

## 0. 背景与问题

「スケジュール / ロードマップ」视图（`pm-web/src/pm/roadmap/RoadmapView.tsx`）当前用两个**写死的枚举**组织任务：

| 维度 | 写死值 | 存储 | 视觉职责 |
|------|--------|------|----------|
| **レーン（泳道 roadmapLane）** | `milestone / system / business` + 隐式 `default`，顺序硬编码在 `LANE_ORDER` | `pm_task.roadmap_lane (text)` | 决定任务排在**哪一行** |
| **作業区分（ownerParty）** | `client / vendor`（貴社/弊社） | `pm_task.owner_party (text)` | 决定 phase 条**颜色**（绿=client / 蓝=vendor）+ 底部图例 |
| 里程碑色（milestoneColor，附属） | `critical / normal / client / vendor` | `pm_task.milestone_color (text)` | 仅里程碑菱形标记颜色 |

**核心痛点（真实数据已证实）**：seed 数据 `server/schema/seed-pm-roadmap-demo.py` 显示，实际项目里 `system` 泳道任务 100% 是 `vendor`、`business` 泳道任务 100% 是 `client`。即**泳道 ≈ 作業区分**，两维度信息重复、互为冗余。同时这套枚举是为「教务系统导入」量身定制，换个项目就不适用。

→ 不是「加几个枚举值」，而是**把写死维度收敛成一套用户可自定义的字典**。

## 1. 已确认决策

1. **作業区分（貴社/弊社）彻底废弃**：删除该独立维度，其唯一有用职责（着色）并入泳道——每条泳道自带颜色，同泳道任务同色。任务表单中的 ownerParty radio 移除，底部图例改为「按泳道动态列出 名称 + 色块」。
2. **作用范围 = 团队（租户）级共享**：全团队一套泳道字典，所有客户/项目通用，与 `pm_member` 同级。配一次，处处可用。
3. **里程碑色去业务语义**：`milestone_color` 的 `client/vendor` 命名废弃，改为中性语义档（如 重要/通常/强调），同样进字典、可自定义颜色。
4. **存量零迁移**：`pm_task` 上的字段保持 text 不动，继续存 `milestone`/`system` 这些 key；字典种子沿用同一批 key，老数据天然对齐，现有路线图视觉零变化。

## 2. 设计原则

- **一个维度做主**：泳道是唯一结构维度，颜色随泳道走，消除「分行」与「着色」表达同一件事的重复。
- **配置与数据分离**：泳道是配置实体，任务只持有对其 key 的软引用；改名/改色不回改任务。
- **里程碑特殊但不例外**：milestone 行固定置顶、系统内置、不可删，但可改名/改色。
- **渐进不破坏**：上线后现有路线图照常显示。
- **克制**：MVP 只解决「写死→可改」，不做跨维度筛选、标签系统、模板市场。

## 3. 数据模型

### 3.1 新增字典表 `pm_roadmap_option`（租户级，幂等 DDL）

一张表用 `kind` 区分用途（首版 `lane` + `ms_color`；`party` 不再使用），管理 UI 与后端逻辑复用。

```sql
create table if not exists pm_roadmap_option (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  project_id uuid references pm_project(id),   -- null=租户级全局；预留项目级覆盖（首版只写 null）
  kind text not null,                          -- 'lane' | 'ms_color'
  option_key text not null,                    -- 稳定 key，pm_task 引用此值；系统种子沿用旧枚举值
  label text not null,                         -- 显示名（日文优先）
  color text,                                  -- '#52c41a' 等；lane 必填、ms_color 必填
  sort_order int not null default 0,
  is_system boolean not null default false,    -- 系统内置（不可删，可改色/名/序）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_roadmap_option_lookup
  on pm_roadmap_option (tenant_id, kind, deleted_at);
create unique index if not exists ux_pm_roadmap_option_key
  on pm_roadmap_option (tenant_id, kind, option_key)
  where project_id is null and deleted_at is null;
```

- **作用域**：`project_id` 列预留——`null` 即租户级全局；将来要项目级覆盖时按 `WHERE tenant_id=? AND (project_id IS NULL OR project_id=?)`、非空优先。首版只写 null 行。
- **多语言 label**：单 `label` 列存日文（产品主语言）。自定义项是用户输入文案，无需翻译；系统种子保留前端 i18n key 作 fallback。

### 3.2 `pm_task` 字段：保持 text、存 key（不改外键）

`roadmap_lane / milestone_color` 保持 `text`，继续存 option_key。`owner_party` 列**冻结**（迁移期保留只读以便回滚，稳定后下一次迁移物理删除）。

→ 优点：**零 data migration**，存量 key 与种子 key 一致；字典改名改色不影响任务；与本仓库「枚举字段皆裸 text、无 FK」惯例一致。删除/改 key 由应用层校验兜底。

## 4. API 设计

### 4.1 字典 CRUD —— 新增 `PmRoadmapOptionController`（`/app/pm/roadmap-options`，仿 PmMemberController）

| 方法 | 路径 | req | resp |
|------|------|-----|------|
| GET | `/app/pm/roadmap-options?kind=lane` | — | `R<List<PmRoadmapOptionVO>>` |
| POST | `/app/pm/roadmap-options` | `{kind, label, color, sortOrder?}`（key 后端生成）| `R<PmRoadmapOptionVO>` |
| PUT | `/app/pm/roadmap-options/{id}` | `{label?, color?, sortOrder?}` | `R<PmRoadmapOptionVO>` |
| DELETE | `/app/pm/roadmap-options/{id}` | — | `R<Void>`（系统项拒绝；被引用则拒绝或降级 default）|
| PUT | `/app/pm/roadmap-options/reorder` | `{kind, orderedIds[]}` | `R<Void>` |

`PmRoadmapOptionVO`：`id, kind, optionKey, label, color, sortOrder, isSystem`。自定义项 `option_key` 后端生成（`opt_` + 短 UUID 或 slug，租户内唯一）。

### 4.2 `getRoadmap` 携带字典定义（关键）

扩展 `PmRoadmapVO`，让前端不再写死 `LANE_ORDER`/颜色/label：

```java
public record PmRoadmapVO(
    String projectId, String projectStart, String projectEnd,
    List<RoadmapItem> items,
    RoadmapOptions options          // 新增
) {
    public record RoadmapOptions(List<OptionDef> lanes, List<OptionDef> msColors) {}
    public record OptionDef(String key, String label, String color, int sortOrder) {}
    // RoadmapItem 不变，继续透传 key（roadmapLane / milestoneColor；移除 ownerParty）
}
```

`PmTaskService.roadmap()`（L62-88）末尾查租户字典填入 `options`（按 kind 分组、sort_order 排序）。前端按 `options.lanes` 顺序渲染、`color` 着色、`label` 标签——彻底数据驱动。

## 5. 迁移策略（不破坏现有路线图）

### 5.1 种子（幂等，加入 init-pm.sql，pm_project 之后；对每个已有租户铺一份）

```sql
insert into pm_roadmap_option (id, tenant_id, kind, option_key, label, color, sort_order, is_system)
select gen_random_uuid(), t.id, v.kind, v.option_key, v.label, v.color, v.sort_order, true
from platform_tenant t
cross join (values
  ('lane','milestone','マイルストーン', null,      0),   -- 里程碑行，固定置顶；color 留空（菱形用 ms_color）
  ('lane','system',   'システム',       '#1677ff', 1),   -- 颜色取原 vendor 蓝（system 全是 vendor）
  ('lane','business', '業務',           '#52c41a', 2),   -- 颜色取原 client 绿（business 全是 client）
  ('ms_color','critical','重要',  '#f5222d', 0),
  ('ms_color','normal',  '通常',  '#8c8c8c', 1),
  ('ms_color','client',  '強調（緑）', '#52c41a', 2),    -- 保留旧 key（存量 milestone_color 命中），label 去業務语义
  ('ms_color','vendor',  '強調（青）', '#1677ff', 3)     -- 同上；key 仅内部用、永不展示
) as v(kind, option_key, label, color, sort_order)
where not exists (
  select 1 from pm_roadmap_option o
  where o.tenant_id = t.id and o.kind = v.kind
    and o.option_key = v.option_key and o.project_id is null
);
```

颜色/label 与现 `roadmap.css` L4-9 + i18n L569-580 对齐，存量视觉零变化。`pm_task` 老值（milestone/system/business、critical/normal/client/vendor）与种子 key 一致，**无需 data migration**；脏值/`client`/`vendor` 的里程碑色按 default 兜底渲染。

### 5.2 新租户 seed
靠 init-pm.sql 里这条跨租户幂等 SQL（每次启动对所有租户幂等补齐），不动 platform 侧租户创建流程。

## 6. 前端改造点（逐文件）

| 文件 | 改动 |
|------|------|
| `pm-web/src/pm/types.ts` | `RoadmapLane`/`MilestoneColor` 放宽为 `string`；删 `OwnerParty` 及 `Task.ownerParty`；新增 `RoadmapOptionDef`/`RoadmapOptions`；`PmRoadmapVO` 加 `options` |
| `pm-web/src/pm/api.ts` | `getRoadmap` 带回 options；新增 `listRoadmapOptions/create/update/delete/reorderRoadmapOptions` |
| `pm-web/src/pm/store.tsx` | 新增 `roadmapOptions` 状态 + 加载（与 members 同级），供表单/视图共享 |
| `pm-web/src/pm/roadmap/RoadmapView.tsx` | 删 `LANE_ORDER`（L29-34），分组按 `options.lanes` 顺序；`laneLabel` 查字典；Phase 着色改 inline `style.background=lane.color`（删 `rm-phase-client/vendor`）；Milestone 着色查 `options.msColors`；图例（L164-173）改为遍历 `options.lanes` 动态渲染 名称+色块；受控模式 Props 增 `options` 透传 |
| `pm-web/src/pm/roadmap/roadmap.css` | 移除写死颜色变量/类（`--rm-client/vendor`、`.rm-phase-client` 等），颜色改 inline 注入；保留布局/箭头/菱形形状 |
| `pm-web/src/pm/gantt/TaskFormModal.tsx` | 泳道 Select 改拉字典；**删除 ownerParty radio**；milestoneColor Select 改拉字典（中性命名） |
| 新增 `pm-web/src/pm/roadmap/RoadmapOptionManager.tsx` | 字典管理弹窗（lane / ms_color 两组：增删改 + 上下移排序 + ColorPicker），由 Gantt 页「スケジュール」标签的「レーン管理」按钮唤起（就地可改，不进設定页） |
| `src/locales/{ja-JP,en-US,zh-CN}/pages.ts` | 新增管理页文案；移除 `projects.roadmap.party.*`/`legend.client/vendor`/`taskForm.roadmap.ownerParty`；保留 `roadmap.lane.*`/`msColor.*` 作系统种子 fallback |

> 清理：全仓 grep `=== 'client'` / `=== 'vendor'` / `ownerParty` / `LANE_ORDER` 确保无残留。

## 7. 后端改造点（逐文件，pm 模块）

| 文件 | 改动 |
|------|------|
| 新增 `domain/PmRoadmapOption.java` | `@Table("pm_roadmap_option")`，字段对齐 DDL；`@Column tenantId` 仿 PmTask |
| 新增 `mapper/PmRoadmapOptionMapper.java` | `extends BaseMapper`，`@Mapper`。**@MapperScan 按 `ai.proyubi.pm.mapper` 包扫描，放对包即可，无需改 ProyubiApplication** |
| 新增 `service/PmRoadmapOptionService.java` | `list/create/update/delete/reorder`；insert 前 `setId(UUID.randomUUID())`；删除时系统项拒绝、自定义项检查 pm_task 引用；`loadForRoadmap(tenantId)` 给 roadmap() 复用 |
| 新增 `controller/PmRoadmapOptionController.java` | `@RequestMapping("/app/pm/roadmap-options")`，仿 PmMemberController |
| `vo/PmRoadmapVO.java` | 新增 `RoadmapOptions`/`OptionDef` 内嵌 record + `options` 字段；`RoadmapItem` 移除 `ownerParty` |
| `service/PmTaskService.java`（roadmap L62-88）| 注入 `PmRoadmapOptionService`，填 `options` |
| `domain/PmTask.java`（L80-87）| 更新字段注释（key 软引用语义）；`ownerParty` 字段保留只读、注 deprecated |
| `controller/PmTaskController.java` | CreateTaskReq/UpdateTaskReq 移除 `ownerParty`（或保留只读忽略）；可选 service 校验 key 归属租户 |
| `schema/init-pm.sql` + `server/proyubi-server/src/main/resources/db/schema/init-pm.sql` | 追加建表 + 索引 + 幂等跨租户种子；**两份副本同步** |

## 8. 风险与回滚

- **种子颜色/label 必须与现 css/i18n 对齐**，否则存量视觉变样——上线人工核对一屏。
- 前端字面量类型放宽为 string，需全量 grep 清理 `=== 'client'`/`ownerParty`/`LANE_ORDER` 等比较点。
- 删除被引用的自定义项 → default 兜底渲染 + 删除前校验双保险。
- **回滚低风险**：option 表纯增量，不影响 pm_task（key 仍是旧枚举值）；前端可回退到写死版本，DB 无需回滚。`owner_party` 列冷却期内保留只读，确认稳定后下一次迁移再删。

## 9. 工作量与实施顺序（约 6–7 人天）

| 阶段 | 内容 | 量 |
|------|------|----|
| **① 后端打底** | 建表 + 幂等种子（doc + resources 副本）→ 实体/mapper/service/controller → 扩展 PmRoadmapVO + 改 roadmap()。旧前端仍正常（多返字段不影响） | M ≈ 2d |
| **② 前端数据驱动** | types/api/store 接 options → RoadmapView 去 LANE_ORDER/写死色 → css 瘦身 → TaskFormModal 拉接口、删 ownerParty radio。功能等价但已数据驱动 | M ≈ 2d |
| **③ 管理 UI** | スケジュール标签「レーン管理」弹窗（增删改 + 上下移 + ColorPicker）+ 四语言 i18n。用户开始能真正自定义 | M ≈ 1.5–2d |
| **④ 联调** | 对齐存量视觉、清理字面量类型、三语言 | S ≈ 1d |

①②为契约耦合需连续上线；③可独立后补。

## 10. 范围与分期

- **MVP（本次，已实现）**：§1–§9 全部（泳道字典租户级 + 颜色并入泳道 + 废弃 ownerParty + 里程碑色去語义 + 数据驱动渲染 + スケジュール内嵌管理弹窗 + 迁移种子 + 四语言 i18n）。
- **Phase 2（按需）**：项目级追加/覆盖泳道（表已预留 project_id）；泳道名多语言；隐藏空泳道。
- **Phase 3（待真实需求）**：正交于泳道的「自定义标签」维度（若将来确需独立于泳道的「谁来做/哪个外包商」标注）。

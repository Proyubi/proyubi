-- ============================================================================
-- PM（项目管理 / 甘特图）业务数据库初始化脚本（PostgreSQL / Supabase）
-- ============================================================================
-- 说明：
-- - 本文件包含 Proyubi 项目管理模块的全部业务表结构
-- - 所有表名使用 pm_ 前缀
-- - 外键引用到 platform_tenant（租户隔离）
-- - 主键：uuid（应用层用 UUID.randomUUID() 显式赋值；DB 默认 gen_random_uuid() 兜底）
-- - 时间：timestamptz，默认 now()；业务日期（甘特起止）用 date
-- - 软删除：deleted_at（null=未删）
-- - 执行建议：在 Supabase SQL Editor 中直接执行本文件
-- - 注意：必须先执行 init-platform.sql 创建平台级表
-- - 领域层级：pm_customer(客户/产品) → pm_project(版本) → pm_task(WBS 树) → 指派 pm_member
--             任务之间通过 pm_dependency 形成依赖（首版仅 FS：前序完成→后续开始）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 团队成员表（甘特图按人着色 / 任务指派对象）
-- ----------------------------------------------------------------------------

create table if not exists pm_member (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  user_id uuid references platform_tenant_user(id),
  name text not null,
  color text,
  role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 已建库增量：补 user_id（PM 成员绑定到租户用户，账户与 WMS 共用 ops）
alter table pm_member
  add column if not exists user_id uuid references platform_tenant_user(id);

create index if not exists ix_pm_member_tenant_id
  on pm_member (tenant_id, deleted_at);

-- 一个租户用户在同一租户内至多一条有效 PM 档案
create unique index if not exists ux_pm_member_tenant_user
  on pm_member (tenant_id, user_id)
  where user_id is not null and deleted_at is null;

comment on table pm_member is 'PM 团队成员表';
comment on column pm_member.user_id is '绑定的租户用户（platform_tenant_user.id）；null=未绑定的 legacy/外部成员';
comment on column pm_member.name is '成员姓名（默认取租户用户 display_name，可覆盖为甘特显示名）';
comment on column pm_member.color is '头像底色，同时用于甘特图按人着色';
comment on column pm_member.role is '角色（PM / 开发 / 测试 等）';

-- ----------------------------------------------------------------------------
-- 2. 客户/产品表
-- ----------------------------------------------------------------------------

create table if not exists pm_customer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  name text not null,
  short_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_customer_tenant_id
  on pm_customer (tenant_id, deleted_at);

-- 多团队：客户归属团队（references platform_team；存量回填见 migrations/2026-06-10-multi-team.sql）
alter table pm_customer
  add column if not exists team_id uuid references platform_team(id);
create index if not exists ix_pm_customer_team
  on pm_customer (team_id, deleted_at);

-- 有効/無効：無効化した顧客は既定で非活性（アーカイブ）扱い。存量は有効
alter table pm_customer
  add column if not exists active boolean not null default true;

comment on table pm_customer is 'PM 客户/产品表（例：ACME）';
comment on column pm_customer.active is '有効/無効（無効=アーカイブ扱い、既定 true）';
comment on column pm_customer.team_id is '归属团队（platform_team.id）；多团队隔离维度，存量回填为默认团队';
comment on column pm_customer.name is '客户名';
comment on column pm_customer.short_name is '简称';

-- ----------------------------------------------------------------------------
-- 3. 项目/版本表
-- ----------------------------------------------------------------------------

create table if not exists pm_project (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  customer_id uuid not null references pm_customer(id),
  -- サブプロジェクトの親（1 階層のみ；null=トップレベル）。见 migrations/2026-11-17-pm-project-parent.sql
  parent_id uuid references pm_project(id),
  name text not null,
  description text,
  status text not null default 'planned',
  -- kind='ops'（運用・保守）は終了日未定＝継続中を許すため end_date は nullable。
  -- kind='project'（通常）の必須チェックはアプリ層（PmProjectService）で担保。
  kind text not null default 'project',
  -- 月次工数枠（分）：保守契約の「月◯人日まで」。null=枠なし
  monthly_quota_minutes int,
  start_date date not null,
  end_date date,
  progress int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 已建库增量：补 sort_order（同客户内手动拖动排序序号）
alter table pm_project
  add column if not exists sort_order int not null default 0;

-- 已建库增量：补 kind（运维型项目）+ 放开 end_date（见 migrations/2026-08-25-pm-project-kind-ops.sql）
alter table pm_project
  add column if not exists kind text not null default 'project';
alter table pm_project
  alter column end_date drop not null;
alter table pm_project
  add column if not exists monthly_quota_minutes int;
create index if not exists ix_pm_project_kind
  on pm_project (tenant_id, kind)
  where deleted_at is null;

create index if not exists ix_pm_project_tenant_id
  on pm_project (tenant_id, deleted_at);

create index if not exists ix_pm_project_customer_id
  on pm_project (customer_id)
  where deleted_at is null;

-- 多团队：项目归属团队（隔离主维度；task/dependency 经 project_id 继承。回填见 migrations/2026-06-10-multi-team.sql）
alter table pm_project
  add column if not exists team_id uuid references platform_team(id);
create index if not exists ix_pm_project_team
  on pm_project (team_id, deleted_at);

-- 已建库增量：サブプロジェクトの親（见 migrations/2026-11-17-pm-project-parent.sql）
alter table pm_project
  add column if not exists parent_id uuid references pm_project(id);
create index if not exists ix_pm_project_parent
  on pm_project (tenant_id, parent_id)
  where deleted_at is null;

comment on table pm_project is 'PM 项目/版本表（例：v1.4.0）';
comment on column pm_project.parent_id is '親プロジェクト（pm_project.id）；null=トップレベル。1 階層のみ（親は parent_id is null）';
comment on column pm_project.team_id is '归属团队（platform_team.id）；多团队隔离主维度，存量回填为默认团队';
comment on column pm_project.status is '状态：planned/active/done/paused';
comment on column pm_project.progress is '0-100，由任务汇总缓存一份，避免每次重算';
comment on column pm_project.sort_order is '同客户内手动拖动排序序号（升序，越小越靠前）';

-- ----------------------------------------------------------------------------
-- 4. 任务表（WBS 树）
-- ----------------------------------------------------------------------------

create table if not exists pm_task (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  project_id uuid not null references pm_project(id),
  parent_id uuid references pm_task(id),
  name text not null,
  -- 纯日期模型：计划/实际起止为日历日（date，闭区间含尾日）
  start_date date not null,
  end_date date not null,
  actual_start date,
  actual_end date,
  -- 工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天）。工期=工作日天数 D + 本列
  -- 予定（配合 start/end）与実績（配合 actual_start/actual_end）各自一份
  planned_effort_hours numeric(4,2),
  actual_effort_hours numeric(4,2),
  progress int not null default 0,
  assignee_ids text[],
  levels text[],
  description text,
  type text not null default 'task',
  collapsed boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_task_project_id
  on pm_task (project_id, deleted_at);

-- 俯瞰 / 日历 / 负载等按 tenant_id 全租户捞（不带 project_id），需 tenant 前缀索引
create index if not exists ix_pm_task_tenant
  on pm_task (tenant_id)
  where deleted_at is null;

create index if not exists ix_pm_task_parent_id
  on pm_task (parent_id)
  where deleted_at is null;

comment on table pm_task is 'PM 任务表（WBS 树，parent_id 为 null 即根任务）';
comment on column pm_task.type is '类型：task/summary/milestone（milestone 时 start=end，同一天）';
comment on column pm_task.start_date is '计划开始日（date，闭区间）';
comment on column pm_task.end_date is '计划结束日（date，闭区间含尾日）';
comment on column pm_task.actual_start is '实际开始日（date，可空）';
comment on column pm_task.actual_end is '实际结束日（date，可空）';
comment on column pm_task.planned_effort_hours is '予定工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天，配合 start/end）。工期=工作日天数 D + 本列：H>0 时=(D−1)天+H小时';
comment on column pm_task.actual_effort_hours is '実績工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天，配合 actual_start/actual_end）';
comment on column pm_task.progress is '0-100：叶子为权威值；summary 由子节点按工期（分钟）加权汇总';
comment on column pm_task.assignee_ids is '指派成员 id 数组（首版"一天一项目"，指派直接挂叶子任务）';
comment on column pm_task.collapsed is '是否折叠子节点（仅 summary 有意义）';
comment on column pm_task.sort_order is '同级排序';

-- 已建库增量：路线图（roadmap）展示字段（仅 summary/milestone 有意义）
alter table pm_task
  add column if not exists roadmap_visible boolean not null default false;
alter table pm_task
  add column if not exists roadmap_lane text;
alter table pm_task
  add column if not exists owner_party text;
alter table pm_task
  add column if not exists milestone_color text;

create index if not exists ix_pm_task_roadmap
  on pm_task (project_id, roadmap_visible)
  where deleted_at is null and roadmap_visible = true;

comment on column pm_task.roadmap_visible is '是否在路线图展示（仅 summary/milestone 有意义）';
comment on column pm_task.roadmap_lane is '路线图泳道：milestone/system/business（null=默认）';
comment on column pm_task.owner_party is '责任方：client=貴社 / vendor=弊社（null=不区分）';
comment on column pm_task.milestone_color is '里程碑语义色：critical/normal/client/vendor（仅 milestone 用）';

-- 已建库增量：看板（Board）业务状态。独立于 progress：backlog/todo/in_progress/testing/done/cancelled
-- 注：init 在启动时会反复执行，这里只做幂等的列追加；既有数据的一次性回填见
--     doc/schema/migrations/2026-06-02-pm-task-status.sql（手动执行一次）。
alter table pm_task
  add column if not exists status text not null default 'todo';

create index if not exists ix_pm_task_status
  on pm_task (project_id, status)
  where deleted_at is null;

-- 已建库增量：工期·最終日の作業時間（纯日期模型下的手填小时，0–23.75，可小数 0.25 刻み），予定/実績各一份。
-- 既存库 timestamptz→date 的类型回退见 migrations/2026-06-10-pm-task-date-effort.sql（手动执行一次）；
-- 旧 effort_hours 拆分为 planned/actual 的回填+删列见 migrations/2026-06-11-pm-task-plan-actual-effort.sql；
-- smallint→numeric(4,2)（支持小数小时）的既存库类型变更见 migrations/2026-07-07-pm-task-effort-hours-decimal.sql。
alter table pm_task
  add column if not exists planned_effort_hours numeric(4,2);
alter table pm_task
  add column if not exists actual_effort_hours numeric(4,2);

-- 已建库增量：工期解耦——独立「工期日数」两列（配合既有 *_effort_hours 组成手动 d/h）。
-- 口径恒 1営業日=24h：effort = days*24h + hours*60min。null=回退期间派生(effortMinutes)，旧行不回填→行为零变化、向后兼容。
-- 同步 migration：migrations/2026-06-22-pm-task-effort-days.sql（与 deploy/db.sh init 顺序一致）。
alter table pm_task
  add column if not exists planned_effort_days smallint;
alter table pm_task
  add column if not exists actual_effort_days  smallint;
comment on column pm_task.planned_effort_days is '予定工期·日数（手动，1d=24h 日历日；NULL=回退期间派生 effortMinutes）。工期=days*24h+planned_effort_hours*60min';
comment on column pm_task.actual_effort_days  is '実績工期·日数（手动，1d=24h；NULL=回退期间派生）。配合 actual_effort_hours，両端齐全才参与';

comment on column pm_task.status is '看板业务状态：backlog/todo/in_progress/testing/done/cancelled（独立于 progress）';

-- ----------------------------------------------------------------------------
-- 4.5 路线图可自定义字典表（泳道 / 里程碑色）
-- ----------------------------------------------------------------------------
-- 把原先写死在前端的「泳道(lane)」「里程碑色(ms_color)」改为租户可自定义。
-- pm_task.roadmap_lane / milestone_color 继续存 option_key（保留旧枚举值，零数据迁移）。
-- 原「作業区分(owner_party 貴社/弊社)」维度已废弃：颜色并入泳道（lane.color）。
-- project_id 预留项目级覆盖（首版只写 null=租户级全局）。

create table if not exists pm_roadmap_option (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  project_id uuid references pm_project(id),
  kind text not null,
  option_key text not null,
  label text not null,
  color text,
  sort_order int not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_roadmap_option_lookup
  on pm_roadmap_option (tenant_id, kind, deleted_at);

-- 租户级全局项内：同 kind 下 option_key 唯一
create unique index if not exists ux_pm_roadmap_option_key
  on pm_roadmap_option (tenant_id, kind, option_key)
  where project_id is null and deleted_at is null;

comment on table pm_roadmap_option is 'PM 路线图可自定义字典：lane=泳道 / ms_color=里程碑色（租户级，project_id 预留项目级覆盖）';
comment on column pm_roadmap_option.kind is 'lane=泳道 / ms_color=里程碑色';
comment on column pm_roadmap_option.option_key is '稳定 key，pm_task.roadmap_lane / milestone_color 引用此值；系统种子沿用旧枚举值';
comment on column pm_roadmap_option.color is '泳道阶段条颜色 / 里程碑菱形颜色（#RRGGBB）；milestone 泳道可空';
comment on column pm_roadmap_option.is_system is '系统内置项（不可删，可改色/名/排序）';

-- 幂等种子：为每个已有租户铺一份系统默认字典（颜色/标签与原前端写死一致，保证存量路线图视觉零变化）。
-- lane: milestone 置顶固定；system/business 颜色取原 vendor 蓝 / client 绿（数据证明 system 全 vendor、business 全 client）。
-- ms_color: 保留旧 key（critical/normal/client/vendor，存量 milestone_color 仍命中），label 去業務语义。
insert into pm_roadmap_option (id, tenant_id, kind, option_key, label, color, sort_order, is_system)
select gen_random_uuid(), t.id, v.kind, v.option_key, v.label, v.color, v.sort_order, true
from platform_tenant t
cross join (values
  ('lane',     'milestone', 'マイルストーン', cast(null as text), 0),
  ('lane',     'system',    'システム',       '#1677ff',          1),
  ('lane',     'business',  '業務',           '#52c41a',          2),
  ('ms_color', 'critical',  '重要（赤）',     '#f5222d',          0),
  ('ms_color', 'normal',    '通常（グレー）', '#8c8c8c',          1),
  ('ms_color', 'client',    '強調（緑）',     '#52c41a',          2),
  ('ms_color', 'vendor',    '強調（青）',     '#1677ff',          3)
) as v(kind, option_key, label, color, sort_order)
where not exists (
  select 1 from pm_roadmap_option o
  where o.tenant_id = t.id and o.kind = v.kind
    and o.option_key = v.option_key and o.project_id is null
);

-- ----------------------------------------------------------------------------
-- 5. 任务依赖表（首版仅 Finish-to-Start）
-- ----------------------------------------------------------------------------

create table if not exists pm_dependency (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  project_id uuid not null references pm_project(id),
  predecessor_id uuid not null references pm_task(id),
  successor_id uuid not null references pm_task(id),
  type text not null default 'FS',
  lag int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_dependency_project_id
  on pm_dependency (project_id, deleted_at);

-- 俯瞰按 tenant_id 全租户捞依赖（不带 project_id），需 tenant 前缀索引
create index if not exists ix_pm_dependency_tenant
  on pm_dependency (tenant_id)
  where deleted_at is null;

create index if not exists ix_pm_dependency_succ
  on pm_dependency (successor_id)
  where deleted_at is null;

comment on table pm_dependency is 'PM 任务依赖表';
comment on column pm_dependency.predecessor_id is '前序任务';
comment on column pm_dependency.successor_id is '后续任务';
comment on column pm_dependency.type is '依赖类型（首版仅 FS）';
comment on column pm_dependency.lag is '延迟天数，可选';

-- ----------------------------------------------------------------------------
-- 6. 思维导图表（独立文档；对标 ProcessOn 思维导图）
-- ----------------------------------------------------------------------------
-- 一张导图 = 一行；整棵节点树存 content(jsonb)，形如 {"root": {id,text,children:[...]}}。
-- v1 不做实时协同：保存采用 version 乐观锁（PUT 带 version，库内不一致 → 409）。
-- project_id 可空：仅作归类/跳转线索，不强绑定 pm_task。

create table if not exists pm_mindmap (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  project_id uuid references pm_project(id),
  name text not null,
  theme text not null default 'classic',
  content jsonb not null default '{"root":{"id":"root","text":"中心主题","children":[]}}'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_mindmap_tenant_id
  on pm_mindmap (tenant_id, deleted_at);

create index if not exists ix_pm_mindmap_project_id
  on pm_mindmap (project_id)
  where deleted_at is null;

comment on table pm_mindmap is 'PM 思维导图（独立文档；节点树存 content jsonb）';
comment on column pm_mindmap.project_id is '可选关联项目（仅归类/跳转线索；可空）';
comment on column pm_mindmap.theme is '主题 key：classic/dark/forest…（默认 classic）';
comment on column pm_mindmap.content is '节点树 JSON：{"root": MindNode}；前端整读整写';
comment on column pm_mindmap.version is '乐观锁版本，每次内容保存 +1';

-- ----------------------------------------------------------------------------
-- 7. 节假日表（红日子 / 祝日）—— 工期按工作日计算时排除周末 + 这些日期
-- ----------------------------------------------------------------------------
-- 租户级（跨项目共享一套日历）。national/振替/国民の休日 由 holidays-jp 定时同步，
-- source=holidays_jp/cabinet/manual；is_manual=true 的行为人工维护，定时同步永不覆盖。
-- 首版仅日本（region 默认 'JP'，预留多区域）。工作日 = 非周六周日 且 不在本表内。

create table if not exists pm_holiday (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  holiday_date date not null,
  name text not null,
  region text not null default 'JP',
  source text not null default 'holidays_jp',
  is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_holiday_lookup
  on pm_holiday (tenant_id, region, holiday_date)
  where deleted_at is null;

-- 同租户同区域内一个日期至多一条有效记录（upsert/同步的冲突目标）
create unique index if not exists ux_pm_holiday_date
  on pm_holiday (tenant_id, region, holiday_date)
  where deleted_at is null;

comment on table pm_holiday is 'PM 节假日（红日子/祝日）：工期按工作日计算时排除；租户级跨项目共享';
comment on column pm_holiday.holiday_date is '节假日日期（含振替休日/国民の休日各占一行）';
comment on column pm_holiday.region is '区域：首版仅 JP（预留多区域）';
comment on column pm_holiday.source is '来源：holidays_jp（默认同步源）/ cabinet（内閣府 CSV 对账）/ manual（人工）';
comment on column pm_holiday.is_manual is 'true=人工维护，定时同步不覆盖/不删除';

-- ----------------------------------------------------------------------------
-- 9. 任务评论表（任务级留言/讨论流）
-- ----------------------------------------------------------------------------
-- 一条评论挂在某个 pm_task 上。发帖人解析自当前登录用户 → pm_member（取头像色/显示名），
-- author_user_id 为编辑/删除鉴权的权威字段；author_name 为发帖时定格的显示名快照。

create table if not exists pm_comment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  task_id uuid not null references pm_task(id),
  author_user_id uuid not null,
  author_member_id uuid references pm_member(id),
  author_name text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_comment_task
  on pm_comment (task_id, deleted_at);

comment on table pm_comment is 'PM 任务评论（任务级留言/讨论流）';
comment on column pm_comment.author_user_id is '发帖人租户用户 id（platform_tenant_user.id）；编辑/删除鉴权权威字段';
comment on column pm_comment.author_member_id is '发帖人 PM 成员 id（头像底色用）；未绑定成员时为 null';
comment on column pm_comment.author_name is '发帖人显示名快照（发帖时定格，成员改名/删除后仍正确展示）';

-- ----------------------------------------------------------------------------
-- pm_task_link：任务级关联链接（设计稿/外部链接，首版主打 Figma 内联预览）
-- kind=figma 时前端用 iframe 内联预览；其余仅渲染为可点链接卡片。
-- created_by 仅作审计；删除为任意本租户成员可操作（共享上下文，非个人留言）。
-- ----------------------------------------------------------------------------

create table if not exists pm_task_link (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  task_id uuid not null references pm_task(id),
  kind text not null default 'figma',
  url text not null,
  title text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_task_link_task
  on pm_task_link (task_id, deleted_at);

comment on table pm_task_link is 'PM 任务关联链接（任务级设计稿/外部链接；kind=figma 时前端 iframe 内联预览）';
comment on column pm_task_link.kind is '链接种别：figma（内联预览）/ link（普通外链）/ image（图片）；后端按 url 域名判定';
comment on column pm_task_link.url is '链接 URL（http/https）';
comment on column pm_task_link.title is '用户备注名（可空；空则前端显示域名）';
comment on column pm_task_link.created_by is '添加人租户用户 id（platform_tenant_user.id）；用于审计';

-- ----------------------------------------------------------------------------
-- 10. 事件/会议日程表 pm_event
-- 独立于 pm_task：事件不进 WBS 树 / TaskRollupService / 进度汇总。
-- project_id null = 全局事件（本租户全员可见）；非空走团队可见性过滤。
-- task_id 仅作跳转线索；attendee_ids 复用 PostgreSqlStringArrayTypeHandler。
-- ----------------------------------------------------------------------------

create table if not exists pm_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform_tenant(id),
  project_id uuid references pm_project(id),
  task_id uuid references pm_task(id),
  title text not null,
  type text not null default 'meeting',
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  attendee_ids text[],
  location text,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ix_pm_event_tenant_range
  on pm_event (tenant_id, start_at) where deleted_at is null;
create index if not exists ix_pm_event_project
  on pm_event (project_id) where deleted_at is null;
create index if not exists ix_pm_event_task
  on pm_event (task_id) where deleted_at is null;

comment on table pm_event is 'PM 事件/会议日程（独立于 pm_task，不进 WBS/rollup；嵌入 /calendar 月历按类型色展示）';
comment on column pm_event.project_id is '可挂项目（团队可见性维度）；null=全局事件，本租户全员可见';
comment on column pm_event.task_id is '可选关联任务（仅跳转线索，不参与任何 rollup）';
comment on column pm_event.type is '事件种别：meeting / review / milestone / deadline / other';
comment on column pm_event.start_at is '开始时刻（all_day=true 时取当天 00:00 起）';
comment on column pm_event.end_at is '结束时刻（可空，单点事件）';
comment on column pm_event.attendee_ids is '参加者 pm_member id 字符串数组（复用 PostgreSqlStringArrayTypeHandler）';
comment on column pm_event.created_by is '创建人租户用户 id（platform_tenant_user.id）；审计用，删除不限本人';

-- ============================================================
-- pm_mcp_token — PM の MCP 个人连接令牌（每用户一条有效）
-- 用户在「設定 → MCP設定」页拿到 https://<base>/t/<token>/mcp；pm-mcp 服务端凭 token 反查 tenant。
-- ============================================================
create table if not exists pm_mcp_token (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references platform_tenant(id),
  user_id      uuid not null references platform_tenant_user(id),
  token        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_used_at timestamptz,
  deleted_at   timestamptz
);

-- token 全局唯一（未删）：pm-mcp 按 token 反查 tenant 的关键索引
create unique index if not exists ux_pm_mcp_token_token
  on pm_mcp_token (token) where deleted_at is null;
-- 每个 (tenant, user) 只有一条有效令牌
create unique index if not exists ux_pm_mcp_token_tenant_user
  on pm_mcp_token (tenant_id, user_id) where deleted_at is null;

comment on table pm_mcp_token is 'PM MCP 个人连接令牌（每租户用户一条有效；重置=软删旧的再建新）';
comment on column pm_mcp_token.token is 'URL 内嵌的随机令牌（SecureRandom 24字节 hex）；泄露即软删重发';
comment on column pm_mcp_token.user_id is '租户用户 id（platform_tenant_user.id）= TenantContext.getUserId()';

-- ----------------------------------------------------------------------------
-- 12. PM 租户级设置（工数换算等，单行 / 租户）
-- ----------------------------------------------------------------------------
-- 租户级单行配置。目前含 hours_per_workday = 1営業日=何時間（工期 ↔ 時間の換算単位）。
-- 既定 8（未设置行时由代码层用默认值）；7.5 等小数可。
-- 只改变「日 ↔ 時間」的换算解释，不改动既存 pm_task 的 days/hours 存储数据。

create table if not exists pm_setting (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references platform_tenant(id),
  hours_per_workday numeric(4,2) not null default 8,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 每租户至多一行（upsert 目标）
create unique index if not exists ux_pm_setting_tenant on pm_setting (tenant_id);

comment on table pm_setting is 'PM 租户级设置（单行/租户）：目前含 hours_per_workday（1営業日の時間数）';
comment on column pm_setting.hours_per_workday is '1営業日=何時間（工期↔時間の換算単位）。既定8、7.5等の小数可。仅改换算解释，不动任务数据';

-- ============================================================================
-- 品質管理（Quality Management）業務テーブル — テストケース + バグ管理
-- ----------------------------------------------------------------------------
-- 領域：pm_customer(顧客/製品) 配下に pm_test_suite(スイート/シート) → pm_test_case(ケース/行)。
-- pm_bug はバグ票（失敗ケース起票 or 単独起票）。スイートは task_id で pm_task へ任意紐付け可能（ケースは紐付けを持たない）。
-- 可視性・チームは customer 経由で継承（本3テーブルは team_id を持たない＝pm_task と同一慣習）。
-- 採番：seq はスイート内(ケース)/顧客内(バグ)で欠番非再利用。case_no/bug_no は seq から materialize。
--   ⇒ 採番ガードの unique index は敢えて NON-partial（where deleted_at is null を付けない）。
--      「番号を再利用しない（単調増加）」を優先するための、本ファイルの partial-unique 慣習からの意図的逸脱。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 13. テストスイート pm_test_suite（= Excel の1シート）
-- ----------------------------------------------------------------------------
create table if not exists pm_test_suite (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references platform_tenant(id),
  customer_id uuid not null references pm_customer(id),
  task_id     uuid references pm_task(id),
  case_prefix text,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists ix_pm_test_suite_customer
  on pm_test_suite (customer_id, deleted_at) where deleted_at is null;
create index if not exists ix_pm_test_suite_task
  on pm_test_suite (task_id) where task_id is not null;
create index if not exists ix_pm_test_suite_tenant
  on pm_test_suite (tenant_id);

comment on table pm_test_suite is '品質管理：テストスイート（= Excel の1シート/大分類、例 01-学生管理）。pm_customer(製品) 配下、可視性は customer 継承';
comment on column pm_test_suite.customer_id is '所属顧客/製品（pm_customer.id）；可視性・team はこの customer から継承（本表は team_id 列を持たない）';
comment on column pm_test_suite.task_id is 'スイート⇄タスク任意紐付け（pm_task.id；null=未紐付け）。版本を跨ぐスイートを特定タスクへ関連付け';
comment on column pm_test_suite.case_prefix is '採番接頭辞（大機能コード、例 STU/MST）。case_no = prefix + ''-'' + lpad(seq,3)';

-- ----------------------------------------------------------------------------
-- 14. テストケース pm_test_case（= Excel の1行、latest-result-on-row）
-- ----------------------------------------------------------------------------
create table if not exists pm_test_case (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references platform_tenant(id),
  customer_id      uuid not null references pm_customer(id),
  suite_id         uuid not null references pm_test_suite(id),
  seq              int not null,
  case_no          text not null,
  feature_major    text,
  feature_minor    text,
  title            text not null,
  category         text not null default 'normal',
  priority         text not null default 'medium',
  precondition     text,
  steps            text,
  test_data        text,
  expected         text,
  result           text,
  executed_at      timestamptz,
  executed_by      uuid,
  executed_by_name text,
  remark           text,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- 採番ガード：スイート内で seq 一意（NON-partial ＝ 削除済みも含め番号を再利用しない）
create unique index if not exists ux_pm_test_case_seq
  on pm_test_case (tenant_id, suite_id, seq);
create index if not exists ix_pm_test_case_suite
  on pm_test_case (suite_id, deleted_at);
create index if not exists ix_pm_test_case_customer
  on pm_test_case (customer_id, deleted_at);
create index if not exists ix_pm_test_case_result
  on pm_test_case (customer_id, result);

comment on table pm_test_case is '品質管理：テストケース（= Excel の1行）。仕様フィールド + 最新実施結果を行に保持（実行履歴子表は持たない）。タスク紐付けはスイート単位（本表は task_id を持たない）';
comment on column pm_test_case.customer_id is '所属顧客/製品（pm_customer.id）；suite から非正規化コピー。一覧フィルタ/可視性を単表で完結';
comment on column pm_test_case.category is '区分：normal(正常系) / abnormal(異常系) / boundary(境界値)';
comment on column pm_test_case.priority is '優先度：high(高) / medium(中) / low(低)';
comment on column pm_test_case.result is '実施結果：null=未実施 / pass=OK / fail=NG / na=対象外';
comment on index ux_pm_test_case_seq is 'スイート内 seq 採番ガード。NON-partial は意図的（番号の欠番非再利用＝単調増加のため）';

-- ----------------------------------------------------------------------------
-- 14b. 環境マスタ pm_environment（バグ票の動作環境；pm_customer 配下）
-- ----------------------------------------------------------------------------
create table if not exists pm_environment (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references platform_tenant(id),
  customer_id uuid not null references pm_customer(id),
  name        text not null,
  browser     text,
  url         text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists ix_pm_environment_customer
  on pm_environment (customer_id, deleted_at) where deleted_at is null;
create index if not exists ix_pm_environment_tenant
  on pm_environment (tenant_id);

comment on table pm_environment is '品質管理：環境マスタ（バグ票の動作環境）。pm_customer(製品) 配下、可視性は customer 継承（本表は team_id 列を持たない）';
comment on column pm_environment.name is '区分ラベル（例：dev / staging / prod）。表示合成の先頭';
comment on column pm_environment.browser is '端末/ブラウザ（例：Chrome / iOS Safari）。任意';
comment on column pm_environment.url is '対象URL（例：https://dev.example.com）。任意';
comment on column pm_environment.sort_order is '表示順（昇順）';

-- ----------------------------------------------------------------------------
-- 15. バグ票 pm_bug
-- ----------------------------------------------------------------------------
create table if not exists pm_bug (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references platform_tenant(id),
  customer_id        uuid not null references pm_customer(id),
  seq                int not null,
  bug_no             text not null,
  title              text not null,
  description        text,
  severity           text not null default 'medium',
  priority           text not null default 'medium',
  status             text not null default 'open',
  reopen_count       int not null default 0,
  environment        text,
  environment_id     uuid references pm_environment(id),
  assignee_member_id uuid references pm_member(id),
  assignee_name      text,
  reporter_user_id   uuid not null,
  reporter_name      text,
  project_id         uuid references pm_project(id),
  task_id            uuid references pm_task(id),
  test_case_id       uuid references pm_test_case(id),
  reported_on        date,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- 既存DB向け後方互換：environment_id 列を後追い追加（冪等）
alter table pm_bug
  add column if not exists environment_id uuid references pm_environment(id);
comment on column pm_bug.environment_id is '環境マスタ参照（pm_environment.id；null=未選択 or 旧・自由入力）。environment(text) は表示スナップショット';

-- 採番ガード：顧客内で seq 一意（NON-partial ＝ 番号を再利用しない）
create unique index if not exists ux_pm_bug_seq
  on pm_bug (tenant_id, customer_id, seq);
create index if not exists ix_pm_bug_customer
  on pm_bug (customer_id, deleted_at);
create index if not exists ix_pm_bug_task
  on pm_bug (task_id, deleted_at);
create index if not exists ix_pm_bug_project
  on pm_bug (project_id, deleted_at) where project_id is not null;
create index if not exists ix_pm_bug_case
  on pm_bug (test_case_id, deleted_at);
create index if not exists ix_pm_bug_status
  on pm_bug (customer_id, status);

comment on table pm_bug is '品質管理：バグ票（失敗ケース起票 or 単独起票）。pm_customer(製品) 配下、task_id でタスク、test_case_id で発生ケースへ双方向トレース';
comment on column pm_bug.severity is '影響度：high(高) / medium(中) / low(低)';
comment on column pm_bug.priority is '優先度：high(高) / medium(中) / low(低)（severity と独立軸）';
comment on column pm_bug.status is '状態：open(未対応)/in_progress(対応中)/resolved(修正済)/verifying(確認中)/closed(完了)/wontfix(対応せず)';
comment on column pm_bug.reopen_count is '再オープン回数（closed系→in_progress アクションで +1；churn 可視化）';
comment on index ux_pm_bug_seq is '顧客内 seq 採番ガード。NON-partial は意図的（番号の欠番非再利用のため）';

-- ----------------------------------------------------------------------------
-- 16. タスク操作履歴 pm_task_activity（append-only）
-- ----------------------------------------------------------------------------
-- 1回の保存＝1行。同時に変わった複数フィールドは changes(jsonb) の配列に畳み込む
-- （「保存した回数」と履歴の件数を一致させるため）。追記専用なので deleted_at は持たない。
create table if not exists pm_task_activity (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references platform_tenant(id),
  task_id          uuid not null references pm_task(id),
  project_id       uuid references pm_project(id),
  actor_user_id    uuid,
  actor_member_id  uuid references pm_member(id),
  actor_name       text not null,
  action           text not null,
  changes          jsonb not null default '[]'::jsonb,
  source           text not null default 'web',
  created_at       timestamptz not null default now()
);

create index if not exists ix_pm_task_activity_task
  on pm_task_activity (task_id, created_at desc);
create index if not exists ix_pm_task_activity_tenant
  on pm_task_activity (tenant_id, created_at desc);

comment on table pm_task_activity is 'PM タスク操作履歴（追記専用）。1回の保存＝1行、変更フィールドは changes に畳み込む。コメント本文/バグ詳細/ケース結果は各タブが一次情報を持つため記録しない';
comment on column pm_task_activity.actor_user_id is '操作者の租户ユーザ id（platform_tenant_user.id）；内部(MCP)経由で不明なら null';
comment on column pm_task_activity.actor_member_id is '操作者の PM メンバー id（アバター色用）；未紐付けなら null';
comment on column pm_task_activity.actor_name is '操作者表示名スナップショット（メンバー改名/削除後も履歴が読めるよう記録時に定格）';
comment on column pm_task_activity.action is 'created(作成) / updated(フィールド変更) / child_added(サブタスク追加) / child_removed(サブタスク削除) / dep_added(依存追加) / dep_removed(依存削除)';
comment on column pm_task_activity.changes is '差分配列 [{field, from, to, added[], removed[]}]。from/to は表示用文字列スナップショット';
comment on column pm_task_activity.source is '操作元：web(画面) / mcp(内部API・自動連携)';

-- ----------------------------------------------------------------------------
-- 17. 資料 pm_doc / 資料↔タスク pm_doc_task（外部ネットドライブ連携 第一歩）
-- ----------------------------------------------------------------------------
-- リンク + 紐付けのみ保持（ファイル本体・権限はドライブ側）。provider/kind/external_id は
-- サーバ側で URL から判定。設計：doc/design/pm-drive-docs.md
create table if not exists pm_doc (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references platform_tenant(id),
  customer_id      uuid not null references pm_customer(id),
  project_id       uuid references pm_project(id),
  is_root          boolean not null default false,
  url              text not null,
  provider         text not null,
  kind             text not null,
  external_id      text,
  title            text,
  mime_type        text,
  created_by       uuid not null,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists ix_pm_doc_customer
  on pm_doc (tenant_id, customer_id, deleted_at);
create index if not exists ix_pm_doc_project
  on pm_doc (project_id, deleted_at);
-- root（顧客ルート / 案件フォルダ）は (customer, project or null) ごとに未削除 1 件まで
create unique index if not exists ux_pm_doc_root
  on pm_doc (tenant_id, customer_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_root and deleted_at is null;

comment on table pm_doc is 'PM 資料（外部ネットドライブ上のファイル/フォルダへのリンク）。ファイル本体は複製しない。project_id null = 顧客共通';
comment on column pm_doc.customer_id is '所属顧客。案件に登録する場合はサーバ側で案件から取得（前端は信用しない）';
comment on column pm_doc.project_id is '所属案件；null = 顧客共通';
comment on column pm_doc.is_root is 'ルートフォルダ（顧客ルート / 案件フォルダ）。同 scope で未削除は 1 件まで（ux_pm_doc_root）';
comment on column pm_doc.url is 'リンク URL（http/https、2000 文字以内）';
comment on column pm_doc.provider is 'google / microsoft / box / other；サーバ側で URL から判定';
comment on column pm_doc.kind is 'gdoc / gsheet / gslide / gfile / gfolder / ms / box / link；サーバ側で URL から判定';
comment on column pm_doc.external_id is 'URL から解析した Google ファイル/フォルダ id（Google 以外・解析失敗は null）';
comment on column pm_doc.title is '表示名（200 文字以内；空なら前端が URL から推定）';
comment on column pm_doc.mime_type is 'Google Picker 返回的 mimeType（贴 URL 登记为 null）；仅用于前端判定文件类型';
comment on column pm_doc.created_by is '追加者の租户ユーザ id（platform_tenant_user.id）';
comment on column pm_doc.created_by_name is '追加者表示名スナップショット（記録時に定格）';

create table if not exists pm_doc_task (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references platform_tenant(id),
  doc_id      uuid not null references pm_doc(id),
  task_id     uuid not null references pm_task(id),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index if not exists ux_pm_doc_task
  on pm_doc_task (doc_id, task_id)
  where deleted_at is null;
create index if not exists ix_pm_doc_task_task
  on pm_doc_task (task_id, deleted_at);

comment on table pm_doc_task is 'PM 資料 ↔ タスク 紐付け（多対多）。タスクは資料と同じ案件に属すること（サーバ側で検証）';
comment on column pm_doc_task.created_by is '紐付けた租户ユーザ id（platform_tenant_user.id）';

-- ----------------------------------------------------------------------------
-- 18. モックアップ pm_mockup / 版 pm_mockup_version / 付属ファイル pm_mockup_file（HTML・zip 効果図の公開・共有）
-- 設計：doc/design/pm-mockup.md。HTML 原文は版ごとに content(text) に保存。
-- ----------------------------------------------------------------------------

create table if not exists pm_mockup (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references platform_tenant(id),
  customer_id           uuid not null references pm_customer(id),
  project_id            uuid references pm_project(id),
  task_id               uuid references pm_task(id),
  bug_id                uuid references pm_bug(id),
  title                 text not null,
  current_version       integer not null default 0,
  share_token           text,
  share_enabled         boolean not null default false,
  share_expires_at      timestamptz,
  share_pinned_version  integer,
  share_view_count      integer not null default 0,
  share_last_viewed_at  timestamptz,
  created_by            uuid not null,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create index if not exists ix_pm_mockup_project
  on pm_mockup (tenant_id, project_id, deleted_at);
create index if not exists ix_pm_mockup_task
  on pm_mockup (task_id, deleted_at);
create index if not exists ix_pm_mockup_bug
  on pm_mockup (bug_id, deleted_at);
create unique index if not exists ux_pm_mockup_share_token
  on pm_mockup (share_token)
  where share_token is not null;

comment on table pm_mockup is 'PM モックアップ（Claude Code / Codex で作った単一 HTML の効果図）。版をまたいで不変の身元。設計：doc/design/pm-mockup.md';
comment on column pm_mockup.customer_id is '所属顧客。案件 / タスク / バグからサーバ側で導出（前端は信用しない）';
comment on column pm_mockup.project_id is '所属案件（可空：案件に紐付かないバグのモックアップ）';
comment on column pm_mockup.task_id is '紐付けタスク（可空）';
comment on column pm_mockup.bug_id is '紐付けバグ（可空）';
comment on column pm_mockup.current_version is '最新の未削除版番号（pm_mockup_version.version）';
comment on column pm_mockup.share_token is '共有リンクの推測不能トークン（/share/m/{token}）。再発行で差し替え';
comment on column pm_mockup.share_enabled is '共有リンク有効フラグ';
comment on column pm_mockup.share_expires_at is '共有リンク期限；null = 無期限';
comment on column pm_mockup.share_pinned_version is '共有で見せる版を固定；null = 常に最新版';
comment on column pm_mockup.share_view_count is '共有リンクの閲覧回数';
comment on column pm_mockup.created_by is '作成者の租户ユーザ id（platform_tenant_user.id）';
comment on column pm_mockup.created_by_name is '作成者表示名スナップショット';

create table if not exists pm_mockup_version (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references platform_tenant(id),
  mockup_id        uuid not null references pm_mockup(id),
  version          integer not null,
  content          text not null,
  size_bytes       integer not null,
  sha256           text not null,
  note             text,
  via              text not null default 'web',
  entry_path       text,
  file_count       integer not null default 1,
  created_by       uuid not null,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create unique index if not exists ux_pm_mockup_version
  on pm_mockup_version (mockup_id, version);

comment on table pm_mockup_version is 'PM モックアップの版。HTML 原文をそのまま保持（5MB まで）';
comment on column pm_mockup_version.content is 'HTML 原文（UTF-8 テキスト、改変しない）';
comment on column pm_mockup_version.size_bytes is 'UTF-8 バイト数';
comment on column pm_mockup_version.sha256 is '内容の SHA-256（hex）。最新版と同一内容の再公開は新版を作らない';
comment on column pm_mockup_version.note is '版の変更メモ（可空）';
comment on column pm_mockup_version.via is '公開経路：web（画面アップロード）/ mcp（pm-mcp 経由）';
comment on column pm_mockup_version.created_by is '公開者の租户ユーザ id（platform_tenant_user.id）';
comment on column pm_mockup_version.created_by_name is '公開者表示名スナップショット';
comment on column pm_mockup_version.entry_path is '入口 HTML のパス（例 index.html、pages/top.html）。null = 旧データ（index.html 扱い）';
comment on column pm_mockup_version.file_count is '版に含まれるファイル数（入口 HTML を含む）。単一 HTML = 1';

-- zip 公開時の入口 HTML 以外のファイル（2026-10-22-pm-mockup-files.sql）
create table if not exists pm_mockup_file (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references platform_tenant(id),
  version_id    uuid not null references pm_mockup_version(id),
  path          text not null,
  content_type  text not null,
  size_bytes    integer not null,
  data          bytea not null,
  created_at    timestamptz not null default now()
);

create unique index if not exists ux_pm_mockup_file
  on pm_mockup_file (version_id, path);

comment on table pm_mockup_file is 'PM モックアップ版の付属ファイル（zip 公開時の入口 HTML 以外）。版の削除は pm_mockup_version の軟削除で表す';
comment on column pm_mockup_file.path is '版ルートからの相対パス（/ 区切り、NFC 正規化済み、.. を含まない）';
comment on column pm_mockup_file.content_type is '拡張子から決めた Content-Type（アップロード時のホワイトリスト）';
comment on column pm_mockup_file.data is 'ファイル本体（改変しない）';

-- ----------------------------------------------------------------------------
-- 19. 設計資産 pm_design / 修訂 pm_design_revision / 審査コメント pm_design_comment / 画框 pm_design_frame（デザインボード）
-- 設計：work/design-studio/requirements.md。内容は修訂ごとに content(text) に保存、保存は current_revision の CAS。
-- ----------------------------------------------------------------------------

create table if not exists pm_design (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references platform_tenant(id),
  project_id         uuid not null references pm_project(id),
  task_id            uuid references pm_task(id),
  title              text not null,
  format             text not null,
  current_revision   integer not null default 1,
  source_repo        text,
  source_ref         text,
  source_path        text,
  source_commit_sha  text,
  source_hash        text,
  created_by         uuid not null,
  created_by_name    text,
  updated_by         uuid,
  updated_by_name    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint ck_pm_design_format check (format in ('excalidraw', 'pen')),
  constraint ck_pm_design_revision check (current_revision >= 1)
);

create index if not exists ix_pm_design_project
  on pm_design (tenant_id, project_id, deleted_at);
create index if not exists ix_pm_design_task
  on pm_design (tenant_id, task_id, deleted_at);

comment on table pm_design is 'PM 設計資産（Excalidraw 白板 / OpenPencil .pen 原稿）。不変の身元。内容は pm_design_revision に修訂ごと';
comment on column pm_design.project_id is '所属案件（必須）。可視性は案件の団队可視に従う';
comment on column pm_design.task_id is '紐付けタスク（可空）。同じ案件のタスクのみ（サーバ側で検証）';
comment on column pm_design.format is 'excalidraw（場面 JSON）/ pen（原文バイトを base64 で保持）';
comment on column pm_design.current_revision is '最新修訂番号。保存時は WHERE current_revision = expected の CAS でのみ進める（0 件 = 409）';
comment on column pm_design.source_repo is 'Git リポジトリ識別子（手動導入時。認証情報を含む URL は保存しない）';
comment on column pm_design.source_ref is 'Git branch / ref';
comment on column pm_design.source_path is 'リポジトリ内の相対パス（.. / 先頭 / 不可）';
comment on column pm_design.source_commit_sha is '取り込み元のコミット SHA';
comment on column pm_design.source_hash is '最後に取り込んだ源ファイルの SHA-256。取り込み直し時の baseSourceHash と違えば 409';
comment on column pm_design.created_by is '作成者の租户ユーザ id（platform_tenant_user.id）';

create table if not exists pm_design_revision (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references platform_tenant(id),
  design_id        uuid not null references pm_design(id),
  revision         integer not null,
  content          text not null,
  encoding         text not null,
  size_bytes       integer not null,
  sha256           text not null,
  file_name        text,
  note             text,
  via              text not null default 'web',
  created_by       uuid not null,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  constraint ck_pm_design_revision_encoding check (encoding in ('json', 'base64'))
);

create unique index if not exists ux_pm_design_revision
  on pm_design_revision (design_id, revision);

comment on table pm_design_revision is 'PM 設計資産の不可変修訂（更新・削除しない、番号は再利用しない）。白板 10MiB / .pen 32MiB まで';
comment on column pm_design_revision.content is 'excalidraw = サーバで検証・整形した場面 JSON（画像は data URL 込み）；pen = 原文バイトの base64（無改変）';
comment on column pm_design_revision.encoding is 'json / base64';
comment on column pm_design_revision.size_bytes is '原文バイト数（base64 は復号後）';
comment on column pm_design_revision.sha256 is '原文バイトの SHA-256（hex）。最新と同一内容の保存は新修訂を作らない';
comment on column pm_design_revision.via is '保存経路：web / mcp（pm-mcp 経由）';

create table if not exists pm_design_comment (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references platform_tenant(id),
  design_id         uuid not null references pm_design(id),
  revision          integer not null,
  element_id        text,
  anchor_x          double precision,
  anchor_y          double precision,
  body              text not null,
  resolved          boolean not null default false,
  resolved_by       uuid,
  resolved_by_name  text,
  resolved_at       timestamptz,
  author_user_id    uuid not null,
  author_name       text,
  via               text not null default 'web',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists ix_pm_design_comment_design
  on pm_design_comment (tenant_id, design_id, deleted_at);

comment on table pm_design_comment is 'PM 設計の審査コメント（修訂単位）。タスクコメント pm_comment とは別。element_id = .pen は画框の node_id、白板は要素 id。anchor_* は予約';
comment on column pm_design_comment.revision is '対象修訂番号（pm_design_revision.revision）';
comment on column pm_design_comment.body is '本文（プレーンテキスト、4000 文字まで）';
comment on column pm_design_comment.resolved is '解決済み。切替は案件が見えるメンバー全員、編集・削除は投稿者本人のみ';
comment on column pm_design_comment.author_user_id is '投稿者の租户ユーザ id（platform_tenant_user.id）';

-- 画框（.pen の最上位フレーム）：審査ステータスとタスク紐付けの単位。流程板からも同じ行を参照する。
-- 行は .pen の保存ごとにサーバが原文 JSON の最上位 frame（reusable = コンポーネントは除く）から同期する。
-- 最新修訂に無くなった画框は消さずに removed = true（ステータス・紐付け・コメントを失わない）。
create table if not exists pm_design_frame (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references platform_tenant(id),
  design_id         uuid not null references pm_design(id),
  node_id           text not null,
  name              text not null,
  sort_order        integer not null default 0,
  review_status     text not null default 'draft',
  status_by         uuid,
  status_by_name    text,
  status_at         timestamptz,
  last_revision     integer not null,
  removed           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ck_pm_design_frame_status check (review_status in ('draft', 'review', 'changes', 'approved'))
);

create unique index if not exists ux_pm_design_frame
  on pm_design_frame (design_id, node_id);

comment on table pm_design_frame is '.pen の画框（最上位フレーム）。審査ステータスとタスク紐付けの単位。保存ごとに原文から同期';
comment on column pm_design_frame.node_id is '.pen 内のノード id（版をまたいで同じ画面を指す）';
comment on column pm_design_frame.review_status is 'draft 下書き / review レビュー待ち / changes 要修正 / approved 承認';
comment on column pm_design_frame.last_revision is 'この画框が存在した最後の修訂番号';
comment on column pm_design_frame.removed is '最新修訂に存在しない（行は残す）';

create table if not exists pm_design_frame_task (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references platform_tenant(id),
  design_id         uuid not null references pm_design(id),
  node_id           text not null,
  task_id           uuid not null references pm_task(id),
  created_by        uuid not null,
  created_by_name   text,
  created_at        timestamptz not null default now()
);

create unique index if not exists ux_pm_design_frame_task
  on pm_design_frame_task (design_id, node_id, task_id);
create index if not exists ix_pm_design_frame_task_task
  on pm_design_frame_task (tenant_id, task_id);

comment on table pm_design_frame_task is '画框 ⇄ タスクの紐付け（多対多、同じ案件のタスクのみ）';

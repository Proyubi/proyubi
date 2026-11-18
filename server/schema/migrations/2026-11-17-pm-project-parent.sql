-- サブプロジェクト（pm_project の親子 1 階層）。
--
-- 背景：プロジェクト管理画面で「親プロジェクト → サブプロジェクト」を持てるようにする。
--   - parent_id is null      → トップレベル（従来どおり）
--   - parent_id is not null  → サブプロジェクト。親は必ずトップレベル（孫は作らない＝1 階層のみ）
-- 階層ルール（1 階層 / 同一テナント / 親が ops でない / 子を持つ案件は子になれない /
-- customer_id・team_id は親に合わせる / 子がある親は削除不可）はアプリ層
-- （PmProjectService / PmProjectHierarchyRules）で担保する。
-- 親の progress はサブ（予定工数の営業日で加重）＋親直下タスクの加重平均を
-- PmProjectProgressService がキャッシュする。
-- 冪等：何度流しても同じ結果になる。
alter table pm_project
  add column if not exists parent_id uuid references pm_project(id);

create index if not exists ix_pm_project_parent
  on pm_project (tenant_id, parent_id)
  where deleted_at is null;

comment on column pm_project.parent_id is '親プロジェクト（pm_project.id）；null=トップレベル。1 階層のみ（親は parent_id is null）';

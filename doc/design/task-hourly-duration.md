# 任务工期细化到「小时」实施方案（工作日工期 · date + 最終日作業時間 模型）

> 状态：**✅ 已实施**（2026-06-11 落地，date + planned/actual_effort_hours 模型；下文「附录」保留早期 datetime 方案的弃用记录）
> 起草：2026-06-09 ｜ 重写：2026-06-12（同步实际实现）
> 范围：任务工期从「整天」细化到「天 + 小时」，支持「不足一天 / 最后一天半天」的短任务；工期口径采用**工作日**（跳过周末与租户祝日），表单按「期间 + 最終日の作業時間」录入，WBS 列 / 甘特 / rollup 全链路按分钟统一。

---

## 0. 最终方案（一句话）

> **期间仍存纯日期（`date`，闭区间含尾日），不细化到时刻**；另存一个手填的「**最終日の作業時間** H」（0–23 时，予定 / 実績各一份）。
> **工期 =「工作日天数 D」+「最終日小时 H」**：`H>0 → (D−1) 个整天 + H 小时`；`H 空/0 → D 个整天`。按**分钟**计算并加权，前后端逐值一致。
> 「工作日」= `[start, end]` 闭区间内、**排除周六日及租户祝日**的自然日数（含首尾）。

与最初（§附录）的 datetime 方案相比，最终方案的关键转向：
- **不引入时刻**：期间回到 `date`，避免时区 / 序列化 / 字典序补零 / DST 等一整类复杂度。
- **改为工作日口径**：最初明确「不做工作日历、跨周末计入」，实际产品需要「6 人天 = 跨周末也只算工作日」的直觉，故引入 `pm_holiday` 祝日表 + 周末跳过。
- **手填小时而非算出**：短任务 / 最后一天半天用一个 `effort_hours` 表达，不必把期间拆到分钟。

---

## 1. 工期模型（核心口径）

`HOURS_PER_DAY = 24`（日历口径，前后端同值）。工期按**分钟**算与存权重。

```
D = workingDays(start, end, holidays)        // 闭区间含首尾，排除周六日 + 祝日；start>end → 0
effortMinutes = H>0 ? (D−1)*24*60 + H*60      // 最后一天只算 H 小时
                    : D*24*60                  // H 空/0：最后一天也算整天
```

- **予定工期** = `workingDays(start_date, end_date)` + `planned_effort_hours`
- **実績工期** = `workingDays(actual_start, actual_end)` + `actual_effort_hours`（两端齐全才参与）
- **取值优先级**（`effortOf`）：実績期間两端齐全 → 用実績（含 `actual_effort_hours`）；否则用予定。
- **零工期兜底**：叶子（含 milestone）`effortMinutes` 落到 0 时，rollup 权重兜底为 1，避免 `totalDur=0 → progress=0` 退化。
- **milestone**：`start == end`（同一天），工期列恒显 `—`，不参与工期语义。

**显示格式** `fmtDuration(minutes)`：默认 `auto` 进位到天 → `6d3h` / `3d`（整天省 h）/ `4h`（不足一天）/ `30m`；窄列可用 `hours` 紧凑模式 → `51h`。

前后端实现：前端 `pm-web/src/pm/utils/date.ts`（`workingDays` / `effortMinutes` / `fmtDuration` / `HOURS_PER_DAY`），后端 `TaskRollupService`（`workingDays` / `effortMinutes` / `effortOf`，`DayOfWeek.SATURDAY|SUNDAY` + holidays Set）。**CLAUDE.md 红线：两端逐值一致。**

---

## 2. 数据模型

`pm_task`（`webapi/schema/init-pm.sql`，期间保持 `date`）：

| 列 | 类型 | 说明 |
|----|------|------|
| `start_date` / `end_date` | `date not null` | 计划起止（闭区间含尾日） |
| `actual_start` / `actual_end` | `date null` | 实际起止（可空，两端齐全才计実績工期） |
| `planned_effort_hours` | `smallint null` | 予定·最終日の作業時間（0–23；空/0=最后一天算整天，配合 start/end） |
| `actual_effort_hours` | `smallint null` | 実績·最終日の作業時間（配合 actual_start/actual_end） |

- 期间仍为 `date` → 字典序 == 时间序，前端 `tree.ts` 的 `minStart/maxEnd` 比较、`flattenTasks` 排序、`store.tsx` range 计算**逻辑不变**。
- `pm_project.start/end` **不改**（保持 `date`）；任务期间须落在项目周期内。

### 祝日（工作日工期的依据）

`pm_holiday`（租户级、跨项目共享）：`holiday_date date` / `name` / `region`（默认 `JP`）/ `source`（`holidays_jp`）/ `is_manual`。

- **自动同步**：`PmHolidaySyncJob` 每周一 JST 05:00 从 **holidays-jp** 拉取并同步到各租户（`PmHolidayService.syncAllTenants`）。
- **手动维护**：`/app/pm/holidays` 提供 CRUD / 批量导入 / 「立即同步」（`PmHolidayController` + `PmHolidayService`）。
- rollup 时把当前租户祝日集合作为 `Set<LocalDate> holidays` 传入 `workingDays`；`null/空` = 仅跳过周末。

---

## 3. 序列化与接口契约

- 期间字段仍是 `'YYYY-MM-DD'` 日期串，`Task` 字段类型仍是 `string`，**TS 无破坏**。
- `planned_effort_hours` / `actual_effort_hours` 走 camelCase（`plannedEffortHours` / `actualEffortHours`），`Integer`（可空）。
- 后端 `PmTask.java` 字段 `Integer plannedEffortHours / actualEffortHours`（`@Column`）；`CreateTaskReq/UpdateTaskReq` 透传；progress 缓存 / 级联软删 / 跨项目移动逻辑与工期无关。

---

## 4. 前端落地（已实施）

| 文件 | 实现 |
|---|---|
| `pm/utils/date.ts` | `HOURS_PER_DAY=24`、`workingDays`（周末 + 祝日跳过）、`effortMinutes`、`fmtDuration`（`auto`/`hours`）、`isHolidayDate` |
| `pm/utils/tree.ts` | `effortOf(task, holidays)`（実績优先）；rollup `minStart/maxEnd` + 分钟加权 progress；零工期兜底 1 |
| `pm/api.ts` | `normalizeTask` 归一期间为 `YYYY-MM-DD`，透传两个 effortHours |
| `pm/types.ts` | `Task.plannedEffortHours / actualEffortHours?: number\|null` |
| `pm/gantt/TaskFormModal.tsx` | 予定期間 + 予定最終日小时 / 実績期間 + 実績最終日小时 两组独立录入（`InputNumber` 0–23）；即时「工期プレビュー」 |
| `pm/gantt/TaskTreeTable.tsx` | 工期列 `fmtDuration(effortOf(...))` |
| `pm/gantt/GanttChart.tsx` | 条形 / 定位消费同一工期口径 |

祝日集合由前端从 `/app/pm/holidays` 取得后注入 `effortOf` / `workingDays`，与后端缓存口径对齐。

---

## 5. 后端落地（已实施）

| 文件 | 实现 |
|---|---|
| `pm/domain/PmTask.java` | `Integer plannedEffortHours / actualEffortHours` |
| `pm/service/TaskRollupService.java` | `workingDays` / `effortMinutes` / `effortOf`（実績优先）；`rollup(tasks, holidays)` / `projectProgress(tasks, holidays)` 分钟加权 |
| `pm/service/PmHolidayService.java` + `scheduler/PmHolidaySyncJob.java` + `mapper/PmHolidayMapper.java` | 祝日 CRUD / 导入 / holidays-jp 同步 / 周一定时任务 |
| `pm/controller/PmHolidayController.java` | `/app/pm/holidays` |
| `pm/controller/PmTaskController.java` / `PmInternalController.java` | 两个 effortHours 透传 |
| `schema/init-pm.sql`（+ `proyubi-server` 资源副本） | `pm_task` 两 effort 列 + `pm_holiday` 表（两份同步） |

---

## 6. 迁移记录（`webapi/schema/migrations/`）

模型演进经过三次迁移，按序手动执行（幂等，`information_schema` 守卫）：

| 迁移 | 内容 |
|---|---|
| `2026-06-09-pm-task-datetime.sql` | **（已废弃方案）** 期间 `date → timestamptz`，按半开区间 `end+1天 00:00` 存储。见 §附录。 |
| `2026-06-10-pm-task-date-effort.sql` | **类型回退** `timestamptz → date`：迁移行（JST 00:00）`end−1天` 还原闭区间尾日，app 录入行直接截断；milestone 保 `start==end`，负工期兜底；新增单列 `effort_hours`。 |
| `2026-06-11-pm-task-plan-actual-effort.sql` | `effort_hours` **拆为** `planned_effort_hours` / `actual_effort_hours`（旧值回填到两列后删旧列）。 |

> 三次迁移与代码 / DDL 同进同退，不混部署。新库直接由 `init-pm.sql` 建成最终形态（`date` + 两 effort 列 + `pm_holiday`）。

---

## 7. 已实现的验收点

- 工期录入：期间（日期）+ 最終日の作業時間（0–23 时），予定 / 実績各一组，表单即时预览。
- 工期展示：`6d3h` / `4h` / `30m`；milestone 列 `—`；跨周末 / 跨祝日**不计入**工期天数。
- rollup：summary `start=最早叶子 / end=最晚叶子`，progress 按分钟加权；前端 live ≡ 后端缓存 `pm_project.progress`（含含小时叶子）。
- 祝日：周一自动同步 holidays-jp；可手动增删 / 导入 / 立即同步；影响全租户工期计算。

---

## 8. 明确不做（仍在 v1 范围外）

每日工时 / resource leveling、用户级时区切换、项目周期的小时精度、独立「投入工时」字段（effort vs duration 分离）。

---

## 附录：早期 datetime 方案（已弃用，存档）

最初（2026-06-09）方案把期间细化到**时刻**（`pm_task` 四列 `date → timestamptz` / `LocalDate → LocalDateTime`），工期 = `end − start` 的日历流逝时间（跨周末计入），按分钟存；前端契约用无偏移 `'YYYY-MM-DDTHH:mm'`。该方案已通过 `2026-06-09-pm-task-datetime.sql` 上线，随后因下列原因回退：

| # | 弃用原因 |
|---|---|
| 1 | **时区/序列化复杂度**：`LocalDateTime ⇄ timestamptz` 绑定 JVM `TZ=Asia/Tokyo`，存量迁移需 `AT TIME ZONE`，一处错位即整体偏移 9 小时。 |
| 2 | **工期直觉不符**：日历流逝口径下「6 人天」跨周末会变长，与团队「按工作日数」的真实心智冲突——产品最终要的是工作日工期（反而需要最初明确"不做"的工作日历）。 |
| 3 | **短任务表达过重**：仅为「最后一天半天」就把整条期间拆到分钟、甘特按像素比例渲染 sub-day 条，收益小于成本；改用一个手填 `effort_hours` 即可表达。 |

> 裁决：回到 `date` + 「工作日天数 + 最終日小时」+ 祝日表。datetime 方案的迁移脚本保留在 migrations 目录作为历史链路的一环（被 06-10 回退脚本承接）。

import type { Task } from "../types";
import { effortFor, isManualEffort } from "./date";

export interface FlatRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
  visible: boolean;
}

/**
 * 任务工期（分钟）：rollup 加权 / WBS 工期列展示统一口径，与后端 `TaskRollupService.effortOf` 一致。
 * - milestone → 0（单一时间点，无工期）；
 * - 実績套を採用する条件：実績期間が両端齐全、<b>或</b>実績工期(d/h)が手动设定済み
 *   （実績期間を入れず実績工期だけ入力しても「実际花了多久」として反映する）；否则以予定套为准；
 * - 同套手动（days 非空 或 hours>0，见 `isManualEffort`）→ 手动 d/h：effortFromDH(days, hours)；
 * - 否则 → 回退「工作日天数 D × 1営業日の時間数」期间派生（见 `effortMinutes`）。
 * 与后端 `TaskRollupService.effortOf` 逐值一致。
 */
export function effortOf(task: Task, holidays?: Set<string>): number {
  if (task.type === "milestone") return 0;
  const useActual =
    (!!task.actualStart && !!task.actualEnd) ||
    isManualEffort(task.actualEffortDays, task.actualEffortHours);
  // 実績期間が無い手动実績のみの場合、s/e は使われない（手动路径）が null 回避で予定日を代入
  const s = useActual ? task.actualStart ?? task.start : task.start;
  const e = useActual ? task.actualEnd ?? task.end : task.end;
  const h = useActual ? task.actualEffortHours : task.plannedEffortHours;
  const days = useActual ? task.actualEffortDays : task.plannedEffortDays;
  return effortFor(s, e, days, h, holidays);
}

/**
 * 按 parentId/order 构树并扁平化为渲染行；尊重 collapsed。
 *
 * @param keepIds 绞り込み中に表示する行 ID（{@link matchTasks} の結果）。
 *   指定時は該当行だけを出し、かつ collapsed を無視する（検索結果は畳まれていては意味がない）。
 *   未指定なら従来どおり全行 + collapsed 尊重。
 */
export function flattenTasks(tasks: Task[], keepIds?: Set<string> | null): FlatRow[] {
  const byParent = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  // 同级按开始日从早到晚排序；开始日相同再按 order 保持稳定
  for (const arr of byParent.values()) {
    arr.sort((a, b) =>
      a.start < b.start ? -1 : a.start > b.start ? 1 : a.order - b.order
    );
  }

  const rows: FlatRow[] = [];
  const filtering = !!keepIds;
  const walk = (
    parentId: string | null,
    depth: number,
    parentVisible: boolean
  ) => {
    const children = byParent.get(parentId) ?? [];
    for (const task of children) {
      if (filtering && !keepIds?.has(task.id)) continue;
      const kids = byParent.get(task.id) ?? [];
      rows.push({
        task,
        depth,
        hasChildren: kids.length > 0,
        visible: parentVisible,
      });
      // 绞り込み中は畳まれていても中を見せる（ヒットが隠れてしまうため）
      const childrenVisible = parentVisible && (filtering || !task.collapsed);
      walk(task.id, depth + 1, childrenVisible);
    }
  };
  walk(null, 0, true);
  return rows;
}

/** 递归取某任务下所有叶子（含自身若为叶子） */
function leavesOf(taskId: string, childrenMap: Map<string, Task[]>): Task[] {
  const kids = childrenMap.get(taskId) ?? [];
  if (kids.length === 0) {
    return [];
  }
  const out: Task[] = [];
  for (const k of kids) {
    const sub = leavesOf(k.id, childrenMap);
    if (sub.length === 0) out.push(k);
    else out.push(...sub);
  }
  return out;
}

/**
 * 汇总：summary 任务的 start/end/progress 由其叶子推导。
 * - start = 子任务最早 start
 * - end   = 子任务最晚 end
 * - progress = 按叶子工期加权的进度
 * 返回新数组，不改原对象。
 * @param holidays 租户红日子（ISO YYYY-MM-DD 集合）；用于工作日工期加权，可空=仅排除周末。
 */
export function rollupSummaries(tasks: Task[], holidays?: Set<string>): Task[] {
  const childrenMap = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId) {
      if (!childrenMap.has(t.parentId)) childrenMap.set(t.parentId, []);
      childrenMap.get(t.parentId)!.push(t);
    }
  }

  // 项目整体跨度：所有叶子任务的最早 start ~ 最晚 end。
  // 用于「没有任何带日期叶子」的空 summary —— 不留空，拉伸到项目全程。
  let projStart: string | null = null;
  let projEnd: string | null = null;
  for (const t of tasks) {
    if (childrenMap.has(t.id)) continue; // 只看叶子
    if (t.start && (!projStart || t.start < projStart)) projStart = t.start;
    if (t.end && (!projEnd || t.end > projEnd)) projEnd = t.end;
  }

  return tasks.map((t) => {
    if (t.type !== "summary") return t;
    const leaves = leavesOf(t.id, childrenMap);
    // 空阶段（无带日期的叶子）：拉伸到项目全程，避免条形空白
    if (leaves.length === 0) {
      if (projStart && projEnd) {
        return { ...t, start: projStart, end: projEnd, progress: 0 };
      }
      return t;
    }

    let minStart = leaves[0].start;
    let maxEnd = leaves[0].end;
    let minActualStart: string | null = null;
    let maxActualEnd: string | null = null;
    // 阶段「真正完成」= 全部叶子都有 actualEnd；否则实际终点未确定
    let allLeavesDone = true;
    let totalDur = 0;
    let weighted = 0;
    for (const l of leaves) {
      if (l.start < minStart) minStart = l.start;
      if (l.end > maxEnd) maxEnd = l.end;
      if (
        l.actualStart &&
        (!minActualStart || l.actualStart < minActualStart)
      ) {
        minActualStart = l.actualStart;
      }
      if (l.actualEnd && (!maxActualEnd || l.actualEnd > maxActualEnd)) {
        maxActualEnd = l.actualEnd;
      }
      if (!l.actualEnd) allLeavesDone = false;
      // 工期权重用「工期分钟」（工作日天数 + 手填小时）；零/milestone 叶子兜底权重 1，避免被取整成 0
      const dur = Math.max(effortOf(l, holidays), 1);
      totalDur += dur;
      weighted += dur * l.progress;
    }
    // 实际条规则（与“全完了まで閉じない”一致）：
    // - 未开始（无任何 actualStart）→ 不画实际条
    // - 已开始但未全完成 → actualStart 确定，actualEnd 未定（ongoing，画到今天）
    // - 全部叶子完成 → actualStart/actualEnd 都确定，闭合
    const started = minActualStart !== null;
    const actualOngoing = started && !allLeavesDone;
    return {
      ...t,
      start: minStart,
      end: maxEnd,
      actualStart: started ? minActualStart : null,
      actualEnd: started && allLeavesDone ? maxActualEnd : null,
      actualOngoing,
      progress: totalDur ? Math.round(weighted / totalDur) : 0,
    };
  });
}

/**
 * summary 任务 → 其所有后代叶子担当者的去重并集（保持首次出现顺序）。
 * 用于折叠状态下在汇总行展示"这个阶段都有谁参与"，与 rollupSummaries 的
 * leavesOf 口径一致（递归到叶子，而非仅直接子任务）。
 */
export function aggregateAssignees(tasks: Task[]): Map<string, string[]> {
  const childrenMap = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId) {
      if (!childrenMap.has(t.parentId)) childrenMap.set(t.parentId, []);
      childrenMap.get(t.parentId)!.push(t);
    }
  }
  const out = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.type !== "summary") continue;
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const l of leavesOf(t.id, childrenMap)) {
      for (const id of l.assigneeIds) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    out.set(t.id, ids);
  }
  return out;
}

/** 汇总行的工期合计（分钟）：予定 / 実績 分开累计。 */
export interface EffortAgg {
  planned: number;
  actual: number;
}

/**
 * 有子任务的行 → 其所有后代叶子的工期合计（予定 / 実績）。
 * 汇总行的工期列用它，而不是汇总行自身期间（最早开始〜最晚结束）的跨度，
 * 这样「各フェーズ的工期」加起来与 footer 総工期对得上。
 * 口径与后端 `TaskRollupService.effortTotals` 逐值一致（叶子のみ・milestone 除外）：
 * - 予定：每个叶子按予定套（手动 d/h 优先，否则予定期間派生）；
 * - 実績：実績期間両端そろう 或 実績工期手动 的叶子才计入。
 */
export function aggregateEfforts(
  tasks: Task[],
  holidays?: Set<string>
): Map<string, EffortAgg> {
  const childrenMap = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId) {
      if (!childrenMap.has(t.parentId)) childrenMap.set(t.parentId, []);
      childrenMap.get(t.parentId)!.push(t);
    }
  }
  // 叶子自身的 予定/実績 只算一次（同一叶子会被每一层祖先累加）
  const leafEffort = new Map<string, EffortAgg>();
  const effortOfLeaf = (l: Task): EffortAgg => {
    const cached = leafEffort.get(l.id);
    if (cached) return cached;
    let planned = 0;
    let actual = 0;
    if (l.type !== "milestone") {
      planned = effortFor(
        l.start,
        l.end,
        l.plannedEffortDays,
        l.plannedEffortHours,
        holidays
      );
      const actualValid =
        (!!l.actualStart && !!l.actualEnd) ||
        isManualEffort(l.actualEffortDays, l.actualEffortHours);
      if (actualValid) {
        // 実績期間が欠ける場合は手动路径＝s/e 未使用だが、null 回避で予定/開始日を代入
        const as = l.actualStart ?? l.start;
        const ae = l.actualEnd ?? as;
        actual = effortFor(
          as,
          ae,
          l.actualEffortDays,
          l.actualEffortHours,
          holidays
        );
      }
    }
    const v = { planned, actual };
    leafEffort.set(l.id, v);
    return v;
  };

  const out = new Map<string, EffortAgg>();
  for (const id of childrenMap.keys()) {
    let planned = 0;
    let actual = 0;
    for (const l of leavesOf(id, childrenMap)) {
      const e = effortOfLeaf(l);
      planned += e.planned;
      actual += e.actual;
    }
    out.set(id, { planned, actual });
  }
  return out;
}

/** 项目整体进度 = 根任务汇总 */
export function projectProgress(tasks: Task[], holidays?: Set<string>): number {
  const rolled = rollupSummaries(tasks, holidays);
  const roots = rolled.filter((t) => t.parentId === null);
  if (roots.length === 0) return 0;
  let totalDur = 0;
  let weighted = 0;
  for (const r of roots) {
    const dur = Math.max(effortOf(r, holidays), 1);
    totalDur += dur;
    weighted += dur * r.progress;
  }
  return totalDur ? Math.round(weighted / totalDur) : 0;
}

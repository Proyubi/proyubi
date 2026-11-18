import type { Dependency, Task } from "../types";
import dayjs, { durationDays, ISO } from "../utils/date";
import {
  aggregateAssignees,
  aggregateEfforts,
  type EffortAgg,
  flattenTasks,
  rollupSummaries,
  type FlatRow,
} from "../utils/tree";

export type Scale = "day" | "week";

export interface GanttGeom {
  /** 可见行（已扁平 + 汇总后的 task） */
  rows: FlatRow[];
  rolledMap: Map<string, Task>;
  /** summary task -> 后代叶子担当并集（折叠汇总行展示用，含已折叠隐藏的后代） */
  assigneeAgg: Map<string, string[]>;
  /** 有子任务的行 -> 后代叶子工期合计（予定/実績）；汇总行工期列・バー tooltip 用 */
  effortAgg: Map<string, EffortAgg>;
  rangeStart: string;
  rangeEnd: string;
  totalDays: number;
  dayWidth: number;
  contentWidth: number;
  /** taskId -> 可见行索引 */
  rowIndex: Map<string, number>;
  /** 日期 → x 像素 */
  xOf: (isoDate: string) => number;
  /** 每个 task 的（计划）条形几何 */
  barOf: (task: Task) => { left: number; width: number };
  /** 实际起止的条形几何；未填实际时间返回 null。ongoing=阶段进行中（画到今天，未闭合） */
  actualBarOf: (
    task: Task
  ) => { left: number; width: number; ongoing: boolean } | null;
}

const DAY_WIDTH: Record<Scale, number> = { day: 30, week: 11 };

/**
 * @param keepIds 绞り込み中に表示する行 ID。ロールアップ・時間軸レンジ・担当集計は
 *   絞り込み<b>前</b>の全件で計算するので、絞っても文脈行の日付/進捗もバーの位置も動かない。
 */
export function buildGeom(
  tasks: Task[],
  scale: Scale,
  holidays?: Set<string>,
  keepIds?: Set<string> | null
): GanttGeom {
  const rolled = rollupSummaries(tasks, holidays);
  const rolledMap = new Map(rolled.map((t) => [t.id, t]));
  // 全量算聚合（折叠后子行会被下面 filter 掉，故不能用 rows）
  const assigneeAgg = aggregateAssignees(rolled);
  const effortAgg = aggregateEfforts(rolled, holidays);
  const rows = flattenTasks(rolled, keepIds).filter((r) => r.visible);

  // 时间范围：取所有任务（含予定 start/end 与实际 actualStart/actualEnd）的最早开始~最晚结束，
  // 不锁死项目周期；无任务时回退到今天。前后各留 padding。
  const today = dayjs().format("YYYY-MM-DD");
  const allDates: string[] = [];
  for (const t of rolled) {
    if (t.start) allDates.push(t.start);
    if (t.end) allDates.push(t.end);
    if (t.actualStart) allDates.push(t.actualStart);
    if (t.actualEnd) allDates.push(t.actualEnd);
  }
  let minStart = allDates.length ? allDates[0] : today;
  let maxEnd = allDates.length ? allDates[0] : today;
  for (const d of allDates) {
    if (d < minStart) minStart = d;
    if (d > maxEnd) maxEnd = d;
  }
  const rangeStart = dayjs(minStart)
    .startOf("week")
    .add(-2, "day")
    .format("YYYY-MM-DD");
  const rangeEnd = dayjs(maxEnd)
    .endOf("week")
    .add(2, "day")
    .format("YYYY-MM-DD");
  // 背景格/表头/内容宽度按天；rangeStart/rangeEnd 已按天对齐（startOf/endOf week）
  const totalDays = durationDays(rangeStart, rangeEnd);
  const dayWidth = DAY_WIDTH[scale];
  const contentWidth = totalDays * dayWidth;
  // 纯日期模型：条形按「占格天数」（含尾日）定位，rangeStart 当天为像素原点
  const originDay = dayjs(rangeStart).startOf("day");

  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => rowIndex.set(r.task.id, i));

  // 自 rangeStart 起的天数 * dayWidth
  const xOf = (iso: string) =>
    dayjs(iso).startOf("day").diff(originDay, "day") * dayWidth;

  const barOf = (task: Task) => {
    const left = xOf(task.start);
    const width = durationDays(task.start, task.end) * dayWidth;
    return { left, width };
  };

  const actualBarOf = (task: Task) => {
    if (!task.actualStart) return null;
    // 进行中（着手中）：actualStart あり・actualEnd 未定 → 画到今天且未闭合（虚线）。
    // summary は rollup が actualOngoing を立てる；叶子（通常タスク）は開始のみ＝进行中。
    const ongoing =
      !task.actualEnd &&
      (task.actualOngoing === true || task.type !== "summary");
    const end = task.actualEnd ?? (ongoing ? dayjs().format(ISO) : null);
    if (!end) return null;
    const left = xOf(task.actualStart);
    const width = durationDays(task.actualStart, end) * dayWidth;
    return { left, width, ongoing };
  };

  return {
    rows,
    rolledMap,
    assigneeAgg,
    effortAgg,
    rangeStart,
    rangeEnd,
    totalDays,
    dayWidth,
    contentWidth,
    rowIndex,
    xOf,
    barOf,
    actualBarOf,
  };
}

export interface DepPath {
  id: string;
  d: string;
  fromVisible: boolean;
}

/** 计算 FS 依赖的折线路径（从前序右端 → 后续左端，带绕行） */
export function buildDepPaths(
  deps: Dependency[],
  geom: GanttGeom,
  rowHeight: number
): DepPath[] {
  const out: DepPath[] = [];
  for (const dep of deps) {
    const pre = geom.rolledMap.get(dep.predecessorId);
    const suc = geom.rolledMap.get(dep.successorId);
    const pi = geom.rowIndex.get(dep.predecessorId);
    const si = geom.rowIndex.get(dep.successorId);
    if (!pre || !suc || pi === undefined || si === undefined) {
      out.push({ id: dep.id, d: "", fromVisible: false });
      continue;
    }
    const preBar = geom.barOf(pre);
    const sucBar = geom.barOf(suc);
    const x1 = preBar.left + preBar.width;
    const y1 = pi * rowHeight + rowHeight / 2;
    const x2 = sucBar.left;
    const y2 = si * rowHeight + rowHeight / 2;

    const gap = 10;
    let d: string;
    if (x2 >= x1 + gap) {
      const midX = x1 + gap;
      d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
    } else {
      // 后续在前序左侧，需要绕行
      const down = y2 > y1 ? rowHeight / 2 : -rowHeight / 2;
      d = `M ${x1} ${y1} H ${x1 + gap} V ${y1 + down} H ${
        x2 - gap
      } V ${y2} H ${x2}`;
    }
    out.push({ id: dep.id, d, fromVisible: true });
  }
  return out;
}

import type { WorkloadItem } from "../types";
import dayjs, { durationDays } from "../utils/date";

/**
 * 成员视图坐标系。
 *
 * 与 RoadmapTimelineHeader 共用同一像素契约：
 *   x = dayjs(date).diff(rangeStart, 'day') * dayWidth
 *   contentWidth = totalDays * dayWidth
 * 故甘特条与三层时间轴表头天然对齐。
 *
 * dayWidth 默认与路线图一致（月粒度），但成员视图通常跨度更大、任务更稀疏，
 * 这里单独定义常量便于将来按需调参。
 */
export interface ResourceGeom {
  rangeStart: string;
  rangeEnd: string;
  totalDays: number;
  dayWidth: number;
  contentWidth: number;
  /**
   * body 周网格线的水平起始偏移（像素）。
   * body 背景按 7 天平铺，但 rangeStart 多为月初（未必周一），
   * 而表头周列 / 今日竖线都对齐 ISO 周（周一）。用此偏移把 body 网格线
   * 推到第一个周一，使三者（表头周边界 / body 网格 / 今日线）严格对齐。
   */
  weekLineOffsetPx: number;
  /** 日期 → x 像素（左偏移） */
  xOf: (isoDate: string) => number;
  /** 计划起止条形几何；缺 start/end 返回 null */
  barOf: (item: WorkloadItem) => { left: number; width: number } | null;
}

/** 「週」粒度的每日像素（约 8px/天 ≈ 240px/月，比路线图稍宽以便阅读任务名） */
export const RESOURCE_DAY_WIDTH = 8;

/** 「日」粒度的每日像素：够宽以便表头逐日标注日数（需 ≥ 表头 DAY_LABEL_MIN_W=14） */
export const RESOURCE_DAY_SCALE_WIDTH = 28;

/** 仅参与绘制 / 撞期计算的条目：叶子任务且有完整起止时间 */
export function isBarItem(item: WorkloadItem): boolean {
  return item.type === "task" && !!item.start && !!item.end;
}

/** 显式时间窗（按月）：start/end 为 YYYY-MM-DD（一般是月初/月末） */
export interface ResourceRange {
  start: string;
  end: string;
}

/**
 * 由一批工时条目推导全局时间范围 + 坐标换算。
 * - 默认（range 为空）= 所有有起止条目的 min(start) ~ max(end)，对齐到月初/月末，
 *   没有任何可排期条目时回退到「本月」，避免空范围。这样能保证一个成员在
 *   所有产品/项目下的任务都落在可视窗内，不会因固定年份而被裁掉。
 * - 传入 `range` 时，固定为该窗（开始月月初 ~ 结束月月末），
 *   越界的甘特条会被裁剪到可视范围内、完全越界的条目宽度归零（不显示）。
 */
export function buildResourceGeom(
  items: WorkloadItem[],
  dayWidth: number = RESOURCE_DAY_WIDTH,
  range?: ResourceRange | null
): ResourceGeom {
  let rangeStart: string;
  let rangeEnd: string;
  if (range) {
    rangeStart = dayjs(range.start).startOf("month").format("YYYY-MM-DD");
    rangeEnd = dayjs(range.end).endOf("month").format("YYYY-MM-DD");
  } else {
    const starts: string[] = [];
    const ends: string[] = [];
    for (const it of items) {
      if (it.start) starts.push(it.start);
      if (it.end) ends.push(it.end);
    }
    const today = dayjs().format("YYYY-MM-DD");
    let minStart = starts.length ? starts[0] : today;
    let maxEnd = ends.length ? ends[0] : today;
    for (const s of starts) if (s < minStart) minStart = s;
    for (const e of ends) if (e > maxEnd) maxEnd = e;
    rangeStart = dayjs(minStart).startOf("month").format("YYYY-MM-DD");
    rangeEnd = dayjs(maxEnd).endOf("month").format("YYYY-MM-DD");
  }

  const totalDays = durationDays(rangeStart, rangeEnd);
  const contentWidth = totalDays * dayWidth;

  // rangeStart 到「其所在/之后第一个周一」的天数（isoWeekday: 1=周一..7=周日）
  const mondayOffsetDays = (8 - dayjs(rangeStart).isoWeekday()) % 7;
  const weekLineOffsetPx = mondayOffsetDays * dayWidth;

  const xOf = (isoDate: string) =>
    dayjs(isoDate).diff(dayjs(rangeStart), "day") * dayWidth;

  const barOf = (item: WorkloadItem) => {
    if (!item.start || !item.end) return null;
    const rawLeft = xOf(item.start);
    const rawRight = rawLeft + durationDays(item.start, item.end) * dayWidth;
    // 裁剪到 [0, contentWidth]：限定时间窗下越界部分不画
    const left = Math.max(0, rawLeft);
    const right = Math.min(contentWidth, rawRight);
    if (right <= 0 || left >= contentWidth) return { left: 0, width: 0 };
    // 完全在范围内时保留最小可视宽度，避免极短任务消失
    const clipped = rawLeft >= 0 && rawRight <= contentWidth;
    const width = clipped
      ? Math.max(right - left, 6)
      : Math.max(right - left, 0);
    return { left, width };
  };

  return {
    rangeStart,
    rangeEnd,
    totalDays,
    dayWidth,
    contentWidth,
    weekLineOffsetPx,
    xOf,
    barOf,
  };
}

/**
 * 撞期检测（区间重叠 sweep line）。
 *
 * 输入：单个成员的一批任务（无 start/end 的会被忽略，不参与冲突）。
 * 做法：按 start 升序排序后扫描，维护「当前活跃区间集合」，
 * 凡是与某个已活跃区间日历重叠（闭区间，含端点同日视为重叠）的任务，
 * 双方都标为冲突。
 *
 * 返回：冲突任务的 taskId 集合。复杂度 O(n log n)。
 */
export function detectConflicts(items: WorkloadItem[]): Set<string> {
  const conflicts = new Set<string>();
  // 规整为 {id, start, end} 三元组（isBarItem 已保证 start/end 非空）
  const intervals = items
    .filter(isBarItem)
    .map((it) => ({
      id: it.taskId,
      start: it.start as string,
      end: it.end as string,
    }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  if (intervals.length < 2) return conflicts;

  // 活跃区间：end 仍 >= 新任务 start 的区间
  const active: { id: string; end: string }[] = [];
  for (const cur of intervals) {
    // 移除已结束的活跃区间（end < cur.start → 不可能重叠）
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end < cur.start) active.splice(i, 1);
    }
    // 剩下的活跃区间都与 cur 重叠（它们 start <= cur.start 且 end >= cur.start）
    if (active.length > 0) {
      conflicts.add(cur.id);
      for (const a of active) conflicts.add(a.id);
    }
    active.push({ id: cur.id, end: cur.end });
  }
  return conflicts;
}

import type { RoadmapItem } from "../types";
import dayjs, { durationDays } from "../utils/date";

/**
 * 路线图坐标系。复用甘特 ganttLayout 的 xOf/buildGeom 思路，
 * 但 dayWidth 更小（月粒度为主），且按 RoadmapItem（已 rollup）排布。
 */
export interface RoadmapGeom {
  rangeStart: string;
  rangeEnd: string;
  totalDays: number;
  dayWidth: number;
  contentWidth: number;
  /** 日期 → x 像素（左偏移） */
  xOf: (isoDate: string) => number;
  /** 阶段色块（summary）几何 */
  barOf: (item: RoadmapItem) => { left: number; width: number };
}

/** 路线图默认像素比例（月粒度，约 6px/天 ≈ 180px/月） */
export const ROADMAP_DAY_WIDTH = 6;

export function buildRoadmapGeom(
  items: RoadmapItem[],
  projectStart?: string | null,
  projectEnd?: string | null,
  dayWidth: number = ROADMAP_DAY_WIDTH,
): RoadmapGeom {
  const today = dayjs().format("YYYY-MM-DD");
  const starts: string[] = [];
  const ends: string[] = [];
  if (projectStart) starts.push(projectStart);
  if (projectEnd) ends.push(projectEnd);
  for (const it of items) {
    if (it.start) starts.push(it.start);
    if (it.end) ends.push(it.end);
  }
  let minStart = starts.length ? starts[0] : today;
  let maxEnd = ends.length ? ends[0] : today;
  for (const s of starts) if (s < minStart) minStart = s;
  for (const e of ends) if (e > maxEnd) maxEnd = e;

  // 月粒度：对齐到月初/月末，前后留一点 padding
  const rangeStart = dayjs(minStart).startOf("month").format("YYYY-MM-DD");
  const rangeEnd = dayjs(maxEnd).endOf("month").format("YYYY-MM-DD");
  const totalDays = durationDays(rangeStart, rangeEnd);
  const contentWidth = totalDays * dayWidth;

  const xOf = (isoDate: string) =>
    dayjs(isoDate).diff(dayjs(rangeStart), "day") * dayWidth;

  const barOf = (item: RoadmapItem) => {
    const left = xOf(item.start);
    const days = durationDays(item.start, item.end);
    // 阶段色块最小宽度，保证箭头尖角可见
    const width = Math.max(days * dayWidth, 24);
    return { left, width };
  };

  return {
    rangeStart,
    rangeEnd,
    totalDays,
    dayWidth,
    contentWidth,
    xOf,
    barOf,
  };
}

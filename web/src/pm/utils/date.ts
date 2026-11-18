import dayjs, { type Dayjs } from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import isoWeek from "dayjs/plugin/isoWeek";
import "dayjs/locale/zh-cn";

dayjs.extend(isBetween);
dayjs.extend(isoWeek);
dayjs.locale("zh-cn");

export const ISO = "YYYY-MM-DD";

export const d = (v?: string | Dayjs) => dayjs(v);

/**
 * 占格天数（甘特/路线图/资源背景格用）：两端按「自然日」算，含首尾。
 * 对 datetime 入参健壮——先 startOf('day') 把时分清零，避免时间部分污染天数。
 * 例：'07/08 09:00' → '07/08 18:00' = 1d；'07/08' → '07/10' = 3d。
 */
export function durationDays(start: string, end: string): number {
  return dayjs(end).startOf("day").diff(dayjs(start).startOf("day"), "day") + 1;
}

/** 某 ISO 日期（YYYY-MM-DD）是否红日子（在 holidays 集合内）。 */
export function isHolidayDate(
  isoDate: string,
  holidays?: Set<string>
): boolean {
  return holidays?.has(isoDate) ?? false;
}

/**
 * 工作日天数 D：[start, end] 闭区间内、排除周六周日及 holidays（红日子）的自然日数（含首尾）。
 * 与后端 `TaskRollupService.workingDays` 逐值一致。start>end → 0。
 * 例：周五→下周一（周一祝日）= 1（仅周五）。13日→13日（工作日）= 1。
 */
export function workingDays(
  start: string,
  end: string,
  holidays?: Set<string>
): number {
  let day = dayjs(start).startOf("day");
  const last = dayjs(end).startOf("day");
  if (last.isBefore(day)) return 0;
  let n = 0;
  while (day.isSame(last) || day.isBefore(last)) {
    const dow = day.day();
    const nonWorking =
      dow === 0 || dow === 6 || (holidays?.has(day.format(ISO)) ?? false);
    if (!nonWorking) n++;
    day = day.add(1, "day");
  }
  return n;
}

/**
 * 换算单位：1 営業日 = 何時間（工期 ↔ 時間）。租户可配置（既定 8；旧固定 24）。
 * 会话级单值——当前登录租户的设置，登录后由 store 从 `/app/pm/settings` 注入（{@link setHoursPerDay}）。
 * 与后端 `PmSettingService.getHoursPerWorkday` 同源同值，保证 FE/BE 工期口径逐值一致。
 */
let hoursPerDay = 8;

/** 当前「1営業日=何時間」（工期↔時間の換算単位）。 */
export function getHoursPerDay(): number {
  return hoursPerDay;
}

/** 会话级设置「1営業日=何時間」：登录后由 store 注入租户设置。非法/越界忽略或 clamp 到 [1,24]。 */
export function setHoursPerDay(n: number): void {
  if (typeof n === "number" && Number.isFinite(n) && n > 0) {
    hoursPerDay = Math.min(24, Math.max(1, n));
  }
}

/**
 * 期间派生工期（分钟）「工作日天数 D × hoursPerDay」模型——与后端 `TaskRollupService.effortMinutes` 逐值一致。
 * 注意：经 `effortFor` 走时，H>0 已被 `isManualEffort` 拦为手动总量，故此处实际只有 H=0 分支生效（= D×hoursPerDay）。
 * H>0 的「最終日 H 小时」旧语义仅在直接调用本函数时保留（=（D−1）天 + H 小时）。
 * - D ≤ 0（整段周末/红日子）→ 0。
 * 例（hoursPerDay=8）：D=5,H=0 → 2400（5d）；D=1,H=0 → 480（1d）；直接调用 D=5,H=4 → 2160（4d4h）。
 */
export function effortMinutes(
  start: string,
  end: string,
  effortHours?: number | null,
  holidays?: Set<string>
): number {
  const D = workingDays(start, end, holidays);
  if (D <= 0) return 0;
  const H = effortHours ?? 0;
  const hMin = Math.round(H * 60);
  return hMin > 0
    ? Math.round((D - 1) * hoursPerDay * 60) + hMin
    : Math.round(D * hoursPerDay * 60);
}

/**
 * 手动工期（分钟）「日数 d + 小时 h」模型——与后端 `TaskRollupService.effortFromDH` 逐值一致。
 * effortFromDH = d*hoursPerDay*60 + h*60（分钟）。d 为営業日単位（1d=hoursPerDay 時間），h 为不足 1 日的小时余量；
 * d 负数兜底为 0、h 缺省按 0 处理（用于「days 非空即手动、hours 缺省 0」约定）。
 * 例（hoursPerDay=8）：3d0h → 3*8*60=1440；1d6h → 1*8*60+6*60=840。
 */
export function effortFromDH(days: number, hours: number): number {
  return (
    Math.round(Math.max(0, days) * hoursPerDay * 60) +
    Math.round((hours || 0) * 60)
  );
}

/**
 * 「该套工期是否手动设置」开关——与后端 `TaskRollupService.manualEffort` 逐值一致。
 * 手动＝日数(d) 非空 **或** 小时(h) > 0：用户填了 d/h 任一即视为手动总量（effortFromDH(d,h)）；
 * 仅当两者皆空/0 时才回退按期间派生（effortMinutes）。
 * 注意：日数缺省按 0 处理（「日=空 时间=4」→ 0d4h = 4h），区别于「日=空 时间=0」=期间派生。
 */
export function isManualEffort(
  days?: number | null,
  hours?: number | null
): boolean {
  return days != null || (hours ?? 0) > 0;
}

/**
 * 同套工期（分钟）统一入口：手动（d/h，或仅 h>0）优先 → effortFromDH(d,h)，否则按期间派生 → effortMinutes。
 * 各处（WBS 列 / 合计 / 甘特 tooltip / 表单回示）都走这里，避免分支口径漂移。
 * 与后端 `TaskRollupService.effortOf` 同套分支逐值一致。
 */
export function effortFor(
  start: string,
  end: string,
  days?: number | null,
  hours?: number | null,
  holidays?: Set<string>
): number {
  return isManualEffort(days, hours)
    ? effortFromDH(days ?? 0, hours ?? 0)
    : effortMinutes(start, end, hours, holidays);
}

/**
 * 工期格式化。
 * - compact='auto'（默认）：进位到天，`6d3h` / `3d`（整天省 h）/ `4h` / `30m`。
 * - compact='hours'：纯小时紧凑模式（窄列用），如 `51h` / `30m`。
 * - 0 分钟 → `'0h'`。
 */
export function fmtDuration(
  minutes: number,
  compact: "auto" | "hours" = "auto"
): string {
  const total = Math.max(0, Math.round(minutes));
  if (total === 0) return "0h";
  if (compact === "hours") {
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  // auto：进位到天
  const minsPerDay = Math.round(hoursPerDay * 60);
  const days = Math.floor(total / minsPerDay);
  const rem = total - days * minsPerDay;
  const hours = Math.floor(rem / 60);
  const mins = rem % 60;
  if (days > 0) {
    if (hours === 0 && mins === 0) return `${days}d`;
    if (mins === 0) return `${days}d${hours}h`;
    return hours === 0 ? `${days}d${mins}m` : `${days}d${hours}h${mins}m`;
  }
  if (hours > 0) return mins === 0 ? `${hours}h` : `${hours}h${mins}m`;
  return `${mins}m`;
}

export function fmt(v: string, f = ISO): string {
  return dayjs(v).format(f);
}

export function addDays(v: string, n: number): string {
  return dayjs(v).add(n, "day").format(ISO);
}

/** 两日期间的整段日期序列 */
export function dateRange(start: string, end: string): Dayjs[] {
  const out: Dayjs[] = [];
  let cur = dayjs(start);
  const last = dayjs(end);
  while (cur.isSame(last) || cur.isBefore(last)) {
    out.push(cur);
    cur = cur.add(1, "day");
  }
  return out;
}

export const isWeekend = (v: Dayjs) => v.day() === 0 || v.day() === 6;

/** 时间轴分段（年/月/周通用）：连续 day 序列按 keyOf 归并成左偏移 + 宽度的色块 */
export interface TimeSegment {
  /** 分段 key（用于稳定 React key / 文案） */
  key: string;
  label: string;
  /** 像素左偏移 */
  left: number;
  /** 像素宽度 */
  width: number;
}

export function segmentBy(
  days: Dayjs[],
  dayWidth: number,
  keyOf: (d: Dayjs) => string,
  labelOf: (d: Dayjs, key: string) => string
): TimeSegment[] {
  const segs: TimeSegment[] = [];
  let i = 0;
  while (i < days.length) {
    const k = keyOf(days[i]);
    let j = i;
    while (j < days.length && keyOf(days[j]) === k) j++;
    segs.push({
      key: k,
      label: labelOf(days[i], k),
      left: i * dayWidth,
      width: (j - i) * dayWidth,
    });
    i = j;
  }
  return segs;
}

export default dayjs;

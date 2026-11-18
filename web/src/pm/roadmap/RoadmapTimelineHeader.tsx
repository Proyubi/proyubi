import { useIntl } from "@umijs/max";
import { useMemo } from "react";
import dayjs, { dateRange, isWeekend, segmentBy } from "../utils/date";

/**
 * 三层（年 / 月 / 周）时间轴表头，可独立复用。
 *
 * 设计为与任何业务解耦：仅接收时间范围与像素比例，自行渲染。
 * 路线图视图与成员视图共用同一组件——务必保持 props 稳定。
 *
 * 布局约定（成员视图同事请按此对齐时间网格）：
 *  - 横向像素 = (该日期 - rangeStart 的天数) * dayWidth
 *  - 表头总宽 = contentWidth（= 天数 * dayWidth）；高度 = yearH + monthH + weekH
 *  - rangeStart / rangeEnd 都是闭区间（含首尾两天）
 */
export interface RoadmapTimelineHeaderProps {
  /** 起始日期（含），ISO `YYYY-MM-DD` */
  rangeStart: string;
  /** 结束日期（含），ISO `YYYY-MM-DD` */
  rangeEnd: string;
  /** 每日像素宽（月粒度建议 4~11px） */
  dayWidth: number;
  /** 内容总宽（像素）。不传则自动按天数 * dayWidth 计算 */
  contentWidth?: number;
  /** 年/月/周/日 各层高度（像素），可覆盖默认值 */
  yearHeight?: number;
  monthHeight?: number;
  weekHeight?: number;
  dayHeight?: number;
  /** 是否渲染「周」层（dayWidth 很小时可关掉以免拥挤）。默认 true */
  showWeeks?: boolean;
  /** 是否渲染「日」层（每日一格 + 周末底纹，dayWidth 够宽时标注日数）。默认 false */
  showDays?: boolean;
  /** 额外类名 */
  className?: string;
}

const DEFAULT_YEAR_H = 22;
const DEFAULT_MONTH_H = 22;
const DEFAULT_WEEK_H = 18;
const DEFAULT_DAY_H = 18;
/** 日格宽到此像素才标注日数，否则只留周末底纹（避免拥挤） */
const DAY_LABEL_MIN_W = 14;

export default function RoadmapTimelineHeader({
  rangeStart,
  rangeEnd,
  dayWidth,
  contentWidth,
  yearHeight = DEFAULT_YEAR_H,
  monthHeight = DEFAULT_MONTH_H,
  weekHeight = DEFAULT_WEEK_H,
  dayHeight = DEFAULT_DAY_H,
  showWeeks = true,
  showDays = false,
  className,
}: RoadmapTimelineHeaderProps) {
  const intl = useIntl();
  const monthFormat = intl.formatMessage({
    id: "projects.roadmap.monthFormat",
  });

  const days = useMemo(
    () => dateRange(rangeStart, rangeEnd),
    [rangeStart, rangeEnd]
  );

  const width = contentWidth ?? days.length * dayWidth;

  const years = useMemo(
    () =>
      segmentBy(
        days,
        dayWidth,
        (dd) => dd.format("YYYY"),
        (_dd, key) => `${key}`
      ),
    [days, dayWidth]
  );

  const months = useMemo(
    () =>
      segmentBy(
        days,
        dayWidth,
        (dd) => dd.format("YYYY/MM"),
        (dd) => dd.format(monthFormat)
      ),
    [days, dayWidth, monthFormat]
  );

  // 周：按 ISO 周归并，标签取该周首日的「月/日」
  const weeks = useMemo(
    () =>
      showWeeks
        ? segmentBy(
            days,
            dayWidth,
            (dd) => `${dd.isoWeekYear()}-${dd.isoWeek()}`,
            (dd) => dayjs(dd).startOf("isoWeek").format("M/D")
          )
        : [],
    [days, dayWidth, showWeeks]
  );

  const showDayLabel = showDays && dayWidth >= DAY_LABEL_MIN_W;

  const totalH =
    yearHeight +
    monthHeight +
    (showWeeks ? weekHeight : 0) +
    (showDays ? dayHeight : 0);

  return (
    <div
      className={`rm-tl-head${className ? ` ${className}` : ""}`}
      style={{ width, height: totalH }}
    >
      <div className="rm-tl-years" style={{ height: yearHeight }}>
        {years.map((y) => (
          <div
            key={y.key}
            className="rm-tl-year"
            style={{
              left: y.left,
              width: y.width,
              lineHeight: `${yearHeight}px`,
            }}
          >
            {y.label}
          </div>
        ))}
      </div>
      <div className="rm-tl-months" style={{ height: monthHeight }}>
        {months.map((m) => (
          <div
            key={m.key}
            className="rm-tl-month"
            style={{
              left: m.left,
              width: m.width,
              lineHeight: `${monthHeight}px`,
            }}
          >
            {m.label}
          </div>
        ))}
      </div>
      {showWeeks && (
        <div className="rm-tl-weeks" style={{ height: weekHeight }}>
          {weeks.map((w) => (
            <div
              key={w.key}
              className="rm-tl-week"
              style={{
                left: w.left,
                width: w.width,
                lineHeight: `${weekHeight}px`,
              }}
            >
              {w.width >= 18 ? w.label : ""}
            </div>
          ))}
        </div>
      )}
      {showDays && (
        <div className="rm-tl-days" style={{ height: dayHeight }}>
          {days.map((dd, idx) => (
            <div
              key={dd.format("YYYY-MM-DD")}
              className={`rm-tl-day${
                isWeekend(dd) ? " rm-tl-day-weekend" : ""
              }`}
              style={{
                left: idx * dayWidth,
                width: dayWidth,
                lineHeight: `${dayHeight}px`,
              }}
            >
              {showDayLabel ? dd.date() : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

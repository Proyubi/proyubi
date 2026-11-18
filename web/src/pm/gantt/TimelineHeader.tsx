import { useMemo } from "react";
import dayjs, { dateRange, isHolidayDate, isWeekend } from "../utils/date";
import { GANTT } from "../theme";
import type { GanttGeom, Scale } from "./ganttLayout";

interface Props {
  geom: GanttGeom;
  scale: Scale;
  /** 红日子（ISO YYYY-MM-DD 集合）：表头红底 */
  holidays?: Set<string>;
}

export default function TimelineHeader({ geom, scale, holidays }: Props) {
  const days = useMemo(
    () => dateRange(geom.rangeStart, geom.rangeEnd),
    [geom.rangeStart, geom.rangeEnd]
  );

  // 月分段
  const months = useMemo(() => {
    const segs: { label: string; left: number; width: number }[] = [];
    let i = 0;
    while (i < days.length) {
      const m = days[i].format("YYYY/MM");
      let j = i;
      while (j < days.length && days[j].format("YYYY/MM") === m) j++;
      segs.push({
        label: m,
        left: i * geom.dayWidth,
        width: (j - i) * geom.dayWidth,
      });
      i = j;
    }
    return segs;
  }, [days, geom.dayWidth]);

  return (
    <div
      className="gt-tl-head"
      style={{ height: GANTT.headerHeight, width: geom.contentWidth }}
    >
      <div className="gt-tl-months">
        {months.map((m) => (
          <div
            key={m.label + m.left}
            className="gt-tl-month"
            style={{ left: m.left, width: m.width }}
          >
            {m.label}
          </div>
        ))}
      </div>
      <div className="gt-tl-days">
        {days.map((day, idx) => {
          const holiday = isHolidayDate(day.format("YYYY-MM-DD"), holidays);
          const weekend = isWeekend(day);
          const showLabel =
            scale === "day" || day.isoWeekday() === 1 || day.date() === 1;
          return (
            <div
              key={idx}
              className={`gt-tl-day ${
                holiday ? "gt-tl-holiday" : weekend ? "gt-tl-weekend" : ""
              }`}
              style={{ width: geom.dayWidth }}
            >
              {showLabel ? day.date() : ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { dayjs };

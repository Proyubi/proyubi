import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, Tooltip } from "antd";
import { useIntl } from "@umijs/max";
import type { Dependency, Member, Task } from "../types";
import dayjs, {
  dateRange,
  effortFor,
  fmt,
  fmtDuration,
  isHolidayDate,
  isWeekend,
} from "../utils/date";
import { GANTT } from "../theme";
import TaskTreeTable from "./TaskTreeTable";
import TimelineHeader from "./TimelineHeader";
import DependencyLines from "./DependencyLines";
import { buildGeom, type Scale } from "./ganttLayout";
import "./gantt.css";

interface Props {
  tasks: Task[];
  deps: Dependency[];
  memberMap: Record<string, Member>;
  members: Member[];
  scale: Scale;
  /** 红日子（ISO YYYY-MM-DD 集合）：工期排除 + 时间轴红底 */
  holidays?: Set<string>;
  /** 総工期・予定合計（分）：後端集計値、footer へそのまま渡す（前端で再計算しない）。 */
  plannedTotal?: number | null;
  /** 総工期・実績合計（分）：後端集計値（着手中の手动工期含む）。 */
  actualTotal?: number | null;
  selectedId?: string;
  /** 绞り込み中に表示する行 ID（null=絞り込みなし）。{@link matchTasks} の結果をそのまま渡す */
  keepIds?: Set<string> | null;
  /** 実際にヒットした行 ID。行の強調に使う */
  hitIds?: Set<string>;
  /** ヒット部分を <mark> で囲むキーワード（hover/選択の highlight とは別物） */
  keyword?: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (parent: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onAssigneeChange: (taskId: string, assigneeIds: string[]) => void;
}

/**
 * バー hover 時の中身。コンポーネントに切り出す＝要素生成だけで済み、
 * effortFor（日単位ループ）は実際にポップアップが開いた時にしか走らない。
 * インライン JSX のままだと全行ぶんを毎レンダリング計算してしまう。
 */
function BarTip({
  task,
  holidays,
  plannedSum,
}: {
  task: Task;
  holidays?: Set<string>;
  /** 汇总行：后代叶子の予定工期合計（分）。指定時は期間派生ではなくこれを表示 */
  plannedSum?: number;
}) {
  const intl = useIntl();
  return (
    <div className="gt-tip-wrap">
      <div className="gt-tip-meta">
        <span className="gt-tip-date">
          {fmt(task.start, "YYYY/MM/DD")} ~ {fmt(task.end, "YYYY/MM/DD")}
        </span>
        <span className="gt-tip-pct">{task.progress}%</span>
      </div>
      <div className="gt-tip-dur">
        <span className="gt-tip-dur-label">
          {intl.formatMessage({ id: "gantt.tip.planEffort" })}
        </span>
        <span className="gt-tip-dur-val">
          {fmtDuration(
            plannedSum ??
              effortFor(
                task.start,
                task.end,
                task.plannedEffortDays,
                task.plannedEffortHours,
                holidays
              )
          )}
        </span>
      </div>
    </div>
  );
}

/** 実績細バーの hover 内容（同上、開いた時だけ計算） */
function ActualTip({
  task,
  ongoing,
  holidays,
}: {
  task: Task;
  ongoing: boolean;
  holidays?: Set<string>;
}) {
  const intl = useIntl();
  if (ongoing) {
    return (
      <>
        {intl.formatMessage(
          { id: "gantt.actual.ongoing" },
          { start: fmt(task.actualStart as string, "MM/DD") }
        )}
      </>
    );
  }
  return (
    <>
      {intl.formatMessage(
        { id: "gantt.actual.range" },
        {
          start: fmt(task.actualStart as string, "MM/DD"),
          end: fmt(task.actualEnd as string, "MM/DD"),
          dur: fmtDuration(
            effortFor(
              task.actualStart as string,
              task.actualEnd as string,
              task.actualEffortDays,
              task.actualEffortHours,
              holidays
            )
          ),
        }
      )}
    </>
  );
}

export default function GanttChart({
  tasks,
  deps,
  memberMap,
  members,
  scale,
  holidays,
  plannedTotal,
  actualTotal,
  selectedId,
  keepIds,
  hitIds,
  keyword,
  onSelect,
  onToggle,
  onAddChild,
  onEdit,
  onDelete,
  onAssigneeChange,
}: Props) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  // 鼠标拖拽横向滚动（代替横向滚动条）
  const drag = useRef({
    active: false,
    startX: 0,
    startScroll: 0,
    moved: false,
  });

  const geom = useMemo(
    () => buildGeom(tasks, scale, holidays, keepIds),
    [tasks, scale, holidays, keepIds]
  );
  const bodyHeight = geom.rows.length * GANTT.rowHeight;

  // 周末阴影 & 今日线
  const days = useMemo(
    () => dateRange(geom.rangeStart, geom.rangeEnd),
    [geom.rangeStart, geom.rangeEnd]
  );
  const todayX = useMemo(() => {
    const day = dayjs().format("YYYY-MM-DD");
    if (day < geom.rangeStart || day > geom.rangeEnd) return null;
    // 纯日期模型：今日线落在当天列中央
    return geom.xOf(day) + geom.dayWidth / 2;
  }, [geom]);

  // 进入页面 / 切换比例时，将“今日”滚动到时间轴中央
  useEffect(() => {
    const el = rightRef.current;
    if (!el || geom.rows.length === 0) return;
    const day = dayjs().format("YYYY-MM-DD");
    const center =
      day < geom.rangeStart || day > geom.rangeEnd
        ? geom.contentWidth / 2
        : geom.xOf(day) + geom.dayWidth / 2;
    el.scrollLeft = Math.max(0, center - el.clientWidth / 2);
  }, [geom]);

  // 悬停左侧任务行 → 右侧对应甘特条（及其依赖连线）套用「选中」高亮
  const [hoverId, setHoverId] = useState<string>();
  const highlight = useMemo(() => {
    const ids = new Set<string>();
    if (selectedId) ids.add(selectedId);
    if (hoverId) ids.add(hoverId);
    return ids.size ? ids : undefined;
  }, [selectedId, hoverId]);

  const syncFrom = (src: "l" | "r") => {
    if (lock.current) return;
    lock.current = true;
    if (src === "r" && leftRef.current && rightRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop;
    } else if (src === "l" && leftRef.current && rightRef.current) {
      rightRef.current.scrollTop = leftRef.current.scrollTop;
    }
    requestAnimationFrame(() => (lock.current = false));
  };

  const onDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 只接管左键拖动；忽略表单/可交互元素上的起手
    if (e.button !== 0 || !rightRef.current) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      startScroll: rightRef.current.scrollLeft,
      moved: false,
    };
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active || !rightRef.current) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      rightRef.current.classList.add("gt-grabbing");
      rightRef.current.setPointerCapture(e.pointerId);
    }
    if (d.moved) rightRef.current.scrollLeft = d.startScroll - dx;
  };

  const onDragUp = () => {
    if (rightRef.current) rightRef.current.classList.remove("gt-grabbing");
    drag.current.active = false;
  };

  // 拖动后吞掉这次 click，避免误触选中条形
  const onDragClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  return (
    <div className="gt-wrap">
      <div className="gt-left" ref={leftRef} onScroll={() => syncFrom("l")}>
        <TaskTreeTable
          rows={geom.rows}
          assigneeAgg={geom.assigneeAgg}
          effortAgg={geom.effortAgg}
          memberMap={memberMap}
          members={members}
          holidays={holidays}
          plannedTotal={plannedTotal}
          actualTotal={actualTotal}
          selectedId={selectedId}
          hitIds={hitIds}
          keyword={keyword}
          onHover={setHoverId}
          onToggle={onToggle}
          onSelect={onSelect}
          onAddChild={onAddChild}
          onEdit={onEdit}
          onDelete={onDelete}
          onAssigneeChange={onAssigneeChange}
        />
      </div>

      <div
        className="gt-right gt-grab"
        ref={rightRef}
        onScroll={() => syncFrom("r")}
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
        onClickCapture={onDragClickCapture}
      >
        <div style={{ width: geom.contentWidth }}>
          <TimelineHeader geom={geom} scale={scale} holidays={holidays} />
          <div
            className="gt-body"
            style={{
              width: geom.contentWidth,
              height: bodyHeight,
              backgroundSize: `${geom.dayWidth}px ${GANTT.rowHeight}px`,
            }}
          >
            {/* 周末灰底 / 红日子（祝日）红底；红日子优先 */}
            {days.map((day, i) => {
              const holiday = isHolidayDate(day.format("YYYY-MM-DD"), holidays);
              const weekend = isWeekend(day);
              if (!holiday && !weekend) return null;
              return (
                <div
                  key={i}
                  className={holiday ? "gt-holiday-col" : "gt-weekend-col"}
                  style={{ left: i * geom.dayWidth, width: geom.dayWidth }}
                />
              );
            })}

            {/* 今日线 */}
            {todayX !== null && (
              <div className="gt-today" style={{ left: todayX }}>
                <span className="gt-today-dot" />
              </div>
            )}

            {/* 依赖连线 */}
            <DependencyLines
              deps={deps}
              geom={geom}
              height={bodyHeight}
              highlightIds={highlight}
            />

            {/* 条形 */}
            {geom.rows.map((row, i) => {
              const t = row.task;
              const { left, width } = geom.barOf(t);
              const top = i * GANTT.rowHeight;
              const sel = selectedId === t.id || hoverId === t.id;

              if (t.type === "milestone") {
                return (
                  <Tooltip
                    key={t.id}
                    title={`${t.name} · ${fmt(t.start, "MM/DD")}`}
                  >
                    <div
                      className={`gt-ms ${sel ? "gt-bar-sel" : ""}`}
                      style={{
                        left: left - 7,
                        top: top + (GANTT.rowHeight - 14) / 2,
                      }}
                      onClick={() => onSelect(t.id)}
                    />
                  </Tooltip>
                );
              }

              if (t.type === "summary") {
                return (
                  <div
                    key={t.id}
                    className={`gt-summary ${sel ? "gt-bar-sel" : ""}`}
                    style={{
                      left,
                      width,
                      top: top + (GANTT.rowHeight - 8) / 2,
                    }}
                    onClick={() => onSelect(t.id)}
                  >
                    <span className="gt-summary-label">{t.progress}%</span>
                  </div>
                );
              }

              return (
                <div
                  key={t.id}
                  className={`gt-bar-row`}
                  style={{ left, top: top + (GANTT.rowHeight - 14) / 2 }}
                  onClick={() => onSelect(t.id)}
                >
                  <Popover
                    overlayClassName="gt-pop"
                    mouseEnterDelay={0.15}
                    title={<div className="gt-tip-name">{t.name}</div>}
                    content={
                      <BarTip
                        task={t}
                        holidays={holidays}
                        plannedSum={geom.effortAgg.get(t.id)?.planned}
                      />
                    }
                  >
                    <div
                      className={`gt-bar ${sel ? "gt-bar-sel" : ""}`}
                      style={{ width }}
                    >
                      <div
                        className="gt-bar-fill"
                        style={{ width: `${t.progress}%` }}
                      />
                    </div>
                  </Popover>
                  <span className="gt-bar-pct">{t.progress}%</span>
                </div>
              );
            })}

            {/* 实际时间细条（叠在计划条下方，对比计划 vs 实际） */}
            {geom.rows.map((row, i) => {
              const t = row.task;
              if (t.type === "milestone") return null;
              const ab = geom.actualBarOf(t);
              if (!ab) return null;
              const top = i * GANTT.rowHeight;
              return (
                <Tooltip
                  key={`actual-${t.id}`}
                  title={
                    <ActualTip
                      task={t}
                      ongoing={ab.ongoing}
                      holidays={holidays}
                    />
                  }
                >
                  <div
                    className={`gt-actual ${
                      t.type === "summary" ? "gt-actual-summary" : ""
                    } ${ab.ongoing ? "gt-actual-ongoing" : ""}`}
                    style={{
                      left: ab.left,
                      width: ab.width,
                      top: top + GANTT.rowHeight - 12,
                    }}
                    onClick={() => onSelect(t.id)}
                  />
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

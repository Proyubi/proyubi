import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "@umijs/max";
import { Badge, Empty, Popover, Spin, Tooltip } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import type { Member, WorkloadItem } from "../types";
import dayjs, { fmt } from "../utils/date";
import RoadmapTimelineHeader from "../roadmap/RoadmapTimelineHeader";
import "../roadmap/roadmap.css"; // 复用 rm-tl-* 时间轴表头样式
import {
  buildResourceGeom,
  detectConflicts,
  isBarItem,
  RESOURCE_DAY_SCALE_WIDTH,
  RESOURCE_DAY_WIDTH,
  type ResourceGeom,
  type ResourceRange,
} from "./resourceLayout";
import "./resource.css";

export type ResourceMode = "single" | "all";
/** 时间轴粒度：日（逐日标注）/ 周（按周标注，默认） */
export type ResourceScale = "day" | "week";

interface Props {
  mode: ResourceMode;
  /** 时间轴粒度（日 / 周）。默认 week */
  scale?: ResourceScale;
  loading: boolean;
  /** 当前模式下加载到的工时条目 */
  items: WorkloadItem[];
  /** 单人模式：当前选中成员 */
  member?: Member;
  /** 全员模式：成员查找表（按 color/name 渲染泳道） */
  members: Member[];
  /** 全员模式点击某成员行 → 切到单人 */
  onPickMember?: (memberId: string) => void;
  /** 点击任务（标签 / 甘特条）→ 打开编辑 */
  onEditTask?: (item: WorkloadItem) => void;
  /** 时间轴固定到某月窗（开始月~结束月）；不传则按任务期间自动算范围 */
  range?: ResourceRange | null;
}

/** 默认条色（成员无 color 时回退） */
const FALLBACK_COLOR = "#1677ff";

/** 已完成任务（进度 100%）统一用绿色条，与看板 done 状态色一致 */
const DONE_COLOR = "#52c41a";

/** 左侧标签列宽（与 CSS --rv-label-w 保持一致） */
const LABEL_W = 300;

export default function ResourceView({
  mode,
  scale = "week",
  loading,
  items,
  member,
  members,
  onPickMember,
  onEditTask,
  range,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  // 可视内容区宽度（滚动容器宽 - 标签列），用于在任务稀疏时把时间轴撑满，消除右侧空白
  const scrollRef = useRef<HTMLDivElement>(null);

  // 横向拖拽平移（与甘特图 gt-right 一致的手感）
  const drag = useRef({
    active: false,
    startX: 0,
    startScroll: 0,
    moved: false,
  });
  const onDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !scrollRef.current) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      startScroll: scrollRef.current.scrollLeft,
      moved: false,
    };
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active || !scrollRef.current) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      scrollRef.current.classList.add("rv-grabbing");
      scrollRef.current.setPointerCapture(e.pointerId);
    }
    if (d.moved) scrollRef.current.scrollLeft = d.startScroll - dx;
  };
  const onDragUp = () => {
    if (scrollRef.current) scrollRef.current.classList.remove("rv-grabbing");
    drag.current.active = false;
  };
  // 拖动后吞掉这次 click，避免误触（如点击成员行切换单人）
  const onDragClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  const [availWidth, setAvailWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setAvailWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 每日基准像素：日粒度更宽以便逐日标注，周粒度维持紧凑
  const baseDayWidth =
    scale === "day" ? RESOURCE_DAY_SCALE_WIDTH : RESOURCE_DAY_WIDTH;

  // 固定时间窗时，只保留与窗口有交集的任务/里程碑：完全落在窗外的不进列表，
  // 避免左侧出现一串空行（窗内无任务时直接走空状态）。range 为空（自动）则全保留。
  const visibleItems = useMemo(() => {
    if (!range) return items;
    const winStart = dayjs(range.start).startOf("month").format("YYYY-MM-DD");
    const winEnd = dayjs(range.end).endOf("month").format("YYYY-MM-DD");
    return items.filter((it) => {
      if (it.type === "milestone")
        return !!it.start && it.start >= winStart && it.start <= winEnd;
      // 任务：需有完整起止且与窗口区间相交
      if (!it.start || !it.end) return false;
      return it.start <= winEnd && it.end >= winStart;
    });
  }, [items, range]);

  const geom = useMemo(() => {
    // 先按基准像素比例算一遍，拿到总天数与范围
    const base = buildResourceGeom(visibleItems, baseDayWidth, range);
    // 内容比可视区窄时，放大每日像素以填满（留 2px 余量避免触发横向滚动）
    const avail = Math.max(0, availWidth - LABEL_W - 2);
    if (base.totalDays <= 0 || avail <= 0) return base;
    const fitWidth = avail / base.totalDays;
    if (fitWidth <= baseDayWidth) return base; // 范围很长（如跨年）时维持基准并允许横向滚动
    return buildResourceGeom(visibleItems, fitWidth, range);
  }, [visibleItems, range, availWidth, baseDayWidth]);

  // 今日竖线：仅当今天落在可视范围内
  const today = dayjs().format("YYYY-MM-DD");
  const showToday = today >= geom.rangeStart && today <= geom.rangeEnd;
  const todayX = geom.xOf(today);

  // 进入/切换范围后，把横向滚动条定位到「今日」居中
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !showToday) return;
    // 让今日落在「标签列右侧的内容可视区」正中
    const target = todayX - (el.clientWidth - LABEL_W) / 2;
    el.scrollLeft = Math.max(0, target);
  }, [
    geom.rangeStart,
    geom.rangeEnd,
    geom.dayWidth,
    showToday,
    todayX,
    loading,
  ]);

  if (loading) {
    return (
      <div className="rv-wrap">
        <div style={{ textAlign: "center", padding: "120px 0" }}>
          <Spin size="large" />
        </div>
      </div>
    );
  }

  if (mode === "single" && !member) {
    return (
      <div className="rv-wrap">
        <Empty
          className="rv-empty"
          description={t("resources.selectMemberFirst")}
        />
      </div>
    );
  }

  const barItems = visibleItems.filter(isBarItem);
  const hasMilestones = visibleItems.some(
    (it) => it.type === "milestone" && it.start
  );
  if (barItems.length === 0 && !hasMilestones) {
    return (
      <div className="rv-wrap">
        <Empty
          className="rv-empty"
          description={t(
            mode === "all" ? "resources.allEmpty" : "resources.empty"
          )}
        />
      </div>
    );
  }

  return (
    <div className="rv-wrap">
      <div
        className="rv-scroll rv-grab"
        ref={scrollRef}
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
        onClickCapture={onDragClickCapture}
      >
        <div className="rv-grid" style={{ width: geom.contentWidth + LABEL_W }}>
          {/* 今日竖线：贯穿任务区（表头与左侧标签列会遮挡两端） */}
          {showToday && (
            <div className="rv-today" style={{ left: LABEL_W + todayX }} />
          )}
          {/* 表头：标签占位 + 三层时间轴 */}
          <div className="rv-head-row">
            <div className="rv-head-corner" />
            <RoadmapTimelineHeader
              rangeStart={geom.rangeStart}
              rangeEnd={geom.rangeEnd}
              dayWidth={geom.dayWidth}
              contentWidth={geom.contentWidth}
              showWeeks={scale === "week"}
              showDays={scale === "day"}
            />
          </div>

          {mode === "single" ? (
            <SingleBody
              items={visibleItems}
              color={member?.color ?? FALLBACK_COLOR}
              geom={geom}
              onEditTask={onEditTask}
            />
          ) : (
            <AllBody
              items={visibleItems}
              members={members}
              geom={geom}
              onPickMember={onPickMember}
              onEditTask={onEditTask}
            />
          )}
        </div>
      </div>

      {/* 图例：撞期说明 */}
      <div className="rv-legend">
        <span className="rv-legend-item">
          <span className="rv-legend-swatch" />
          {t("resources.conflict.legend")}
        </span>
      </div>
    </div>
  );
}

// ===================== 单人模式：按 客户→项目 分组 =====================

interface Group {
  customerId: string;
  customerName: string;
  projects: { projectId: string; projectName: string; items: WorkloadItem[] }[];
}

function SingleBody({
  items,
  color,
  geom,
  onEditTask,
}: {
  items: WorkloadItem[];
  color: string;
  geom: ResourceGeom;
  onEditTask?: (item: WorkloadItem) => void;
}) {
  // 该成员任务整体做撞期检测（跨客户 / 跨项目都算冲突）
  const conflicts = useMemo(() => detectConflicts(items), [items]);

  const groups = useMemo(() => {
    const byCust = new Map<string, Group>();
    for (const it of items) {
      let g = byCust.get(it.customerId);
      if (!g) {
        g = {
          customerId: it.customerId,
          customerName: it.customerName,
          projects: [],
        };
        byCust.set(it.customerId, g);
      }
      let p = g.projects.find((x) => x.projectId === it.projectId);
      if (!p) {
        p = { projectId: it.projectId, projectName: it.projectName, items: [] };
        g.projects.push(p);
      }
      p.items.push(it);
    }
    // 项目内任务按开始日期排序（无日期沉底）
    const cmp = (a: WorkloadItem, b: WorkloadItem) => {
      const as = a.start ?? "9999-99-99";
      const bs = b.start ?? "9999-99-99";
      return as < bs ? -1 : as > bs ? 1 : 0;
    };
    for (const g of byCust.values())
      for (const p of g.projects) p.items.sort(cmp);
    return Array.from(byCust.values()).sort((a, b) =>
      a.customerName.localeCompare(b.customerName)
    );
  }, [items]);

  return (
    <>
      {groups.map((g) => (
        <div key={g.customerId}>
          <div
            className="rv-group rv-group-customer"
            style={{ width: geom.contentWidth + LABEL_W }}
          >
            <span className="rv-group-text">{g.customerName}</span>
          </div>
          {g.projects.map((p) => (
            <div key={p.projectId}>
              <div
                className="rv-group rv-group-project"
                style={{ width: geom.contentWidth + LABEL_W }}
              >
                <span className="rv-group-text">{p.projectName}</span>
              </div>
              {p.items.map((it) => (
                <TaskRow
                  key={it.taskId}
                  item={it}
                  color={color}
                  geom={geom}
                  conflict={conflicts.has(it.taskId)}
                  onEditTask={onEditTask}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// ===================== 全员模式：每成员一泳道 =====================

function AllBody({
  items,
  members,
  geom,
  onPickMember,
  onEditTask,
}: {
  items: WorkloadItem[];
  members: Member[];
  geom: ResourceGeom;
  onPickMember?: (memberId: string) => void;
  onEditTask?: (item: WorkloadItem) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  // 按成员归集任务（一个任务可挂多个成员 → 每个成员行都出现）
  const byMember = useMemo(() => {
    const m = new Map<string, WorkloadItem[]>();
    for (const it of items) {
      for (const mid of it.assigneeIds) {
        const arr = m.get(mid) ?? [];
        arr.push(it);
        m.set(mid, arr);
      }
    }
    return m;
  }, [items]);

  // 每个成员各自撞期检测
  const conflictByMember = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [mid, arr] of byMember) m.set(mid, detectConflicts(arr));
    return m;
  }, [byMember]);

  // 仅展示有任务的成员，按成员列表顺序
  const rows = members.filter((mb) => (byMember.get(mb.id)?.length ?? 0) > 0);

  return (
    <>
      {rows.map((mb) => {
        const memberItems = byMember.get(mb.id) ?? [];
        const conflicts = conflictByMember.get(mb.id) ?? new Set<string>();
        const conflictCount = conflicts.size;
        return (
          <div className="rv-lane" key={mb.id}>
            <Tooltip title={t("resources.openDetail")}>
              <button
                type="button"
                className="rv-lane-label"
                onClick={() => onPickMember?.(mb.id)}
              >
                <span
                  className="rv-dot"
                  style={{ background: mb.color || FALLBACK_COLOR }}
                />
                <span className="rv-lane-name">{mb.name}</span>
                {conflictCount > 0 && (
                  <Tooltip
                    title={t("resources.conflict.tip", {
                      count: conflictCount,
                    })}
                  >
                    <Badge
                      count={<WarningOutlined style={{ color: "#f5222d" }} />}
                    />
                  </Tooltip>
                )}
              </button>
            </Tooltip>
            <div
              className="rv-track"
              style={{
                width: geom.contentWidth,
                backgroundSize: `${geom.dayWidth * 7}px 100%`,
              }}
            >
              {memberItems.map((it) =>
                it.type === "milestone" ? (
                  <MilestoneMark key={it.taskId} item={it} geom={geom} />
                ) : (
                  isBarItem(it) && (
                    <Bar
                      key={it.taskId}
                      item={it}
                      color={mb.color || FALLBACK_COLOR}
                      geom={geom}
                      conflict={conflicts.has(it.taskId)}
                      label={it.name}
                      onEditTask={onEditTask}
                    />
                  )
                )
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ===================== 行 / 条 / 里程碑 =====================

function TaskRow({
  item,
  color,
  geom,
  conflict,
  onEditTask,
}: {
  item: WorkloadItem;
  color: string;
  geom: ResourceGeom;
  conflict: boolean;
  onEditTask?: (item: WorkloadItem) => void;
}) {
  const intl = useIntl();
  const noSchedule = intl.formatMessage({ id: "resources.noSchedule" });
  return (
    <div className="rv-row">
      <div className="rv-label">
        {onEditTask ? (
          <Tooltip title={intl.formatMessage({ id: "resources.editTask" })}>
            <button
              type="button"
              className="rv-label-edit"
              title={item.name}
              onClick={() => onEditTask(item)}
            >
              {item.name}
            </button>
          </Tooltip>
        ) : (
          <span className="rv-label-name" title={item.name}>
            {item.name}
          </span>
        )}
      </div>
      <div
        className="rv-track"
        style={{
          width: geom.contentWidth,
          backgroundSize: `${geom.dayWidth * 7}px 100%`,
          // 把每 7 天的网格线推到周一，与表头周列 / 今日竖线对齐
          backgroundPositionX: `${geom.weekLineOffsetPx}px`,
        }}
      >
        {item.type === "milestone" ? (
          item.start && <MilestoneMark item={item} geom={geom} />
        ) : isBarItem(item) ? (
          <Bar
            item={item}
            color={color}
            geom={geom}
            conflict={conflict}
            onEditTask={onEditTask}
          />
        ) : (
          <span
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 11,
              color: "#aab2c0",
            }}
          >
            {noSchedule}
          </span>
        )}
      </div>
    </div>
  );
}

function Bar({
  item,
  color,
  geom,
  conflict,
  label,
  onEditTask,
}: {
  item: WorkloadItem;
  color: string;
  geom: ResourceGeom;
  conflict: boolean;
  label?: string;
  onEditTask?: (item: WorkloadItem) => void;
}) {
  const bar = geom.barOf(item);
  if (!bar || bar.width <= 0) return null;
  const pct = Math.max(0, Math.min(100, item.progress ?? 0));
  // 已完成（100%）的任务条统一用绿色，方便横断扫一眼区分
  const barColor = pct >= 100 ? DONE_COLOR : color;
  const popTitle = (
    <div className="rv-tip-head">
      <div className="rv-tip-path">
        {item.customerName} / {item.projectName}
      </div>
      <div className="rv-tip-name">{item.name}</div>
    </div>
  );
  const popContent = (
    <div className="rv-tip-meta">
      <span className="rv-tip-date">
        {fmt(item.start as string, "YYYY/MM/DD")} ~{" "}
        {fmt(item.end as string, "YYYY/MM/DD")}
      </span>
      <span className="rv-tip-pct" style={{ background: barColor }}>
        {pct}%
      </span>
    </div>
  );
  return (
    <Popover
      title={popTitle}
      content={popContent}
      overlayClassName="rv-pop"
      mouseEnterDelay={0.15}
    >
      <div
        className={`rv-bar${conflict ? " is-conflict" : ""}${
          onEditTask ? " is-clickable" : ""
        }`}
        style={{ left: bar.left, width: bar.width, background: barColor }}
        onClick={onEditTask ? () => onEditTask(item) : undefined}
      >
        {pct > 0 && (
          <span className="rv-bar-fill" style={{ width: `${pct}%` }} />
        )}
        <span className="rv-bar-text">
          {label ? `${label} ` : ""}
          <span className="rv-bar-pct">{pct}%</span>
        </span>
      </div>
    </Popover>
  );
}

function MilestoneMark({
  item,
  geom,
}: {
  item: WorkloadItem;
  geom: ResourceGeom;
}) {
  if (!item.start) return null;
  const x = geom.xOf(item.start);
  // 限定时间窗下越界的里程碑不画
  if (x < 0 || x > geom.contentWidth) return null;
  return (
    <Tooltip title={`${item.name} · ${fmt(item.start, "YYYY/MM/DD")}`}>
      <span className="rv-ms" style={{ left: x }} />
    </Tooltip>
  );
}

import {
  FullscreenExitOutlined,
  FullscreenOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { PageContainer } from "@ant-design/pro-components";
import { useIntl, useNavigate, useSearchParams } from "@umijs/max";
import {
  Button,
  Calendar,
  Card,
  Empty,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import type { Dayjs } from "dayjs";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getCalendar, getEvents } from "@/pm/api";
import { useData } from "@/pm/store";
import type {
  CalendarTask,
  PmCalendarVO,
  PmEvent,
  PmEventType,
  RiskKind,
} from "@/pm/types";
import dayjs, { isWeekend } from "@/pm/utils/date";
import EventDrawer from "./EventDrawer";
import "./index.css";

type ViewMode = "all" | "me";
/** 内容过滤：全部 / 仅任务 / 仅事件 */
type ContentFilter = "all" | "task" | "event";

/**
 * 多风险命中时徽标 / 着色顺序（与后端 PmOverviewService.RISK_PRIORITY 一致）。
 * 不 import overview 页，就近复制——日历只负责按种别取色展示，风险判定全在服务端。
 */
const RISK_PRIORITY: RiskKind[] = [
  "overdue",
  "blocked",
  "behind",
  "due-soon",
  "unassigned",
];

const RISK_COLOR: Record<RiskKind, string> = {
  overdue: "error",
  blocked: "volcano",
  behind: "warning",
  "due-soon": "gold",
  unassigned: "default",
};

/** 事件类型色系（独立于 task 风险色，两套同框互不串色） */
const EVENT_TYPES: PmEventType[] = [
  "meeting",
  "review",
  "milestone",
  "deadline",
  "other",
];

const EVENT_COLOR: Record<PmEventType, string> = {
  meeting: "blue",
  review: "purple",
  milestone: "green",
  deadline: "red",
  other: "default",
};

const EMPTY_CALENDAR: PmCalendarVO = { meMemberId: null, tasks: [] };

/** 按 RISK_PRIORITY 取主风险（无风险返回 null） */
function primaryRisk(kinds: RiskKind[]): RiskKind | null {
  for (const k of RISK_PRIORITY) {
    if (kinds.includes(k)) return k;
  }
  return null;
}

export default function CalendarPage() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const nav = useNavigate();
  const { ensureBase, baseLoaded, holidays, holidayList } = useData();
  const [sp] = useSearchParams();

  // 红日子日期 → 祝日名（格内 tooltip 展示）
  const holidayNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holidayList) m.set(h.holidayDate, h.name);
    return m;
  }, [holidayList]);

  const [mode, setMode] = useState<ViewMode>("all");
  // 内容过滤：全部 / 仅任务 / 仅事件
  const [content, setContent] = useState<ContentFilter>("all");
  // 受控月份：翻月时按当前可见月重新请求区间
  const [month, setMonth] = useState<Dayjs>(() => dayjs());
  const [data, setData] = useState<PmCalendarVO>(EMPTY_CALENDAR);
  const [events, setEvents] = useState<PmEvent[]>([]);
  const [loading, setLoading] = useState(false);
  // 事件列表刷新触发器（保存/删除后 bump）
  const [eventRefresh, setEventRefresh] = useState(0);

  // 抽屉状态：编辑既有事件 / 新建（带默认日期）
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<PmEvent | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);
  // 深链 ?eventId= 仅自动打开一次
  const deepLinkDone = useRef(false);

  // 全屏：对日历容器调浏览器 Fullscreen API
  const fsRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      fsRef.current?.requestFullscreen();
    }
  };

  // 基础数据（成员等）——与 Overview 一致，懒加载
  useEffect(() => {
    ensureBase();
  }, [ensureBase]);

  // 防止过期响应覆盖最新（翻月/切 scope 连点）
  const reqSeq = useRef(0);
  useEffect(() => {
    // 拉到日历首尾周的邻月任务：覆盖可视网格（含上/下月溢出格）。
    // 注意：全局 dayjs locale 是 zh-cn（周一起），而 antd Calendar 按日本区 locale 渲染（周日起），
    // 两者 week-start 不一致——直接用 dayjs.startOf('week') 会比可视网格少算一天
    // （如 6 月网格首格 5/31 落在请求区间外，该天事件不显示）。
    // 故按可视网格自身口径算区间：周日起、固定 6 周（42 格）。day() 恒以周日=0，与 locale 无关。
    const first = month.startOf("month");
    const gridStart = first.subtract(first.day(), "day");
    const from = gridStart.format("YYYY-MM-DD");
    // +42 天覆盖 6 周网格并留 1 天余量（兼容 locale 切到周一起时网格右移）；多取无害，单元格不渲染即可。
    const to = gridStart.add(42, "day").format("YYYY-MM-DD");
    const seq = ++reqSeq.current;
    setLoading(true);
    // task 与 event 并行拉取，同一 reqSeq 防过期覆盖
    Promise.all([getCalendar(from, to, mode), getEvents(from, to, mode)])
      .then(([cal, evs]) => {
        if (seq !== reqSeq.current) return;
        setData(cal ?? EMPTY_CALENDAR);
        setEvents(Array.isArray(evs) ? evs : []);
      })
      .finally(() => {
        if (seq === reqSeq.current) setLoading(false);
      });
  }, [mode, month, eventRefresh]);

  const { tasks, meMemberId } = data;
  const notMember = mode === "me" && meMemberId == null && !loading;

  const goTask = (task: CalendarTask) =>
    nav(`/projects/${task.projectId}/gantt?taskId=${task.taskId}`);

  const openCreate = (date: Dayjs) => {
    setEditing(null);
    setCreateDate(date.format("YYYY-MM-DD"));
    setDrawerOpen(true);
  };

  const openEdit = (ev: PmEvent) => {
    setEditing(ev);
    setCreateDate(null);
    setDrawerOpen(true);
  };

  // 深链：events 加载后，?eventId= 命中则自动打开编辑抽屉（一次性）
  useEffect(() => {
    if (deepLinkDone.current) return;
    const id = sp.get("eventId");
    if (!id || events.length === 0) return;
    const found = events.find((e) => e.id === id);
    if (found) {
      deepLinkDone.current = true;
      openEdit(found);
    }
  }, [sp, events]);

  // 可视网格区间（周日起、6 周 42 格）：预聚合的展开范围，避免超长跨度事件膨胀。
  const gridStart = useMemo(() => {
    const first = month.startOf("month");
    return first.subtract(first.day(), "day");
  }, [month]);
  const gridEnd = useMemo(() => gridStart.add(41, "day"), [gridStart]);

  /**
   * 预聚合：把任务/事件按区间展开成 Map<YYYY-MM-DD, items[]>，渲染时每格 O(1) 查表，
   * 替代原先每格各自 filter 全量数组（O(格×条目)）。展开范围 clamp 到可视网格。
   * 任务沿用工期口径：非工作日（周六日/红日子）不渲染；事件不受此限。
   */
  const tasksByDay = useMemo(() => {
    const m = new Map<string, CalendarTask[]>();
    for (const task of tasks) {
      if (!task.start || !task.end) continue;
      let d = dayjs(task.start).startOf("day");
      let end = dayjs(task.end).startOf("day");
      if (d.isBefore(gridStart)) d = gridStart;
      if (end.isAfter(gridEnd)) end = gridEnd;
      for (; !d.isAfter(end); d = d.add(1, "day")) {
        const iso = d.format("YYYY-MM-DD");
        if (isWeekend(d) || holidays.has(iso)) continue;
        const arr = m.get(iso);
        if (arr) arr.push(task);
        else m.set(iso, [task]);
      }
    }
    return m;
  }, [tasks, holidays, gridStart, gridEnd]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, PmEvent[]>();
    for (const ev of events) {
      if (!ev.startAt) continue;
      let d = dayjs(ev.startAt).startOf("day");
      let end = dayjs(ev.endAt ?? ev.startAt).startOf("day");
      if (d.isBefore(gridStart)) d = gridStart;
      if (end.isAfter(gridEnd)) end = gridEnd;
      for (; !d.isAfter(end); d = d.add(1, "day")) {
        const iso = d.format("YYYY-MM-DD");
        const arr = m.get(iso);
        if (arr) arr.push(ev);
        else m.set(iso, [ev]);
      }
    }
    return m;
  }, [events, gridStart, gridEnd]);

  const tasksOn = (date: Dayjs): CalendarTask[] =>
    tasksByDay.get(date.format("YYYY-MM-DD")) ?? [];
  const eventsOn = (date: Dayjs): PmEvent[] =>
    eventsByDay.get(date.format("YYYY-MM-DD")) ?? [];

  // 内容过滤：仅事件时不渲染任务，仅任务时不渲染事件
  const renderCell = (date: Dayjs) => {
    const items = content === "event" ? [] : tasksOn(date);
    const evs = content === "task" ? [] : eventsOn(date);
    // 点击交给外层整格（空白处新建当天事件）；task/event 子项各自 stopPropagation
    return (
      <div className="cal-cell">
        {items.map((task) => {
          const primary = primaryRisk(task.riskKinds);
          const done = task.progress >= 100;
          const cls = [
            "cal-item",
            done ? "is-done" : "",
            primary === "overdue" ? "is-overdue" : primary ? "is-risk" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <Tooltip key={task.taskId} title={task.projectName}>
              <div
                className={cls}
                onClick={(ev) => {
                  ev.stopPropagation();
                  goTask(task);
                }}
              >
                <span className="cal-item-name">{task.name}</span>
                {primary && (
                  <Tag
                    className="cal-item-badge"
                    color={RISK_COLOR[primary]}
                    variant="filled"
                    bordered={false}
                  >
                    {t(`overview.kind.${primary}`)}
                  </Tag>
                )}
              </div>
            </Tooltip>
          );
        })}
        {evs.map((ev) => (
          <Tooltip key={ev.id} title={ev.projectName ?? undefined}>
            <div
              className="cal-event"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(ev);
              }}
            >
              <Tag
                className="cal-item-badge"
                color={EVENT_COLOR[ev.type]}
                bordered={false}
              >
                {t(`event.type.${ev.type}`)}
              </Tag>
              <span className="cal-item-name">{ev.title}</span>
            </div>
          </Tooltip>
        ))}
      </div>
    );
  };

  // 自绘整格：日期数字按 周日/祝日=红、周六=蓝、今天=高亮，整格淡底色；点空白处新建事件
  const renderFullCell = (
    date: Dayjs,
    info: { type: string; originNode: ReactNode }
  ) => {
    if (info.type !== "date") return info.originNode;
    const iso = date.format("YYYY-MM-DD");
    const dow = date.day();
    const isHol = holidays.has(iso);
    const isToday = date.isSame(dayjs(), "day");
    const inMonth =
      date.month() === month.month() && date.year() === month.year();
    const tone = isHol || dow === 0 ? "is-sun" : dow === 6 ? "is-sat" : "";
    const cls = [
      "cal-fullcell",
      isToday ? "is-today" : "",
      inMonth ? "" : "is-outmonth",
      tone,
      isHol ? "is-holiday" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const holName = holidayNameMap.get(iso);
    return (
      <div className={cls} onClick={() => openCreate(date)}>
        <div className="cal-date-row">
          <span className="cal-date">{date.date()}</span>
          {holName && (
            <Tooltip title={holName}>
              <span className="cal-holiday-name">{holName}</span>
            </Tooltip>
          )}
        </div>
        {renderCell(date)}
      </div>
    );
  };

  // 头部：‹ 上月 / 年月 / 下月 › + 今天 + 内容过滤（全部/仅任务/仅事件）
  const renderHeader = ({
    value,
    onChange,
  }: {
    value: Dayjs;
    onChange: (d: Dayjs) => void;
  }) => (
    <div className="cal-header">
      <Button
        type="text"
        size="small"
        icon={<LeftOutlined />}
        onClick={() => onChange(value.subtract(1, "month"))}
      />
      <span className="cal-header-label">
        {intl.formatDate(value.toDate(), { year: "numeric", month: "long" })}
      </span>
      <Button
        type="text"
        size="small"
        icon={<RightOutlined />}
        onClick={() => onChange(value.add(1, "month"))}
      />
      <Button size="small" onClick={() => onChange(dayjs())}>
        {t("calendar.today")}
      </Button>
      <Tooltip
        title={isFs ? t("calendar.fullscreenExit") : t("calendar.fullscreen")}
      >
        <Button
          type="text"
          size="small"
          icon={isFs ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onClick={toggleFs}
        />
      </Tooltip>
      <Segmented<ContentFilter>
        className="cal-header-filter"
        size="small"
        value={content}
        onChange={(v) => setContent(v)}
        options={[
          { value: "all", label: t("calendar.filter.all") },
          { value: "task", label: t("calendar.filter.task") },
          { value: "event", label: t("calendar.filter.event") },
        ]}
      />
    </div>
  );

  return (
    <PageContainer
      title={t("calendar.title")}
      subTitle={t("calendar.subtitle")}
      extra={[
        <Segmented<ViewMode>
          key="mode"
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: "all", label: t("calendar.view.all") },
            { value: "me", label: t("calendar.view.member") },
          ]}
        />,
      ]}
    >
      {!baseLoaded ? (
        <div className="cal-loading">
          <Spin size="large" />
        </div>
      ) : notMember ? (
        <Empty
          style={{ padding: "80px 0" }}
          description={t("calendar.notMember")}
        />
      ) : (
        <Spin spinning={loading}>
          {/* 全屏容器：调浏览器 Fullscreen API；全屏时格子不限高、铺满屏 */}
          <div ref={fsRef} className="cal-fs-wrap">
            <Card size="small" className="cal-card">
              {/* 事件类型图例（5 色对应 5 类型）；「仅任务」时隐藏 */}
              {content !== "task" && (
                <div className="cal-legend">
                  <span className="cal-legend-title">{t("event.legend")}</span>
                  <Space size={4} wrap>
                    {EVENT_TYPES.map((type) => (
                      <Tag
                        key={type}
                        color={EVENT_COLOR[type]}
                        bordered={false}
                      >
                        {t(`event.type.${type}`)}
                      </Tag>
                    ))}
                  </Space>
                </div>
              )}
              <div className="cal-body">
                {!loading && tasks.length === 0 && events.length === 0 && (
                  <div className="cal-empty-hint">{t("calendar.empty")}</div>
                )}
                <Calendar
                  value={month}
                  onPanelChange={(value) => setMonth(value)}
                  onChange={(value) => setMonth(value)}
                  headerRender={renderHeader}
                  fullCellRender={renderFullCell}
                />
              </div>
            </Card>
          </div>
        </Spin>
      )}

      <EventDrawer
        open={drawerOpen}
        event={editing}
        defaultDate={createDate}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => setEventRefresh((n) => n + 1)}
      />
    </PageContainer>
  );
}

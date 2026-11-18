import { useEffect, useMemo, useState } from "react";
import { useIntl } from "@umijs/max";
import { Empty, Spin } from "antd";
import type { RoadmapItem, RoadmapOptionDef } from "../types";
import { getRoadmap } from "../api";
import { useData } from "../store";
import { fmt } from "../utils/date";
import RoadmapTimelineHeader from "./RoadmapTimelineHeader";
import { buildRoadmapGeom, ROADMAP_DAY_WIDTH } from "./roadmapLayout";
import "./roadmap.css";

/** 默认泳道兜底 key（roadmapLane 为空或未匹配任何已定义泳道的条目归此） */
const DEFAULT_LANE = "__default__";
/** 阶段条无泳道色时的兜底灰 */
const PHASE_FALLBACK = "#94a3b8";
/** 里程碑无颜色时的兜底灰 */
const MS_FALLBACK = "#8c8c8c";

interface RoadmapOptionsPayload {
  lanes: RoadmapOptionDef[];
  msColors: RoadmapOptionDef[];
}

interface Props {
  /** 直接传入已加载的路线图数据（受控）。 */
  items?: RoadmapItem[];
  projectStart?: string | null;
  projectEnd?: string | null;
  /** 受控模式下的字典定义（顺序+颜色+标签） */
  options?: RoadmapOptionsPayload;
  /**
   * 未传 items 时，按 projectId 自行拉取 getRoadmap（只读视图）。
   * 优先用后端端点以保证 rollup 与甘特一致。
   */
  projectId?: string;
  /** 每日像素宽，覆盖默认月粒度 */
  dayWidth?: number;
}

export default function RoadmapView({
  items: itemsProp,
  projectStart: startProp,
  projectEnd: endProp,
  options: optionsProp,
  projectId,
  dayWidth = ROADMAP_DAY_WIDTH,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  // 泳道/里程碑色字典来自 store（租户级，管理弹窗编辑后实时反映）；
  // items 仍走 getRoadmap 以保证 rollup 与甘特一致。
  const { roadmapOptionsOf } = useData();

  const [fetched, setFetched] = useState<{
    items: RoadmapItem[];
    start: string;
    end: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // 受控（传了 items）则不自取；否则按 projectId 拉
  const controlled = itemsProp !== undefined;
  useEffect(() => {
    if (controlled || !projectId) return;
    let alive = true;
    setLoading(true);
    getRoadmap(projectId)
      .then((vo) => {
        if (!alive) return;
        setFetched({
          items: vo?.items ?? [],
          start: vo?.projectStart ?? "",
          end: vo?.projectEnd ?? "",
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [controlled, projectId]);

  const items = controlled ? itemsProp ?? [] : fetched?.items ?? [];
  const projectStart = controlled ? startProp : fetched?.start;
  const projectEnd = controlled ? endProp : fetched?.end;
  const storeOptionsToDefs = (kind: "lane" | "ms_color"): RoadmapOptionDef[] =>
    roadmapOptionsOf(kind).map((o) => ({
      key: o.optionKey,
      label: o.label,
      color: o.color,
      sortOrder: o.sortOrder,
    }));
  const laneDefs = controlled
    ? optionsProp?.lanes ?? []
    : storeOptionsToDefs("lane");
  const msColorDefs = controlled
    ? optionsProp?.msColors ?? []
    : storeOptionsToDefs("ms_color");

  const geom = useMemo(
    () => buildRoadmapGeom(items, projectStart, projectEnd, dayWidth),
    [items, projectStart, projectEnd, dayWidth]
  );

  /** 里程碑色 key → color */
  const msColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of msColorDefs) if (d.color) m.set(d.key, d.color);
    return m;
  }, [msColorDefs]);

  /** 按字典顺序分泳道；未匹配/空泳道的条目合并到末尾默认泳道 */
  const lanes = useMemo(() => {
    const byLane = new Map<string, RoadmapItem[]>();
    for (const it of items) {
      const key = it.roadmapLane ?? DEFAULT_LANE;
      const arr = byLane.get(key) ?? [];
      arr.push(it);
      byLane.set(key, arr);
    }
    const ordered: {
      key: string;
      color?: string | null;
      items: RoadmapItem[];
    }[] = [];
    for (const def of laneDefs) {
      const arr = byLane.get(def.key);
      if (arr) {
        ordered.push({ key: def.key, color: def.color, items: arr });
        byLane.delete(def.key);
      }
    }
    // 剩余（未定义泳道 / null）→ 合并到默认泳道
    const rest: RoadmapItem[] = [];
    for (const arr of byLane.values()) rest.push(...arr);
    if (rest.length) {
      ordered.push({ key: DEFAULT_LANE, color: null, items: rest });
    }
    return ordered;
  }, [items, laneDefs]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", marginTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rm-wrap">
        <Empty className="rm-empty" description={t("projects.roadmap.empty")} />
      </div>
    );
  }

  const laneLabel = (key: string) =>
    key === DEFAULT_LANE
      ? t("projects.roadmap.lane.default")
      : laneDefs.find((d) => d.key === key)?.label ?? key;

  return (
    <div className="rm-wrap">
      <div className="rm-scroll">
        <div style={{ width: geom.contentWidth + 120 }}>
          {/* 表头行：左侧泳道占位 + 三层时间轴 */}
          <div className="rm-head-row">
            <div className="rm-lane-corner" />
            <RoadmapTimelineHeader
              rangeStart={geom.rangeStart}
              rangeEnd={geom.rangeEnd}
              dayWidth={geom.dayWidth}
              contentWidth={geom.contentWidth}
            />
          </div>

          {/* 泳道行 */}
          {lanes.map(({ key, color, items: laneItems }) => (
            <div className="rm-lane" key={key}>
              <div className="rm-lane-label">{laneLabel(key)}</div>
              <div
                className="rm-lane-track"
                style={{
                  width: geom.contentWidth,
                  backgroundSize: `${geom.dayWidth * 7}px 100%`,
                }}
              >
                {laneItems.map((it) =>
                  it.type === "summary" ? (
                    <Phase
                      key={it.id}
                      item={it}
                      geom={geom}
                      color={color ?? undefined}
                    />
                  ) : (
                    <Milestone
                      key={it.id}
                      item={it}
                      geom={geom}
                      color={msColorMap.get(it.milestoneColor ?? "")}
                    />
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 图例：动态列出有颜色的泳道（名称 + 色块） */}
      {laneDefs.some((d) => d.color) && (
        <div className="rm-legend">
          {laneDefs
            .filter((d) => d.color)
            .map((d) => (
              <span className="rm-legend-item" key={d.key}>
                <span
                  className="rm-legend-swatch"
                  style={{ background: d.color ?? undefined }}
                />
                {d.label}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

function Phase({
  item,
  geom,
  color,
}: {
  item: RoadmapItem;
  geom: ReturnType<typeof buildRoadmapGeom>;
  color?: string;
}) {
  const { left, width } = geom.barOf(item);
  return (
    <div
      className="rm-phase"
      style={{ left, width, top: 10, background: color ?? PHASE_FALLBACK }}
      title={`${item.name} · ${fmt(item.start, "YYYY/MM/DD")}~${fmt(
        item.end,
        "YYYY/MM/DD"
      )} · ${item.progress}%`}
    >
      <span className="rm-phase-name">{item.name}</span>
    </div>
  );
}

function Milestone({
  item,
  geom,
  color,
}: {
  item: RoadmapItem;
  geom: ReturnType<typeof buildRoadmapGeom>;
  color?: string;
}) {
  const x = geom.xOf(item.start);
  return (
    <div
      className="rm-ms"
      style={{ left: x, top: 4 }}
      title={`${item.name} · ${fmt(item.start, "YYYY/MM/DD")}`}
    >
      <span
        className="rm-ms-tri"
        style={{ borderTopColor: color ?? MS_FALLBACK }}
      />
      <span className="rm-ms-meta">
        <span className="rm-ms-date">{fmt(item.start, "MM/DD")}</span>
        <br />
        <span className="rm-ms-name">{item.name}</span>
      </span>
    </div>
  );
}

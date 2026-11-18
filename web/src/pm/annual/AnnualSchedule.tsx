import { LeftOutlined, PlusOutlined, RightOutlined } from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { Button, DatePicker, Empty, Tag } from "antd";
import { useMemo, useState } from "react";
import {
  PROJECT_STATUS_META,
  type Project,
  type ProjectStatus,
} from "../types";
import dayjs, { fmt } from "../utils/date";
import "./annual.css";

interface Props {
  /** 选中客户/产品下的版本（Project）列表，已按 customerId 过滤 */
  projects: Project[];
  customerName?: string;
  /** 点版本名 / ↗ → 进入该版本甘特 */
  onOpenProject: (id: string) => void;
  /** 点色块 → 编辑该版本（周期 / 状态 / 名称） */
  onEditProject: (p: Project) => void;
  /** 新建版本（产品下的一次迭代） */
  onCreate: () => void;
}

const MONTH_W = 92; // 每月像素宽
const LABEL_W = 220; // 左侧版本名列宽
const ROW_H = 40;

/** 版本状态 → 色块底色（与列表页进度条/状态语义一致） */
const STATUS_COLOR: Record<ProjectStatus, string> = {
  planned: "#9aa4b2",
  active: "#2f6bff",
  done: "#52c41a",
  paused: "#faad14",
};

export default function AnnualSchedule({
  projects,
  customerName,
  onOpenProject,
  onEditProject,
  onCreate,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  const [year, setYear] = useState<number>(() => dayjs().year());

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  /** ISO 日期 → 年度内 x 像素（按月等宽 + 月内按日比例），并夹取到 [0, 12*MONTH_W] */
  const xOf = (iso: string): number => {
    const day = dayjs(iso);
    if (day.year() < year) return 0;
    if (day.year() > year) return 12 * MONTH_W;
    const frac = (day.date() - 1) / day.daysInMonth();
    return (day.month() + frac) * MONTH_W;
  };

  const contentWidth = 12 * MONTH_W;

  // 与本年度有交集的版本，按开始日排序
  // 終了日なし（運用型＝継続中）は「年度末まで伸びて右へ続く」帯として扱う。
  // ここで落とすと運用プロジェクトが年度スケジュールから消えてしまうため。
  const rows = useMemo(() => {
    return projects
      .filter(
        (p) =>
          p.start && p.start <= yearEnd && (!p.end || p.end >= yearStart)
      )
      .slice()
      .sort(
        (a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name)
      )
      .map((p) => {
        const ongoing = !p.end;
        const effEnd = p.end ?? yearEnd;
        const left = xOf(p.start < yearStart ? yearStart : p.start);
        // 闭区间结束：用「结束日 +1 天」的位置覆盖整个结束日
        const endX = xOf(dayjs(effEnd).add(1, "day").format("YYYY-MM-DD"));
        const right = Math.min(endX, contentWidth);
        const width = Math.max(right - left, 8);
        return {
          p,
          left,
          width,
          continuesLeft: p.start < yearStart,
          continuesRight: ongoing || effEnd > yearEnd,
          // 发布日（结束日）落在本年度内 → 画 ▼（継続中は納品日がないので出さない）
          releaseX:
            !ongoing && effEnd >= yearStart && effEnd <= yearEnd
              ? xOf(effEnd)
              : null,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, year]);

  const months = Array.from({ length: 12 }, (_, m) => m);

  const today = dayjs();
  const todayX = today.year() === year ? xOf(today.format("YYYY-MM-DD")) : null;

  return (
    <div className="an-wrap">
      {/* 工具条：产品名 + 年份切换 + 新建版本 */}
      <div className="an-toolbar">
        <div className="an-title">{customerName ?? "—"}</div>
        <div className="an-toolbar-right">
          <div className="an-year-nav">
            <Button
              type="text"
              size="small"
              icon={<LeftOutlined />}
              onClick={() => setYear((y) => y - 1)}
            />
            <DatePicker
              picker="year"
              allowClear={false}
              value={dayjs(`${year}-01-01`)}
              onChange={(v) => v && setYear(v.year())}
              style={{ width: 96 }}
            />
            <Button
              type="text"
              size="small"
              icon={<RightOutlined />}
              onClick={() => setYear((y) => y + 1)}
            />
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            {t("projects.annual.newVersion")}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty
          className="an-empty"
          description={t("projects.annual.empty", { year })}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            {t("projects.annual.newVersion")}
          </Button>
        </Empty>
      ) : (
        <div className="an-scroll">
          <div style={{ width: LABEL_W + contentWidth }}>
            {/* 表头：左侧占位 + 12 个月 */}
            <div className="an-head">
              <div className="an-corner" style={{ width: LABEL_W }}>
                {year}
              </div>
              <div className="an-months" style={{ width: contentWidth }}>
                {months.map((m) => (
                  <div
                    key={m}
                    className={`an-month${m % 3 === 0 ? " is-quarter" : ""}`}
                    style={{ width: MONTH_W }}
                  >
                    {m + 1}月
                  </div>
                ))}
              </div>
            </div>

            {/* 版本行 */}
            <div className="an-body" style={{ position: "relative" }}>
              {todayX != null && (
                <div
                  className="an-today"
                  style={{ left: LABEL_W + todayX }}
                  title={t("projects.annual.today")}
                />
              )}
              {rows.map(
                ({
                  p,
                  left,
                  width,
                  continuesLeft,
                  continuesRight,
                  releaseX,
                }) => {
                  const meta = PROJECT_STATUS_META[p.status];
                  const color = STATUS_COLOR[p.status];
                  const isOps = p.kind === "ops";
                  return (
                    <div
                      className="an-row"
                      key={p.id}
                      style={{ height: ROW_H }}
                    >
                      {/* 左：版本名 + 状态 + 周期 */}
                      <div className="an-label" style={{ width: LABEL_W }}>
                        <div className="an-label-main">
                          <a
                            className="an-ver"
                            onClick={() => onOpenProject(p.id)}
                            title={t("projects.card.enter")}
                          >
                            {p.name}
                          </a>
                          <Tag color={meta.color} variant="filled">
                            {t(meta.i18nKey)}
                          </Tag>
                        </div>
                        <div className="an-label-sub">
                          {fmt(p.start, "YYYY/MM/DD")} ~{" "}
                          {p.end
                            ? fmt(p.end, "YYYY/MM/DD")
                            : t("projects.card.ongoing")}
                        </div>
                      </div>

                      {/* 右：时间轴轨道 + 色块 + 发布 ▼ */}
                      <div className="an-track" style={{ width: contentWidth }}>
                        {months.map((m) => (
                          <div
                            key={m}
                            className={`an-cell${
                              m % 3 === 0 ? " is-quarter" : ""
                            }`}
                            style={{ left: m * MONTH_W, width: MONTH_W }}
                          />
                        ))}
                        <div
                          className={`an-bar${continuesLeft ? " cont-l" : ""}${
                            continuesRight ? " cont-r" : ""
                          }`}
                          style={{ left, width, background: color }}
                          onClick={() => onEditProject(p)}
                          // 運用型は進捗率が達成率として読めないので、帯に % を出さない（期間だけ）
                          title={`${p.name} · ${fmt(p.start, "YYYY/MM/DD")}~${
                            p.end
                              ? fmt(p.end, "YYYY/MM/DD")
                              : t("projects.card.ongoing")
                          }${isOps ? "" : ` · ${p.progress}%`}`}
                        >
                          {!isOps && (
                            <span
                              className="an-bar-fill"
                              style={{ width: `${p.progress}%` }}
                            />
                          )}
                          <span className="an-bar-name">
                            {p.name}
                            {!isOps && (
                              <span className="an-bar-pct">{p.progress}%</span>
                            )}
                          </span>
                        </div>
                        {releaseX != null && (
                          <span
                            className="an-release"
                            style={{ left: releaseX }}
                            title={`${t("projects.annual.release")} · ${fmt(
                              p.end as string,
                              "YYYY/MM/DD"
                            )}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

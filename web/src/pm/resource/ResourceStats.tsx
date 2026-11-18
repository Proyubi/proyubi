import { useMemo, useState } from "react";
import { useIntl } from "@umijs/max";
import { Button, Card, Col, Empty, Progress, Row, Spin, Tooltip } from "antd";
import {
  CalendarOutlined,
  DownloadOutlined,
  DownOutlined,
  FieldTimeOutlined,
  PieChartOutlined,
  UnorderedListOutlined,
  UpOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import type { Member, WorkloadItem } from "../types";
import { fmtDuration, getHoursPerDay } from "../utils/date";
import { exportResourceStats } from "./exportStats";
import "./resourceStats.css";

interface Props {
  loading: boolean;
  /** 选中成员的全部工时条目（未按「完了非表示」过滤——实绩需含已完成任务） */
  items: WorkloadItem[];
  member?: Member;
  /** 成员列表（导出任务一覧の担当名解決用） */
  members: Member[];
  /** 月窗 [开始月1日, 结束月1日]（YYYY-MM-DD）；null = 全期间 */
  range: { start: string; end: string } | null;
}

/** 是否两区间有交叠（闭区间）；任一端缺失按无此区间处理 */
function overlaps(
  aStart: string | null,
  aEnd: string | null,
  wStart: string,
  wEnd: string
): boolean {
  if (!aStart || !aEnd) return false;
  return aStart <= wEnd && aEnd >= wStart;
}

/**
 * 個人モードの「工時実績サマリー」パネル。
 * 選択メンバー × 選択月窗で、担当タスクの実績/予定工数を集計して見せる。
 * - 集計は担当「関与ベース」：複数担当タスクは各人に全工数を計上（合算は重複するため個人モードのみ）。
 * - 期間ルール：actual/予定いずれかの区間が月窗に交叠すれば全工数を計上（分割しない）。
 * - 「完了タスクを非表示」トグルに関わらず、完了タスクも含めて集計（実績の主成分のため）。
 * 工期分は後端が甘特 footer と同口径で算出済み（plannedMinutes/actualMinutes）、ここでは合計するだけ。
 */
export default function ResourceStats({
  loading,
  items,
  member,
  members,
  range,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("pm.resource.statsCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("pm.resource.statsCollapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const stats = useMemo(() => {
    // 月窗：range 给的是「开始月1日 / 结束月1日」，需把结束端补到当月末
    const winStart = range ? dayjs(range.start).startOf("month") : null;
    const winEnd = range ? dayjs(range.end).endOf("month") : null;
    const wS = winStart?.format("YYYY-MM-DD");
    const wE = winEnd?.format("YYYY-MM-DD");
    const today = dayjs().format("YYYY-MM-DD");

    // 仅统计叶子「タスク」种别（summary 会与子任务重复计；milestone 工期=0）
    const leaves = items.filter((it) => it.type === "task");

    const inWindow = leaves.filter((it) => {
      if (!wS || !wE) return true;
      // 着手中（actualEnd 缺失）：以「今日」为开区间端做交叠判定
      const aEnd = it.actualEnd ?? (it.actualStart ? today : null);
      return (
        overlaps(it.start, it.end, wS, wE) ||
        overlaps(it.actualStart, aEnd, wS, wE)
      );
    });

    let plannedSum = 0;
    let actualSum = 0;
    let doneCount = 0;
    let wipCount = 0;

    for (const it of inWindow) {
      plannedSum += it.plannedMinutes ?? 0;
      actualSum += it.actualMinutes ?? 0;
      if ((it.progress ?? 0) >= 100) doneCount += 1;
      else if (it.actualStart) wipCount += 1;
    }

    const consumption =
      plannedSum > 0 ? Math.round((actualSum / plannedSum) * 100) : null;

    return {
      plannedSum,
      actualSum,
      taskCount: inWindow.length,
      doneCount,
      wipCount,
      consumption,
      // 导出用：集计对象そのもの（月窗に交叠する担当叶子タスク）
      rows: inWindow,
    };
  }, [items, range, intl]);

  // 消化率の色：予定なし=灰、超過=橙、80%+=緑、未満=青
  const rateColor = (r: number | null) => {
    if (r == null) return "#8c8c8c";
    if (r > 100) return "#fa8c16";
    if (r >= 80) return "#52c41a";
    return "#1677ff";
  };

  const deltaMin = stats.actualSum - stats.plannedSum;
  const deltaLabel =
    stats.consumption == null
      ? t("resources.stats.kpi.noPlan")
      : deltaMin >= 0
      ? t("resources.stats.kpi.over", { v: fmtDuration(deltaMin) })
      : t("resources.stats.kpi.remain", { v: fmtDuration(-deltaMin) });

  const handleExport = () => {
    exportResourceStats({
      member,
      range,
      rows: stats.rows,
      agg: {
        actualSum: stats.actualSum,
        plannedSum: stats.plannedSum,
        taskCount: stats.taskCount,
        doneCount: stats.doneCount,
        wipCount: stats.wipCount,
        consumption: stats.consumption,
      },
      members,
      t,
    });
  };

  const header = (
    <div className="rstats-head">
      <span className="rstats-title">
        {t("resources.stats.title")}
        {member ? <span className="rstats-sub">· {member.name}</span> : null}
      </span>
      <Tooltip title={t("resources.stats.hint", { hpd: getHoursPerDay() })}>
        <span className="rstats-hpd">
          <FieldTimeOutlined />
          {t("resources.stats.hpd", { hpd: getHoursPerDay() })}
        </span>
      </Tooltip>
      <span className="rstats-note">{t("resources.stats.note")}</span>
      <Button
        className="rstats-export"
        size="small"
        icon={<DownloadOutlined />}
        onClick={handleExport}
        disabled={loading || stats.taskCount === 0}
      >
        {t("resources.stats.export.btn")}
      </Button>
      <button type="button" className="rstats-toggle" onClick={toggle}>
        {collapsed ? <DownOutlined /> : <UpOutlined />}
        {collapsed
          ? t("resources.stats.expand")
          : t("resources.stats.collapse")}
      </button>
    </div>
  );

  const empty = stats.taskCount === 0 && !loading;

  return (
    <Card className="rstats-card" styles={{ body: { padding: 16 } }}>
      {header}
      {collapsed ? null : loading ? (
        <div className="rstats-loading">
          <Spin />
        </div>
      ) : empty ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("resources.stats.empty")}
          style={{ padding: "24px 0" }}
        />
      ) : (
        <Row gutter={16} className="rstats-kpis">
          <Col xs={12} md={6}>
            <div className="rstats-kpi">
              <div className="rstats-kpi-top">
                <FieldTimeOutlined style={{ color: "#1677ff" }} />
                <span className="rstats-kpi-label">
                  {t("resources.stats.kpi.actual")}
                </span>
              </div>
              <div className="rstats-kpi-value" style={{ color: "#1677ff" }}>
                {fmtDuration(stats.actualSum)}
              </div>
              <div className="rstats-kpi-desc">
                {t("resources.stats.kpi.target", { n: stats.taskCount })}
              </div>
            </div>
          </Col>
          <Col xs={12} md={6}>
            <div className="rstats-kpi">
              <div className="rstats-kpi-top">
                <CalendarOutlined style={{ color: "#8c8c8c" }} />
                <span className="rstats-kpi-label">
                  {t("resources.stats.kpi.planned")}
                </span>
              </div>
              <div className="rstats-kpi-value" style={{ color: "#595959" }}>
                {fmtDuration(stats.plannedSum)}
              </div>
              <div
                className="rstats-kpi-desc"
                style={{ color: rateColor(stats.consumption) }}
              >
                {deltaLabel}
              </div>
            </div>
          </Col>
          <Col xs={12} md={6}>
            <div className="rstats-kpi">
              <div className="rstats-kpi-top">
                <UnorderedListOutlined style={{ color: "#13c2c2" }} />
                <span className="rstats-kpi-label">
                  {t("resources.stats.kpi.tasks")}
                </span>
              </div>
              <div className="rstats-kpi-value">
                {stats.taskCount}
                <span className="rstats-kpi-unit">
                  {t("resources.stats.kpi.unit")}
                </span>
              </div>
              <div className="rstats-kpi-desc">
                {t("resources.stats.kpi.done", { n: stats.doneCount })}・
                {t("resources.stats.kpi.wip", { n: stats.wipCount })}
              </div>
            </div>
          </Col>
          <Col xs={12} md={6}>
            <div className="rstats-kpi rstats-kpi-ring">
              <div className="rstats-kpi-body">
                <div className="rstats-kpi-top">
                  <PieChartOutlined
                    style={{ color: rateColor(stats.consumption) }}
                  />
                  <span className="rstats-kpi-label">
                    {t("resources.stats.kpi.rate")}
                  </span>
                </div>
                <div className="rstats-kpi-desc" style={{ marginTop: 6 }}>
                  {stats.consumption == null
                    ? t("resources.stats.kpi.noPlanShort")
                    : t("resources.stats.kpi.rateHint")}
                </div>
              </div>
              <Progress
                className="rstats-kpi-ring-progress"
                type="circle"
                size={54}
                percent={Math.min(stats.consumption ?? 0, 100)}
                strokeColor={rateColor(stats.consumption)}
                format={() =>
                  stats.consumption == null ? "—" : `${stats.consumption}%`
                }
              />
            </div>
          </Col>
        </Row>
      )}
    </Card>
  );
}

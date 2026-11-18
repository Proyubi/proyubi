import { useIntl, useNavigate } from "@umijs/max";
import { Empty, Progress, Spin, Tag, Tooltip } from "antd";
import { useState } from "react";
import type {
  MyTaskBucket,
  OverviewMyBug,
  OverviewMyTask,
  PmOverviewVO,
  RiskKind,
} from "@/pm/types";
import { BUG_SEVERITY_META, BUG_STATUS_META } from "@/pm/types";
import { bugDisplayNo } from "@/pm/utils/bug";
import { fmt } from "@/pm/utils/date";
import dayjs from "dayjs";

const BUCKETS: MyTaskBucket[] = ["overdue", "today", "week", "later"];

/** バケット内の初期表示件数。来週以降は折りたたみから始める */
const BUCKET_LIMIT: Record<MyTaskBucket, number> = {
  overdue: 5,
  today: 5,
  week: 5,
  later: 0,
};

/** 期日バケットで既に表現される種別（overdue/due-soon）はタグに出さない */
const ROW_RISKS: RiskKind[] = ["blocked", "behind"];

const RISK_COLOR: Partial<Record<RiskKind, string>> = {
  blocked: "volcano",
  behind: "warning",
};

interface Props {
  data: PmOverviewVO;
  loading: boolean;
}

/** 俯瞰「マイ」ビュー：左 70%（マイタスク／マイバグ）・右 30%（参加中の案件／直近のマイルストーン） */
export default function MyOverview({ data, loading }: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const nav = useNavigate();
  const { kpis, projectHealth, milestones, meMemberId } = data;
  // 旧バックエンド（myTasks/myBugs 未対応）でも落ちないように既定値
  const myTasks = data.myTasks ?? [];
  const myBugs = data.myBugs ?? [];

  const [expanded, setExpanded] = useState<Record<MyTaskBucket, boolean>>({
    overdue: false,
    today: false,
    week: false,
    later: false,
  });

  const groups = BUCKETS.map((bucket) => ({
    bucket,
    rows: myTasks.filter((r) => r.bucket === bucket),
  })).filter((g) => g.rows.length > 0);

  const highBugs = myBugs.filter((b) => b.severity === "high").length;

  const dueLabel = (r: OverviewMyTask) => {
    if (r.daysToDue == null) return t("overview.my.noDue");
    if (r.daysToDue < 0)
      return t("overview.delay.overdueDays", { n: -r.daysToDue });
    if (r.daysToDue === 0) return t("overview.delay.today");
    return t("overview.delay.dueInDays", { n: r.daysToDue });
  };

  const bugAge = (b: OverviewMyBug) => {
    if (!b.reportedOn) return "";
    const n = dayjs().startOf("day").diff(dayjs(b.reportedOn), "day");
    return n <= 0 ? t("overview.delay.today") : t("overview.my.bugs.age", { n });
  };

  const goTask = (projectId: string | null, taskId: string) => {
    if (projectId) nav(`/projects/${projectId}/gantt?taskId=${taskId}`);
  };

  const allBugsHref =
    myBugs.length > 0 && meMemberId
      ? `/quality/${myBugs[0].customerId}?tab=bugs&assignee=${meMemberId}`
      : "/quality?tab=bugs";

  return (
    <Spin spinning={loading}>
      <div className="ov-my">
        {/* KPI 帯 */}
        <div className="ov-kpis">
          <div className="ov-kpi">
            <span className="ov-kpi-label">{t("overview.my.kpi.open")}</span>
            <span className="ov-kpi-val">{myTasks.length}</span>
          </div>
          <div className="ov-kpi">
            <span className="ov-kpi-label">{t("overview.my.kpi.delayed")}</span>
            <span className="ov-kpi-val ov-kpi-danger">
              {kpis.delayedTasks}
            </span>
          </div>
          <div className="ov-kpi">
            <span className="ov-kpi-label">
              {t("overview.my.kpi.thisWeek")}
            </span>
            <span className="ov-kpi-val">
              {kpis.weekTaskDone}
              <span className="ov-kpi-sep"> / {kpis.weekTaskTotal}</span>
            </span>
          </div>
          <div className="ov-kpi">
            <span className="ov-kpi-label">
              {t("overview.my.kpi.bugs")}
              {highBugs > 0 && (
                <span className="ov-kpi-note">
                  {t("overview.my.kpi.bugsHigh", { n: highBugs })}
                </span>
              )}
            </span>
            <span className="ov-kpi-val ov-kpi-primary">{myBugs.length}</span>
          </div>
        </div>

        <div className="ov-grid">
          {/* 左上：マイタスク */}
          <section className="ov-panel">
            <header className="ov-panel-head">
              <h2>
                {t("overview.my.tasks.title")}
                <span className="ov-panel-count">
                  {t("overview.my.count", { n: myTasks.length })}
                </span>
              </h2>
              <span className="ov-muted">{t("overview.my.tasks.hint")}</span>
            </header>
            <div className="ov-panel-body">
              {groups.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("overview.my.tasks.empty")}
                />
              ) : (
                groups.map(({ bucket, rows }) => {
                  const open = expanded[bucket];
                  const limit = open ? rows.length : BUCKET_LIMIT[bucket];
                  const hidden = rows.length - Math.min(limit, rows.length);
                  return (
                    <div key={bucket} className={`ov-grp ov-grp-${bucket}`}>
                      <div className="ov-grp-head">
                        <i />
                        <span className="ov-grp-label">
                          {t(`overview.my.bucket.${bucket}`)}
                        </span>
                        <span className="ov-grp-count">
                          {t("overview.my.countShort", { n: rows.length })}
                        </span>
                        {(hidden > 0 ||
                          (open && rows.length > BUCKET_LIMIT[bucket])) && (
                          <button
                            type="button"
                            className="ov-grp-more"
                            onClick={() =>
                              setExpanded((s) => ({ ...s, [bucket]: !open }))
                            }
                          >
                            {open
                              ? t("overview.my.collapse")
                              : BUCKET_LIMIT[bucket] === 0
                                ? t("overview.my.show")
                                : t("overview.my.more", { n: hidden })}
                          </button>
                        )}
                      </div>
                      {rows.slice(0, limit).map((r) => {
                        const tags = ROW_RISKS.filter((k) =>
                          r.risks.includes(k)
                        );
                        const late = r.daysToDue != null && r.daysToDue < 0;
                        const today = r.daysToDue === 0;
                        return (
                          <div
                            key={r.taskId}
                            className="ov-trow"
                            onClick={() => goTask(r.projectId, r.taskId)}
                          >
                            <span className="ov-trow-main">
                              <span className="ov-trow-name">{r.name}</span>
                              <Tooltip
                                title={[r.customerName, r.projectName]
                                  .filter(Boolean)
                                  .join(" / ")}
                              >
                                <span className="ov-trow-proj">
                                  {r.projectName}
                                </span>
                              </Tooltip>
                            </span>
                            <span className="ov-trow-tags">
                              {tags.map((k) => (
                                <Tag
                                  key={k}
                                  color={RISK_COLOR[k]}
                                  variant="filled"
                                >
                                  {t(`overview.kind.${k}`)}
                                </Tag>
                              ))}
                            </span>
                            <span className="ov-trow-due">
                              <span>{r.end ? fmt(r.end, "MM/DD") : "—"}</span>
                              <span
                                className={
                                  late
                                    ? "ov-overdue"
                                    : today
                                      ? "ov-duesoon"
                                      : "ov-muted"
                                }
                              >
                                {dueLabel(r)}
                              </span>
                            </span>
                            <Progress
                              className="ov-trow-progress"
                              percent={r.progress}
                              size="small"
                              railColor="#f0f2f5"
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* 右上：参加中の案件 */}
          <section className="ov-panel">
            <header className="ov-panel-head">
              <h2>
                {t("overview.my.projects.title")}
                <span className="ov-panel-count">
                  {t("overview.my.countShort", { n: projectHealth.length })}
                </span>
              </h2>
            </header>
            <div className="ov-panel-body">
              {projectHealth.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("overview.health.empty")}
                />
              ) : (
                projectHealth.map((p) => (
                  <div
                    key={p.projectId}
                    className={`ov-hrow${p.overdue ? " is-overdue" : ""}`}
                    onClick={() => nav(`/projects/${p.projectId}/gantt`)}
                  >
                    <div className="ov-hrow-main">
                      <span className="ov-hname">{p.name}</span>
                      {p.subCount > 0 && (
                        <span
                          className={`ov-hsub${p.subOverdueCount > 0 ? " is-red" : ""}`}
                          title={
                            p.subOverdueCount > 0
                              ? t("overview.health.subOverdue", {
                                  n: p.subOverdueCount,
                                })
                              : undefined
                          }
                        >
                          {t("overview.health.subBadge", { n: p.subCount })}
                        </span>
                      )}
                      {p.delay > 0 && (
                        <Tag color="error" variant="filled">
                          {t("overview.health.delayBadge", { n: p.delay })}
                        </Tag>
                      )}
                    </div>
                    <Progress
                      percent={p.progress}
                      size="small"
                      strokeColor={p.progress === 100 ? "#52c41a" : "#2f6bff"}
                      railColor="#f0f2f5"
                    />
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 左下：マイバグ */}
          <section className="ov-panel">
            <header className="ov-panel-head">
              <h2>
                {t("overview.my.bugs.title")}
                <span className="ov-panel-count">
                  {t("overview.my.count", { n: myBugs.length })}
                </span>
              </h2>
              <a
                href={allBugsHref}
                onClick={(e) => {
                  e.preventDefault();
                  nav(allBugsHref);
                }}
              >
                {t("overview.my.bugs.viewAll")}
              </a>
            </header>
            <div className="ov-panel-body">
              {myBugs.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("overview.my.bugs.empty")}
                />
              ) : (
                myBugs.map((b) => {
                  const stColor = BUG_STATUS_META[b.status]?.color ?? "#8c8c8c";
                  return (
                    <div
                      key={b.id}
                      className="ov-brow"
                      onClick={() =>
                        nav(`/quality/${b.customerId}?tab=bugs&bug=${b.id}`)
                      }
                    >
                      <Tooltip
                        title={t(
                          BUG_SEVERITY_META[b.severity]?.i18nKey ??
                            "quality.severity.medium"
                        )}
                      >
                        <i
                          className="ov-brow-sev"
                          style={{
                            background: BUG_SEVERITY_META[b.severity]?.color,
                          }}
                        />
                      </Tooltip>
                      <span className="ov-brow-no">{bugDisplayNo(b)}</span>
                      <span className="ov-brow-title">{b.title}</span>
                      <span className="ov-brow-cust">{b.customerName}</span>
                      <span>
                        <span
                          className="ov-brow-status"
                          style={{
                            color: stColor,
                            background: `color-mix(in srgb, ${stColor} 12%, transparent)`,
                          }}
                        >
                          {BUG_STATUS_META[b.status]
                            ? t(BUG_STATUS_META[b.status].i18nKey)
                            : b.status}
                        </span>
                      </span>
                      <span className="ov-brow-age">{bugAge(b)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* 右下：直近のマイルストーン */}
          <section className="ov-panel">
            <header className="ov-panel-head">
              <h2>{t("overview.my.milestones.title")}</h2>
            </header>
            <div className="ov-panel-body">
              {milestones.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("overview.milestone.empty")}
                />
              ) : (
                milestones.map((m) => {
                  const cls =
                    m.diff < 0 ? "is-late" : m.diff <= 7 ? "is-soon" : "";
                  return (
                    <div
                      key={m.taskId}
                      className={`ov-mrow ${cls}`}
                      onClick={() => goTask(m.projectId, m.taskId)}
                    >
                      <i className="ov-mrow-dia" />
                      <span className="ov-mrow-main">
                        <span className="ov-mrow-name">{m.name}</span>
                        <span className="ov-mrow-proj">{m.projectName}</span>
                      </span>
                      <span className="ov-mrow-date">
                        <span>{fmt(m.end, "YYYY/MM/DD")}</span>
                        <span className="ov-mrow-diff">
                          {m.diff < 0
                            ? t("overview.milestone.overdue", { n: -m.diff })
                            : m.diff === 0
                              ? t("overview.delay.today")
                              : t("overview.milestone.dueIn", { n: m.diff })}
                        </span>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </Spin>
  );
}

import { CloseOutlined } from "@ant-design/icons";
import { PageContainer } from "@ant-design/pro-components";
import { useIntl, useModel, useNavigate, useSearchParams } from "@umijs/max";
import {
  Avatar,
  Button,
  Empty,
  Progress,
  Segmented,
  Spin,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import SearchButton from "@/components/TaskSearchPalette/SearchButton";
import { getOverview } from "@/pm/api";
import { useData } from "@/pm/store";
import type { OverviewRiskItem, PmOverviewVO, RiskKind } from "@/pm/types";
import { fmt } from "@/pm/utils/date";
import MyOverview from "./MyOverview";
import "./index.css";

type ViewMode = "all" | "me";

/** 多风险命中时徽标的展示顺序（与后端优先级一致） */
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

const EMPTY_OVERVIEW: PmOverviewVO = {
  meMemberId: null,
  kpis: {
    activeProjects: 0,
    delayedProjects: 0,
    delayedTasks: 0,
    dueSoon: 0,
    unassigned: 0,
    blocked: 0,
    inProgressTasks: 0,
    weekTaskTotal: 0,
    weekTaskDone: 0,
  },
  riskItems: [],
  projectHealth: [],
  milestones: [],
  assigneeDistribution: [],
  unassignedTaskCount: 0,
  myTasks: [],
  myBugs: [],
};

export default function OverviewPage() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  // ?risk=delayed → リスク一覧を遅延タスク（期限超過のみ）に絞り込む
  const delayedOnly = searchParams.get("risk") === "delayed";
  const { memberMap, ensureBase, baseLoaded, reloadMembers } = useData();

  // 初期表示：オーナーは全社俯瞰、メンバーはマイ（手動切替はその場限り）
  const { initialState } = useModel("@@initialState");
  const [mode, setMode] = useState<ViewMode>(() =>
    initialState?.currentUser?.role === "owner" ? "all" : "me"
  );
  const [data, setData] = useState<PmOverviewVO>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(false);

  // memberMap 用于风险行的担当头像着色
  useEffect(() => {
    ensureBase();
  }, [ensureBase]);

  // 防止过期响应覆盖最新
  const reqSeq = useRef(0);
  useEffect(() => {
    const seq = ++reqSeq.current;
    setLoading(true);
    getOverview(mode)
      .then((res) => {
        if (seq !== reqSeq.current) return;
        setData(res ?? EMPTY_OVERVIEW);
      })
      .finally(() => {
        if (seq === reqSeq.current) setLoading(false);
      });
  }, [mode]);

  const {
    kpis,
    riskItems,
    projectHealth,
    meMemberId,
    assigneeDistribution,
    unassignedTaskCount,
  } = data;
  const notMember = mode === "me" && meMemberId == null && !loading;

  // 自愈：overview の担当 ID（分布＋リスク行）が memberMap に無い場合、
  // ログイン直後に空で取得された成員名册が ensureBase の幂等キャッシュに固定された可能性が高い。
  // → 名册を一度だけ再取得して UUID 表示を実名に戻す（真に削除済みの成員に対しては
  //   一度きりで諦め、無限ループを防ぐ）。
  const healedRef = useRef(false);
  useEffect(() => {
    if (!baseLoaded || healedRef.current) return;
    const referenced = new Set<string>();
    for (const a of assigneeDistribution) referenced.add(a.memberId);
    for (const r of riskItems)
      for (const id of r.assigneeIds) referenced.add(id);
    if ([...referenced].some((id) => !memberMap[id])) {
      healedRef.current = true;
      reloadMembers();
    }
  }, [baseLoaded, assigneeDistribution, riskItems, memberMap, reloadMembers]);

  // 担当者別タスク分布（横棒）：后端 overview VO 直接返回（全社・割当済み叶子 + 未割当総数、
  //    与各行同口径）。旧版用 /workload + 风险型 kpis.unassigned 拼装、分母口径不一致已废弃。
  const assigneeRows = useMemo(() => {
    const rows = assigneeDistribution
      .map((a) => ({
        name: memberMap[a.memberId]?.name ?? a.memberId,
        value: a.taskCount,
        color: memberMap[a.memberId]?.color || "#1677ff",
      }))
      .sort((a, b) => b.value - a.value);
    if (unassignedTaskCount > 0) {
      rows.push({
        name: t("overview.assignee.unassigned"),
        value: unassignedTaskCount,
        color: "#d9d9d9",
      });
    }
    return rows;
    // t は intl 由来で安定。memberMap / 分布 / 未割当数の変化で再計算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigneeDistribution, memberMap, unassignedTaskCount]);

  // 遅延タスク = 期限超過(overdue) のみ（バックエンドの delayedTasks 定義と一致）
  const shownRiskItems = delayedOnly
    ? riskItems.filter((r) => r.risks.includes("overdue"))
    : riskItems;

  const renderAssignees = (ids: string[]) => {
    if (ids.length === 0)
      return <span className="ov-muted">{t("overview.unassignedLabel")}</span>;
    return (
      <Avatar.Group size="small" max={{ count: 3 }}>
        {ids.map((id) => {
          const m = memberMap[id];
          return (
            <Tooltip key={id} title={m?.name ?? id}>
              <Avatar
                size="small"
                style={{ background: m?.color || "#1677ff" }}
              >
                {(m?.name ?? "?").slice(0, 1)}
              </Avatar>
            </Tooltip>
          );
        })}
      </Avatar.Group>
    );
  };

  const columns: ColumnsType<OverviewRiskItem> = [
    {
      title: t("overview.risk.col.kind"),
      dataIndex: "primary",
      width: 110,
      render: (_, r) => (
        <span className="ov-badges">
          {RISK_PRIORITY.filter((k) => r.risks.includes(k)).map((k) => (
            <Tag key={k} color={RISK_COLOR[k]} variant="filled">
              {t(`overview.kind.${k}`)}
            </Tag>
          ))}
        </span>
      ),
    },
    {
      title: t("overview.risk.col.taskProject"),
      dataIndex: "name",
      render: (_, r) => (
        <span className="ov-proj">
          <span className="ov-ver">{r.name}</span>
          <Tooltip title={`${r.customerName ?? ""} / ${r.projectName ?? ""}`}>
            <span className="ov-cust">
              {[r.customerName, r.projectName].filter(Boolean).join(" / ")}
            </span>
          </Tooltip>
        </span>
      ),
    },
    {
      title: t("overview.risk.col.assignee"),
      dataIndex: "assigneeIds",
      width: 90,
      render: (_, r) => renderAssignees(r.assigneeIds),
    },
    {
      title: t("overview.risk.col.due"),
      dataIndex: "end",
      width: 120,
      render: (_, r) => (
        <span className="ov-due">
          <span>{r.end ? fmt(r.end, "YYYY/MM/DD") : "—"}</span>
          {r.overdueDays > 0 ? (
            <span className="ov-overdue">
              {t("overview.delay.overdueDays", { n: r.overdueDays })}
            </span>
          ) : r.daysUntilDue != null ? (
            <span className="ov-duesoon">
              {r.daysUntilDue === 0
                ? t("overview.delay.today")
                : t("overview.delay.dueInDays", { n: r.daysUntilDue })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      title: t("overview.risk.col.progress"),
      dataIndex: "progress",
      width: 120,
      render: (_, r) => (
        <Progress percent={r.progress} size="small" railColor="#f0f2f5" />
      ),
    },
  ];

  const goTask = (r: OverviewRiskItem) =>
    nav(`/projects/${r.projectId}/gantt?taskId=${r.taskId}`);

  const maxAssignee = Math.max(1, ...assigneeRows.map((r) => r.value));

  return (
    <PageContainer
      title={t("overview.title")}
      subTitle={t("overview.subtitle")}
      extra={[
        <SearchButton key="search" />,
        <Segmented<ViewMode>
          key="mode"
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: "all", label: t("overview.view.all") },
            { value: "me", label: t("overview.view.member") },
          ]}
        />,
      ]}
    >
      {!baseLoaded ? (
        <div className="ov-loading">
          <Spin size="large" />
        </div>
      ) : notMember ? (
        <Empty
          style={{ padding: "80px 0" }}
          description={t("overview.notMember")}
        />
      ) : mode === "me" ? (
        <MyOverview data={data} loading={loading} />
      ) : (
        <div className="ov-page">
          {/* KPI 帯 */}
          <div className="ov-kpis">
            <div className="ov-kpi">
              <span className="ov-kpi-label">
                {t("overview.stat.inProgress")}
              </span>
              <span className="ov-kpi-val">{kpis.inProgressTasks}</span>
            </div>
            <Tooltip title={t("overview.stat.delayed.tip")}>
              <button
                type="button"
                className={`ov-kpi ov-kpi-link${delayedOnly ? " is-active" : ""}`}
                onClick={() =>
                  nav(delayedOnly ? "/overview" : "/overview?risk=delayed")
                }
              >
                <span className="ov-kpi-label">
                  {t("overview.stat.delayed")}
                </span>
                <span className="ov-kpi-val ov-kpi-danger">
                  {kpis.delayedTasks}
                </span>
              </button>
            </Tooltip>
            <div className="ov-kpi">
              <span className="ov-kpi-label">
                {t("overview.stat.thisWeek")}
              </span>
              <span className="ov-kpi-val">
                {kpis.weekTaskDone}
                <span className="ov-kpi-sep"> / {kpis.weekTaskTotal}</span>
              </span>
            </div>
            <div className="ov-kpi">
              <span className="ov-kpi-label">
                {t("overview.kpi.delayedProjects")}
              </span>
              <span className="ov-kpi-val ov-kpi-danger">
                {kpis.delayedProjects}
                <span className="ov-kpi-sep"> / {kpis.activeProjects}</span>
              </span>
            </div>
          </div>

          {/* 左 70%：リスク一覧（2 行ぶち抜き）／ 右 30%：案件ヘルス・担当者別タスク */}
          <div className="ov-grid">
            <section className="ov-panel ov-panel-span">
              <header className="ov-panel-head">
                <h2>
                  {t("overview.risk.title")}
                  <span className="ov-panel-count">
                    {t("overview.my.countShort", { n: shownRiskItems.length })}
                  </span>
                  {delayedOnly && (
                    <Tag
                      color="error"
                      closable
                      closeIcon={<CloseOutlined />}
                      onClose={(e) => {
                        e.preventDefault();
                        nav("/overview");
                      }}
                      style={{ marginLeft: 8 }}
                    >
                      {t("overview.risk.filter.delayed")}
                    </Tag>
                  )}
                </h2>
                {delayedOnly ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => nav("/overview")}
                  >
                    {t("overview.risk.clearFilter")}
                  </Button>
                ) : (
                  <span className="ov-muted">
                    {t("overview.my.tasks.hint")}
                  </span>
                )}
              </header>
              <div className="ov-panel-body ov-risk">
                <Table<OverviewRiskItem>
                  rowKey="taskId"
                  size="small"
                  loading={loading}
                  columns={columns}
                  dataSource={shownRiskItems}
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  onRow={(r) => ({
                    onClick: () => goTask(r),
                    style: { cursor: "pointer" },
                  })}
                  locale={{
                    emptyText: (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={t("overview.risk.empty")}
                      />
                    ),
                  }}
                />
              </div>
            </section>

            {/* 案件ヘルス */}
            <section className="ov-panel">
              <header className="ov-panel-head">
                <h2>{t("overview.health.title")}</h2>
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

            {/* 担当者別タスク分布（横棒） */}
            <section className="ov-panel">
              <header className="ov-panel-head">
                <h2>{t("overview.assignee.title")}</h2>
              </header>
              <div className="ov-panel-body">
                {assigneeRows.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("overview.assignee.empty")}
                  />
                ) : (
                  <div className="ov-bars">
                    {assigneeRows.map((r) => (
                      <Tooltip
                        key={r.name}
                        title={t("overview.assignee.tasksUnit", { n: r.value })}
                        placement="left"
                      >
                        <div className="ov-bar">
                          <span className="ov-bar-name">{r.name}</span>
                          <span className="ov-bar-track">
                            <span
                              style={{
                                width: `${Math.max(2, (r.value / maxAssignee) * 100)}%`,
                                background: r.color,
                              }}
                            />
                          </span>
                          <span className="ov-bar-val">{r.value}</span>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

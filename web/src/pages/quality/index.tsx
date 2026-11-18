import {
  BugOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { PageContainer } from "@ant-design/pro-components";
import { useIntl, useNavigate, useParams, useSearchParams } from "@umijs/max";
import {
  App as AntApp,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  TreeSelect,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/pm/api";
import { useData } from "@/pm/store";
import {
  BUG_SEVERITY_META,
  type Bug,
  type Environment,
  environmentLabel,
  type QcPriority,
  QC_PRIORITY_META,
  type QualitySummary,
  type TestCase,
  type TestCategory,
  TEST_CATEGORY_META,
  type TestResult,
  TEST_RESULT_META,
  type TestSuite,
} from "@/pm/types";
import { bugDisplayNo, isActiveBug } from "@/pm/utils/bug";
import BugsTab from "./bugs-tab";
import "./index.css";

/** antd App.useApp() の戻り値型（message などのプロップ型付け用） */
type AppApi = ReturnType<typeof AntApp.useApp>;

const CATEGORY_KEYS: TestCategory[] = ["normal", "abnormal", "boundary"];
const RESULT_KEYS: (TestResult | "untested")[] = [
  "pass",
  "fail",
  "na",
  "untested",
];
const PRIORITY_KEYS: QcPriority[] = ["high", "medium", "low"];

export default function QualityPage() {
  const intl = useIntl();
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id }, values),
    [intl]
  );
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    projects,
    customers,
    members,
    ensureBase,
    loadProject,
    tasksOf,
    isProjectLoaded,
  } = useData();

  const [ready, setReady] = useState(false);
  const [customerId, setCustomerId] = useState<string | undefined>();

  // アクティブタブは URL クエリ(?tab=)で保持し、リロードしても維持する
  // 既定はバグ管理。テストケースは ?tab=cases のときだけ開く
  const tab = searchParams.get("tab") === "cases" ? "cases" : "bugs";
  const setTab = useCallback(
    (k: string) => {
      // バグ一覧の絞り込み条件（URL 保持）はタブを往復しても残す
      const next = new URLSearchParams(searchParams);
      next.set("tab", k);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // ---- Quality 数据 ----
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [activeSuite, setActiveSuite] = useState<string | "all">("all");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);

  // ---- 过滤 ----
  const [fResult, setFResult] = useState<string>();
  const [fCategory, setFCategory] = useState<string>();
  const [fPriority, setFPriority] = useState<string>();
  const [fAssignee, setFAssignee] = useState<string>();
  const [fFeature, setFFeature] = useState<string>();
  const [fKeyword, setFKeyword] = useState("");

  // 基础数据 + 选定项目
  useEffect(() => {
    ensureBase().finally(() => setReady(true));
  }, [ensureBase]);

  useEffect(() => {
    if (!ready) return;
    const fromUrl = params.customerId as string | undefined;
    const valid =
      fromUrl && customers.some((c) => c.id === fromUrl) ? fromUrl : undefined;
    setCustomerId(valid ?? customers[0]?.id);
  }, [ready, customers, params.customerId]);

  const reloadSuites = useCallback(async (cid: string) => {
    const [ss, sm] = await Promise.all([
      api.listTestSuites(cid),
      api.getQualitySummary(cid),
    ]);
    setSuites(ss ?? []);
    setSummary(sm ?? null);
  }, []);

  const reloadCases = useCallback(async (cid: string) => {
    const cs = await api.listCasesByCustomer(cid);
    setCases(cs ?? []);
  }, []);

  const reloadBugs = useCallback(async (cid: string) => {
    const bs = await api.listBugsByCustomer(cid);
    setBugs(bs ?? []);
  }, []);

  const reloadEnvironments = useCallback(async (cid: string) => {
    const es = await api.listEnvironments(cid);
    setEnvironments(es ?? []);
  }, []);

  // 当前顧客/製品配下の版本（複数）。スイート⇄タスク紐付け/Gantt 遷移用のタスク集約に使う
  const custProjects = useMemo(
    () => projects.filter((p) => p.customerId === customerId),
    [projects, customerId]
  );

  // 切换顧客：拉取全部 quality 数据 + 该製品配下の全版本のタスク（任务名/关联选择用）
  useEffect(() => {
    if (!customerId) return;
    setActiveSuite("all");
    setSelectedCaseIds([]);
    reloadSuites(customerId);
    reloadCases(customerId);
    reloadBugs(customerId);
    reloadEnvironments(customerId);
  }, [customerId, reloadSuites, reloadCases, reloadBugs, reloadEnvironments]);

  useEffect(() => {
    custProjects.forEach((p) => loadProject(p.id).catch(() => {}));
  }, [custProjects, loadProject]);

  // 製品配下の全版本のタスクを集約（version 名でラベル付け、Gantt 遷移用に projectId を保持）
  const tasks = useMemo(
    () =>
      custProjects.flatMap((p) => (isProjectLoaded(p.id) ? tasksOf(p.id) : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [custProjects, isProjectLoaded, tasksOf]
  );
  const projNameMap = useMemo(
    () => Object.fromEntries(custProjects.map((p) => [p.id, p.name])),
    [custProjects]
  );
  const taskMap = useMemo(
    () => Object.fromEntries(tasks.map((x) => [x.id, x.name])),
    [tasks]
  );
  const taskProjectMap = useMemo(
    () => Object.fromEntries(tasks.map((x) => [x.id, x.projectId])),
    [tasks]
  );
  const taskOptions = useMemo(
    () =>
      tasks.map((x) => ({
        label:
          custProjects.length > 1
            ? `${projNameMap[x.projectId] ?? ""} / ${x.name}`
            : x.name,
        value: x.id,
      })),
    [tasks, custProjects.length, projNameMap]
  );
  const memberOptions = useMemo(
    () => members.map((m) => ({ label: m.name, value: m.id })),
    [members]
  );

  const summaryBySuite = useMemo(() => {
    const m: Record<string, QualitySummary["suites"][number]> = {};
    for (const s of summary?.suites ?? []) if (s.suiteId) m[s.suiteId] = s;
    return m;
  }, [summary]);

  const gotoGantt = useCallback(
    (taskId: string) => {
      const pid = taskProjectMap[taskId];
      if (pid) navigate(`/projects/${pid}/gantt?taskId=${taskId}`);
    },
    [navigate, taskProjectMap]
  );

  if (ready && customers.length === 0) {
    return (
      <PageContainer title={t("quality.title")}>
        <Empty description={t("quality.noProject")} />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={t("quality.title")}
      subTitle={t("quality.subtitle")}
      extra={[
        <Select
          key="cust"
          style={{ minWidth: 240 }}
          value={customerId}
          placeholder={t("quality.selectProject")}
          options={customers.map((c) => ({ label: c.name, value: c.id }))}
          onChange={(v) => {
            setCustomerId(v);
            navigate(`/quality/${v}?tab=${tab}`);
          }}
          showSearch
          optionFilterProp="label"
        />,
      ]}
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "bugs",
            label: (
              <span>
                <span style={{ marginInlineEnd: 6 }}>
                  {t("quality.tab.bugs")}
                </span>
                <Tag>
                  {t("quality.bug.tabCount", {
                    active: bugs.filter((b) => isActiveBug(b.status)).length,
                    total: bugs.length,
                  })}
                </Tag>
              </span>
            ),
            children: (
              <BugsTab
                customerId={customerId}
                active={tab === "bugs"}
                allCustomers={customers}
                allProjects={projects}
                bugs={bugs}
                environments={environments}
                reloadEnvironments={reloadEnvironments}
                taskMap={taskMap}
                tasks={tasks}
                memberOptions={memberOptions}
                caseMap={Object.fromEntries(cases.map((c) => [c.id, c.caseNo]))}
                gotoGantt={gotoGantt}
                t={t}
                message={message}
                reloadBugs={reloadBugs}
              />
            ),
          },
          {
            key: "cases",
            label: (
              <span>
                <span style={{ marginInlineEnd: 6 }}>
                  {t("quality.tab.cases")}
                </span>
                <Tag>{summary?.total.total ?? cases.length}</Tag>
              </span>
            ),
            children: (
              <CasesTab
                customerId={customerId}
                suites={suites}
                environments={environments}
                cases={cases}
                summary={summary}
                summaryBySuite={summaryBySuite}
                activeSuite={activeSuite}
                setActiveSuite={setActiveSuite}
                selectedCaseIds={selectedCaseIds}
                setSelectedCaseIds={setSelectedCaseIds}
                fResult={fResult}
                setFResult={setFResult}
                fCategory={fCategory}
                setFCategory={setFCategory}
                fPriority={fPriority}
                setFPriority={setFPriority}
                fAssignee={fAssignee}
                setFAssignee={setFAssignee}
                fFeature={fFeature}
                setFFeature={setFFeature}
                fKeyword={fKeyword}
                setFKeyword={setFKeyword}
                taskMap={taskMap}
                taskOptions={taskOptions}
                gotoGantt={gotoGantt}
                t={t}
                message={message}
                reloadSuites={reloadSuites}
                reloadCases={reloadCases}
                reloadBugs={reloadBugs}
                setTab={setTab}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  );
}

// ============================ Cases Tab ============================

interface CasesTabProps {
  customerId?: string;
  suites: TestSuite[];
  environments: Environment[];
  cases: TestCase[];
  summary: QualitySummary | null;
  summaryBySuite: Record<string, QualitySummary["suites"][number]>;
  activeSuite: string | "all";
  setActiveSuite: (s: string | "all") => void;
  selectedCaseIds: string[];
  setSelectedCaseIds: (ids: string[]) => void;
  fResult?: string;
  setFResult: (v?: string) => void;
  fCategory?: string;
  setFCategory: (v?: string) => void;
  fPriority?: string;
  setFPriority: (v?: string) => void;
  fAssignee?: string;
  setFAssignee: (v?: string) => void;
  fFeature?: string;
  setFFeature: (v?: string) => void;
  fKeyword: string;
  setFKeyword: (v: string) => void;
  taskMap: Record<string, string>;
  taskOptions: { label: string; value: string }[];
  gotoGantt: (taskId: string) => void;
  t: (id: string, v?: Record<string, string | number>) => string;
  message: AppApi["message"];
  reloadSuites: (cid: string) => Promise<void>;
  reloadCases: (cid: string) => Promise<void>;
  reloadBugs: (cid: string) => Promise<void>;
  setTab: (k: string) => void;
}

function CasesTab(p: CasesTabProps) {
  const { t, message, customerId } = p;
  const [suiteModal, setSuiteModal] = useState<{
    open: boolean;
    editing?: TestSuite;
  }>({ open: false });
  const [caseModal, setCaseModal] = useState<{
    open: boolean;
    editing?: TestCase;
  }>({ open: false });
  const [bugModal, setBugModal] = useState<{
    open: boolean;
    fromCase?: TestCase;
  }>({ open: false });
  const [suiteForm] = Form.useForm();
  const [caseForm] = Form.useForm();
  const [bugForm] = Form.useForm();

  // 実施担当者（executedBy）候補：ケースに存在する実行者から作成。「未実施」も選択肢に
  const assigneeOptions = useMemo(() => {
    const m = new Map<string, string>();
    let hasUnassigned = false;
    for (const c of p.cases) {
      if (c.executedBy) m.set(c.executedBy, c.executedByName || c.executedBy);
      else hasUnassigned = true;
    }
    const opts = Array.from(m, ([value, label]) => ({ value, label }));
    if (hasUnassigned)
      opts.push({ value: "__none__", label: t("quality.result.untested") });
    return opts;
  }, [p.cases, t]);

  // 機能ツリー：大機能 → 中機能/画面。値は "M 大機能"（大機能のみ絞込）/
  // "m 大機能 中機能"（大＋中で絞込）。SEP はデータに現れない制御文字
  const featureTree = useMemo(() => {
    const SEP = "\u0001";
    const majors = new Map<string, Set<string>>();
    for (const c of p.cases) {
      if (p.activeSuite !== "all" && c.suiteId !== p.activeSuite) continue;
      const major = (c.featureMajor ?? "").trim();
      if (!major) continue;
      const minor = (c.featureMinor ?? "").trim();
      if (!majors.has(major)) majors.set(major, new Set());
      if (minor) majors.get(major)?.add(minor);
    }
    return Array.from(majors, ([major, minors]) => ({
      title: major,
      value: `M${SEP}${major}`,
      selectable: true,
      children: Array.from(minors)
        .sort((a, b) => a.localeCompare(b))
        .map((minor) => ({
          title: minor,
          value: `m${SEP}${major}${SEP}${minor}`,
        })),
    })).sort((a, b) => a.title.localeCompare(b.title));
  }, [p.cases, p.activeSuite]);

  // スイート切替で機能ツリーが変わったら、現在の機能フィルタ値が
  // 消えていれば自動クリア（見えない絞込みで一覧が空になるのを防ぐ）
  const setFFeature = p.setFFeature;
  useEffect(() => {
    if (!p.fFeature) return;
    const valid = new Set<string>();
    for (const n of featureTree) {
      valid.add(n.value);
      for (const c of n.children) valid.add(c.value);
    }
    if (!valid.has(p.fFeature)) setFFeature(undefined);
  }, [featureTree, p.fFeature, setFFeature]);

  const filtered = useMemo(() => {
    const kw = p.fKeyword.trim().toLowerCase();
    return p.cases.filter((c) => {
      if (p.activeSuite !== "all" && c.suiteId !== p.activeSuite) return false;
      if (p.fResult) {
        if (
          p.fResult === "untested" ? c.result != null : c.result !== p.fResult
        )
          return false;
      }
      if (p.fCategory && c.category !== p.fCategory) return false;
      if (p.fPriority && c.priority !== p.fPriority) return false;
      if (p.fFeature) {
        const [kind, major, minor] = p.fFeature.split("\u0001");
        if ((c.featureMajor ?? "").trim() !== major) return false;
        if (kind === "m" && (c.featureMinor ?? "").trim() !== minor)
          return false;
      }
      if (p.fAssignee) {
        if (
          p.fAssignee === "__none__"
            ? c.executedBy
            : c.executedBy !== p.fAssignee
        )
          return false;
      }
      if (kw) {
        const hay = `${c.caseNo} ${c.title} ${c.featureMajor ?? ""} ${
          c.featureMinor ?? ""
        }`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [
    p.cases,
    p.activeSuite,
    p.fResult,
    p.fCategory,
    p.fPriority,
    p.fAssignee,
    p.fFeature,
    p.fKeyword,
  ]);

  const suiteStat =
    p.activeSuite === "all"
      ? p.summary?.total
      : p.summaryBySuite[p.activeSuite];

  const refreshAll = async () => {
    if (!customerId) return;
    await Promise.all([p.reloadSuites(customerId), p.reloadCases(customerId)]);
  };

  // ---- 実施結果 inline 更新 ----
  const setResult = async (c: TestCase, result: string) => {
    const value = result === "untested" ? null : (result as TestResult);
    try {
      await api.updateCaseResult(c.id, value);
      message.success(t("quality.msg.resultUpdated"));
      await refreshAll();
    } catch (_e) {
      /* 全局已 toast */
    }
  };

  const bulkResult = async (result: string) => {
    if (p.selectedCaseIds.length === 0) {
      message.info(t("quality.msg.selectCases"));
      return;
    }
    const value = result === "untested" ? null : result;
    const n = await api.batchCaseResult(p.selectedCaseIds, value);
    message.success(t("quality.msg.batchDone", { n }));
    p.setSelectedCaseIds([]);
    await refreshAll();
  };

  // ---- スイート CRUD ----
  const openSuite = (editing?: TestSuite) => {
    suiteForm.setFieldsValue(
      editing
        ? {
            name: editing.name,
            casePrefix: editing.casePrefix,
            description: editing.description,
            taskId: editing.taskId ?? undefined,
          }
        : {
            name: undefined,
            casePrefix: undefined,
            description: undefined,
            taskId: undefined,
          }
    );
    setSuiteModal({ open: true, editing });
  };
  const submitSuite = async () => {
    const v = await suiteForm.validateFields();
    if (!customerId) return;
    if (suiteModal.editing) {
      await api.updateTestSuite(suiteModal.editing.id, {
        ...v,
        unlinkTask: !v.taskId,
      });
    } else {
      await api.createTestSuite(customerId, v);
    }
    message.success(t("quality.msg.saved"));
    setSuiteModal({ open: false });
    await refreshAll();
  };
  const deleteSuite = async (s: TestSuite) => {
    await api.deleteTestSuite(s.id);
    message.success(t("quality.msg.deleted"));
    if (p.activeSuite === s.id) p.setActiveSuite("all");
    await refreshAll();
  };

  // ---- ケース CRUD ----
  const openCase = (editing?: TestCase) => {
    caseForm.setFieldsValue(
      editing
        ? { ...editing }
        : {
            title: undefined,
            category: "normal",
            priority: "medium",
            featureMajor: undefined,
            featureMinor: undefined,
            precondition: undefined,
            steps: undefined,
            testData: undefined,
            expected: undefined,
            remark: undefined,
          }
    );
    setCaseModal({ open: true, editing });
  };
  const submitCase = async () => {
    const v = await caseForm.validateFields();
    if (caseModal.editing) {
      await api.updateCase(caseModal.editing.id, v);
    } else {
      const suiteId = p.activeSuite !== "all" ? p.activeSuite : p.suites[0]?.id;
      if (!suiteId) {
        message.info(t("quality.suite.empty"));
        return;
      }
      await api.createCase(suiteId, v);
    }
    message.success(t("quality.msg.saved"));
    setCaseModal({ open: false });
    await refreshAll();
  };
  const deleteCase = async (c: TestCase) => {
    await api.deleteCase(c.id);
    message.success(t("quality.msg.deleted"));
    await refreshAll();
  };

  // ---- バグ起票（from case） ----
  const openRaiseBug = (c: TestCase) => {
    bugForm.setFieldsValue({
      title: `[${c.caseNo}] ${c.title}`,
      severity: "medium",
      priority: c.priority,
      description: "",
      environmentId: undefined,
    });
    setBugModal({ open: true, fromCase: c });
  };
  const submitRaiseBug = async () => {
    const v = await bugForm.validateFields();
    if (!bugModal.fromCase) return;
    const bug = await api.createBugFromCase(bugModal.fromCase.id, v);
    message.success(t("quality.msg.bugRaised", { bugNo: bugDisplayNo(bug) }));
    setBugModal({ open: false });
    if (customerId) await p.reloadBugs(customerId);
    // ジャンプ促し：バグタブへ
    p.setTab("bugs");
  };

  const columns: ColumnsType<TestCase> = [
    {
      title: t("quality.case.no"),
      dataIndex: "caseNo",
      width: 96,
      fixed: "left",
      render: (v: string) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
      ),
    },
    {
      title: t("quality.case.title"),
      dataIndex: "title",
      render: (v: string, r) => (
        <div>
          <div>{v}</div>
          {(r.featureMajor || r.featureMinor) && (
            <div className="qc-sub">
              {[r.featureMajor, r.featureMinor].filter(Boolean).join(" / ")}
            </div>
          )}
        </div>
      ),
    },
    {
      title: t("quality.case.category"),
      dataIndex: "category",
      width: 90,
      render: (v: TestCategory) => (
        <Tag color={TEST_CATEGORY_META[v].color} style={{ marginInlineEnd: 0 }}>
          {t(TEST_CATEGORY_META[v].i18nKey)}
        </Tag>
      ),
    },
    {
      title: t("quality.case.priority"),
      dataIndex: "priority",
      width: 72,
      render: (v: QcPriority) => (
        <span style={{ color: QC_PRIORITY_META[v].color, fontWeight: 600 }}>
          {t(QC_PRIORITY_META[v].i18nKey)}
        </span>
      ),
    },
    {
      title: t("quality.case.result"),
      dataIndex: "result",
      width: 118,
      render: (_v, r) => {
        const key = (r.result ?? "untested") as TestResult | "untested";
        return (
          <Select
            size="small"
            variant="borderless"
            value={key}
            style={{ width: 104 }}
            popupMatchSelectWidth={false}
            onChange={(val) => setResult(r, val)}
            options={RESULT_KEYS.map((k) => ({
              value: k,
              label: (
                <span
                  style={{ color: TEST_RESULT_META[k].color, fontWeight: 600 }}
                >
                  ● {t(TEST_RESULT_META[k].i18nKey)}
                </span>
              ),
            }))}
          />
        );
      },
    },
    {
      title: t("quality.case.assignee"),
      dataIndex: "executedByName",
      width: 96,
      render: (v?: string) => v || <span className="qc-muted">—</span>,
    },
    {
      title: t("quality.case.actions"),
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_v, r) => (
        <Space size={2}>
          <Tooltip title={t("quality.case.raiseBug")}>
            <Button
              type="text"
              size="small"
              icon={<BugOutlined />}
              onClick={() => openRaiseBug(r)}
            />
          </Tooltip>
          <Tooltip title={t("quality.case.edit")}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openCase(r)}
            />
          </Tooltip>
          <Popconfirm
            title={t("quality.case.deleteConfirm")}
            onConfirm={() => deleteCase(r)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="qc-cases">
      {/* 左：スイート一覧 */}
      <div className="qc-suites">
        <div className="qc-suites-head">
          <span>{t("quality.suite.title")}</span>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => openSuite()}
          >
            {t("quality.suite.add")}
          </Button>
        </div>
        <div
          className={`qc-suite-item ${p.activeSuite === "all" ? "active" : ""}`}
          onClick={() => p.setActiveSuite("all")}
        >
          <span>{t("quality.suite.all")}</span>
          <span className="qc-suite-count">{p.summary?.total.total ?? 0}</span>
        </div>
        {p.suites.map((s) => {
          const st = p.summaryBySuite[s.id];
          return (
            <div
              key={s.id}
              className={`qc-suite-item ${
                p.activeSuite === s.id ? "active" : ""
              }`}
              onClick={() => p.setActiveSuite(s.id)}
            >
              <div className="qc-suite-main">
                <span className="qc-ellipsis">{s.name}</span>
                <span className="qc-suite-count">{st?.total ?? 0}</span>
              </div>
              <Progress
                percent={st?.executionRate ?? 0}
                size="small"
                showInfo={false}
                strokeColor={(st?.fail ?? 0) > 0 ? "#f5222d" : "#52c41a"}
              />
              <div className="qc-suite-actions">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    openSuite(s);
                  }}
                />
                <Popconfirm
                  title={t("quality.suite.deleteConfirm")}
                  onConfirm={() => deleteSuite(s)}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </div>
            </div>
          );
        })}
        {p.suites.length === 0 && (
          <div className="qc-suite-empty">{t("quality.suite.empty")}</div>
        )}
      </div>

      {/* 右：ケース一覧 */}
      <div className="qc-case-main">
        <div className="qc-toolbar">
          <Space wrap>
            <Select
              allowClear
              placeholder={t("quality.case.filterResult")}
              style={{ width: 120 }}
              value={p.fResult}
              onChange={p.setFResult}
              options={RESULT_KEYS.map((k) => ({
                value: k,
                label: t(TEST_RESULT_META[k].i18nKey),
              }))}
            />
            <Select
              allowClear
              placeholder={t("quality.case.filterCategory")}
              style={{ width: 110 }}
              value={p.fCategory}
              onChange={p.setFCategory}
              options={CATEGORY_KEYS.map((k) => ({
                value: k,
                label: t(TEST_CATEGORY_META[k].i18nKey),
              }))}
            />
            <Select
              allowClear
              placeholder={t("quality.case.filterPriority")}
              style={{ width: 100 }}
              value={p.fPriority}
              onChange={p.setFPriority}
              options={PRIORITY_KEYS.map((k) => ({
                value: k,
                label: t(QC_PRIORITY_META[k].i18nKey),
              }))}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t("quality.case.filterAssignee")}
              style={{ width: 130 }}
              value={p.fAssignee}
              onChange={p.setFAssignee}
              options={assigneeOptions}
            />
            <TreeSelect
              allowClear
              showSearch
              treeDefaultExpandAll
              treeNodeFilterProp="title"
              placeholder={t("quality.case.filterFeature")}
              style={{ width: 200 }}
              value={p.fFeature}
              onChange={p.setFFeature}
              treeData={featureTree}
              popupMatchSelectWidth={false}
              disabled={featureTree.length === 0}
            />
            <Input.Search
              allowClear
              placeholder={t("quality.case.searchPlaceholder")}
              style={{ width: 200 }}
              value={p.fKeyword}
              onChange={(e) => p.setFKeyword(e.target.value)}
            />
          </Space>
          <Space>
            {p.selectedCaseIds.length > 0 && (
              <Select
                placeholder={t("quality.case.batchResult")}
                style={{ width: 190 }}
                value={undefined}
                onChange={bulkResult}
                options={RESULT_KEYS.map((k) => ({
                  value: k,
                  label: (
                    <span style={{ color: TEST_RESULT_META[k].color }}>
                      {t("quality.case.selectedN", {
                        n: p.selectedCaseIds.length,
                      })}
                      : {t(TEST_RESULT_META[k].i18nKey)}
                    </span>
                  ),
                }))}
              />
            )}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openCase()}
              disabled={p.suites.length === 0}
            >
              {t("quality.case.add")}
            </Button>
          </Space>
        </div>

        <Table<TestCase>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filtered}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          rowSelection={{
            selectedRowKeys: p.selectedCaseIds,
            onChange: (keys) => p.setSelectedCaseIds(keys as string[]),
          }}
          locale={{ emptyText: t("quality.case.empty") }}
        />

        {suiteStat && suiteStat.total > 0 && (
          <div className="qc-summary-bar">
            <span>
              {t("quality.case.result")}: {suiteStat.total} / OK{" "}
              {suiteStat.pass} / NG {suiteStat.fail} / {t("quality.result.na")}{" "}
              {suiteStat.na} / {t("quality.result.untested")}{" "}
              {suiteStat.untested}
            </span>
            <span>
              {t("quality.summary.execution", {})} {suiteStat.executionRate}% ·{" "}
              {t("quality.result.pass")} {suiteStat.passRate}%
            </span>
          </div>
        )}
      </div>

      {/* スイート modal */}
      <Modal
        title={
          suiteModal.editing ? t("quality.suite.edit") : t("quality.suite.add")
        }
        open={suiteModal.open}
        onCancel={() => setSuiteModal({ open: false })}
        onOk={submitSuite}
        okText={t("quality.common.save")}
        cancelText={t("quality.common.cancel")}
        destroyOnClose
      >
        <Form form={suiteForm} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label={t("quality.suite.name")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="casePrefix" label={t("quality.suite.prefix")}>
            <Input placeholder="STU" />
          </Form.Item>
          <Form.Item name="description" label={t("quality.suite.description")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="taskId" label={t("quality.suite.linkTask")}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={p.taskOptions}
              placeholder={t("quality.case.notLinked")}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ケース modal */}
      <Modal
        title={
          caseModal.editing ? t("quality.case.edit") : t("quality.case.add")
        }
        open={caseModal.open}
        onCancel={() => setCaseModal({ open: false })}
        onOk={submitCase}
        okText={t("quality.common.save")}
        cancelText={t("quality.common.cancel")}
        width={640}
        destroyOnClose
      >
        <Form form={caseForm} layout="vertical" preserve={false}>
          <Form.Item
            name="title"
            label={t("quality.case.title")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} align="start">
            <Form.Item name="featureMajor" label={t("quality.case.feature")}>
              <Input placeholder="大機能" />
            </Form.Item>
            <Form.Item name="featureMinor" label=" ">
              <Input placeholder="中機能/画面" />
            </Form.Item>
            <Form.Item name="category" label={t("quality.case.category")}>
              <Select
                style={{ width: 110 }}
                options={CATEGORY_KEYS.map((k) => ({
                  value: k,
                  label: t(TEST_CATEGORY_META[k].i18nKey),
                }))}
              />
            </Form.Item>
            <Form.Item name="priority" label={t("quality.case.priority")}>
              <Select
                style={{ width: 90 }}
                options={PRIORITY_KEYS.map((k) => ({
                  value: k,
                  label: t(QC_PRIORITY_META[k].i18nKey),
                }))}
              />
            </Form.Item>
          </Space>
          <Form.Item name="precondition" label={t("quality.case.precondition")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="steps" label={t("quality.case.steps")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="testData" label={t("quality.case.testData")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="expected" label={t("quality.case.expected")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="remark" label={t("quality.case.remark")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* バグ起票 modal */}
      <Modal
        title={
          bugModal.fromCase
            ? t("quality.bug.fromCase", { caseNo: bugModal.fromCase.caseNo })
            : t("quality.bug.add")
        }
        open={bugModal.open}
        onCancel={() => setBugModal({ open: false })}
        onOk={submitRaiseBug}
        okText={t("quality.case.raiseBug")}
        cancelText={t("quality.common.cancel")}
        width={640}
        destroyOnClose
      >
        <Form form={bugForm} layout="vertical" preserve={false}>
          <Form.Item
            name="title"
            label={t("quality.bug.title")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Space>
            <Form.Item name="severity" label={t("quality.bug.severity")}>
              <Select
                style={{ width: 100 }}
                options={PRIORITY_KEYS.map((k) => ({
                  value: k,
                  label: t(BUG_SEVERITY_META[k].i18nKey),
                }))}
              />
            </Form.Item>
            <Form.Item name="priority" label={t("quality.bug.priority")}>
              <Select
                style={{ width: 100 }}
                options={PRIORITY_KEYS.map((k) => ({
                  value: k,
                  label: t(QC_PRIORITY_META[k].i18nKey),
                }))}
              />
            </Form.Item>
            <Form.Item
              name="environmentId"
              label={t("quality.bug.environment")}
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ minWidth: 220 }}
                placeholder={t("quality.env.select")}
                notFoundContent={t("quality.env.emptyForProduct")}
                options={p.environments.map((e) => ({
                  value: e.id,
                  label: e.label ?? environmentLabel(e),
                }))}
              />
            </Form.Item>
          </Space>
          <Form.Item name="description" label={t("quality.bug.description")}>
            <Input.TextArea rows={6} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

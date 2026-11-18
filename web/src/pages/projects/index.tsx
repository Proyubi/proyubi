import {
  ArrowRightOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ActionType, ProColumns } from "@ant-design/pro-components";
import { PageContainer, ProTable } from "@ant-design/pro-components";
import SearchButton from "@/components/TaskSearchPalette/SearchButton";
import { openTaskSearch } from "@/components/TaskSearchPalette";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useIntl, useNavigate, useSearchParams } from "@umijs/max";
import {
  App as AntApp,
  Avatar,
  Badge,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Segmented,
  Select,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AnnualSchedule from "@/pm/annual/AnnualSchedule";
import ProjectFilterBar, {
  type ProjectFilter,
  type ProjectFilterCounts,
} from "./FilterBar";
import { useData } from "@/pm/store";
import {
  PROJECT_KIND_META,
  PROJECT_STATUS_META,
  type Project,
  type ProjectKind,
  type ProjectStatus,
} from "@/pm/types";
import dayjs, { fmt, fmtDuration } from "@/pm/utils/date";
import "./index.css";

/**
 * 期限超過：終了日が過ぎているのに終わっていないもの。
 * 期間列の赤字表示と絞り込みチップで同じ判定を使う（片方だけ直してズレるのを防ぐ）。
 * 終了日なし＝継続中（運用型）は期限が無いので対象外。
 */
function isOverdue(p: Project) {
  return (
    !!p.end &&
    p.status !== "done" &&
    (p.progress ?? 0) < 100 &&
    dayjs(p.end).isBefore(dayjs(), "day")
  );
}

// 头像底色：从客户 id 稳定散列出 antd 预设色板里的一个颜色
const AVATAR_PALETTE = [
  "#1677ff",
  "#722ed1",
  "#eb2f96",
  "#fa541c",
  "#fa8c16",
  "#13c2c2",
  "#52c41a",
  "#2f54eb",
];
function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function initials(name: string) {
  return name.trim().slice(0, 2);
}

// 记住上次选中的客户/产品，刷新后恢复（跨租户的陈旧 id 会被 stillValid 校验兜底）
const SELECTED_CUST_KEY = "pm.projects.selectedCustomerId";
function readStoredCustomerId(): string | null {
  try {
    return localStorage.getItem(SELECTED_CUST_KEY);
  } catch {
    return null;
  }
}

// 左侧「顧客 / 製品」列表的折叠状态（只显示头像图标），刷新后恢复
const CUST_COLLAPSED_KEY = "pm.projects.customerPanelCollapsed";
function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(CUST_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

// ===== 拖动排序：dnd-kit 行包装 + 拖拽手柄 =====
// 拖动是否可用（仅「手动顺序」视图：无搜索/筛选/列排序）。由表格 request 计算后下发，
// 行组件与手柄据此 grey-out。
const DragEnabledContext = createContext(false);

interface RowCtx {
  setActivatorNodeRef?: (el: HTMLElement | null) => void;
  listeners?: Record<string, (...args: unknown[]) => void>;
  enabled: boolean;
}
const RowContext = createContext<RowCtx>({ enabled: false });

function DragHandle({
  hint,
  disabledHint,
}: {
  hint: string;
  disabledHint: string;
}) {
  const { setActivatorNodeRef, listeners, enabled } = useContext(RowContext);
  return (
    <Tooltip title={enabled ? hint : disabledHint}>
      <Button
        type="text"
        size="small"
        ref={setActivatorNodeRef}
        icon={<HolderOutlined />}
        style={{
          cursor: enabled ? "grab" : "not-allowed",
          color: enabled ? undefined : "#c0c4cc",
          touchAction: "none",
        }}
        {...(enabled ? listeners : {})}
      />
    </Tooltip>
  );
}

type DraggableRowProps = React.HTMLAttributes<HTMLTableRowElement> & {
  "data-row-key"?: string;
};
function DraggableRow(props: DraggableRowProps) {
  const enabled = useContext(DragEnabledContext);
  const id = props["data-row-key"] ?? "";
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !enabled });
  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 999 } : {}),
  };
  const ctx = useMemo<RowCtx>(
    () => ({
      setActivatorNodeRef,
      listeners: listeners as RowCtx["listeners"],
      enabled,
    }),
    [setActivatorNodeRef, listeners, enabled]
  );
  return (
    <RowContext.Provider value={ctx}>
      <tr {...props} ref={setNodeRef} style={style} {...attributes} />
    </RowContext.Provider>
  );
}

export default function ProjectListPage() {
  const {
    projects,
    customers,
    customerMap,
    addProject,
    updateProject,
    deleteProject,
    reorderProjects,
    addCustomer,
    teams,
    ensureBase,
    baseLoaded,
    hoursPerWorkday,
  } = useData();
  // 月次工数枠は契約書と同じ「人日」で入力させ、保存時に分へ換算する（1営業日＝テナント設定の時間数）
  const minutesPerDay = Math.round(hoursPerWorkday * 60);
  // 多团队：仅当租户有多个团队时，新建客户需选择归属团队
  const multiTeam = teams.length > 1;
  const { message, modal } = AntApp.useApp();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  // 从甘特图返回时携带的客户 id，用于恢复之前选中的产品
  const initialCustomerId = searchParams.get("customerId");
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  const [custKw, setCustKw] = useState("");
  // 左列折叠：只保留头像图标一列，把横向空间让给右侧表格
  const [custCollapsed, setCustCollapsed] = useState(readStoredCollapsed);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 右侧视图：版本一览（表格） / 年度スケジュール（按产品维护）
  const [rightView, setRightView] = useState<"list" | "annual">("list");
  // 表格内の絞り込み行。kwInput は入力欄の値、kw は実際に絞り込みへ渡す値
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");
  const actionRef = useRef<ActionType>(null);

  // 拖动排序：当前页行 id（SortableContext items）+ 是否可拖（无搜索/筛选时）
  const [pageRowIds, setPageRowIds] = useState<string[]>([]);
  const [dragEnabled, setDragEnabled] = useState(false);
  // 表格当前「全量显示顺序」（已应用列排序、分页前），拖动以此为基准计算新顺序
  const orderedIdsRef = useRef<string[]>([]);
  // 拖动后强制 remount 表格：清掉列排序、并让 ProTable 刷新行顺序
  const [tableKey, setTableKey] = useState(0);
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !selectedId) return;
    // 以「当前显示顺序」为基准 arrayMove（含列排序后的顺序；当前页是其连续切片）
    const fullIds = orderedIdsRef.current;
    const from = fullIds.indexOf(String(active.id));
    const to = fullIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(fullIds, from, to);
    // reorderProjects 内部先同步乐观更新 store（手动顺序），再 await 落库
    const promise = reorderProjects(selectedId, next);
    // 强制 remount 表格：① 清掉列排序切回手动顺序；
    // ② ProTable 对「行集合相同、仅顺序变化」的 reload 不会重排，remount 才能刷新顺序
    setTableKey((k) => k + 1);
    promise
      .then(() => message.success(t("projects.reordered")))
      .catch(() => {
        /* 失败已在 store 回滚 + 全局 toast */
      });
  };

  // 版本弹窗
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  // 種別に応じて期間フォームの必須／プレースホルダを切り替える（ops のみ終了日を空で確定できる）
  const formKind: ProjectKind = Form.useWatch("kind", form) ?? "project";

  // 新建客户弹窗
  const [custOpen, setCustOpen] = useState(false);
  const [custSubmitting, setCustSubmitting] = useState(false);
  const [custForm] = Form.useForm();

  useEffect(() => {
    ensureBase();
  }, [ensureBase]);

  // 每个客户的版本数 / 平均进度
  // 平均進捗の分母は通常项目だけ（rated）：運用型は範囲が伸び続けるので進捗率が達成率にならず、
  // 混ぜると顧客全体の平均まで鋸歯状になる。件数(count)には運用型も数える。
  const custStats = useMemo(() => {
    const m = new Map<string, { count: number; rated: number; sum: number }>();
    for (const p of projects) {
      const s = m.get(p.customerId) ?? { count: 0, rated: 0, sum: 0 };
      s.count += 1;
      if (p.kind !== "ops") {
        s.rated += 1;
        s.sum += p.progress ?? 0;
      }
      m.set(p.customerId, s);
    }
    return m;
  }, [projects]);

  // 左列：客户列表（按关键词过滤，按名称排序）
  const custList = useMemo(() => {
    const kw = custKw.trim().toLowerCase();
    return customers
      .filter((c) =>
        kw ? `${c.name} ${c.shortName ?? ""}`.toLowerCase().includes(kw) : true
      )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, custKw]);

  // 默认选中第一个（优先有版本的客户）
  useEffect(() => {
    if (!baseLoaded) return;
    const stillValid = selectedId && customers.some((c) => c.id === selectedId);
    if (stillValid) return;
    // 优先恢复甘特图返回时携带的客户
    if (
      initialCustomerId &&
      customers.some((c) => c.id === initialCustomerId)
    ) {
      setSelectedId(initialCustomerId);
      return;
    }
    // 其次恢复上次手动选中的客户（刷新前记住的）
    const stored = readStoredCustomerId();
    if (stored && customers.some((c) => c.id === stored)) {
      setSelectedId(stored);
      return;
    }
    const withProjects = custList.find(
      (c) => (custStats.get(c.id)?.count ?? 0) > 0
    );
    setSelectedId(withProjects?.id ?? custList[0]?.id ?? null);
  }, [
    baseLoaded,
    customers,
    custList,
    custStats,
    selectedId,
    initialCustomerId,
  ]);

  const selectedCustomer = selectedId ? customerMap[selectedId] : undefined;

  // 切换客户 → 重置表格到第一页并重新拉取，并记住选中项供刷新后恢复
  useEffect(() => {
    // 顧客ごとに件数も状態の内訳も変わるので、絞り込みは引き継がず必ず解除する
    setFilter("all");
    setKwInput("");
    setKw("");
    actionRef.current?.reloadAndRest?.();
    if (!selectedId) return;
    try {
      localStorage.setItem(SELECTED_CUST_KEY, selectedId);
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, [selectedId]);
  // 项目数据变化（增删改后）→ 刷新当前页
  useEffect(() => {
    actionRef.current?.reload();
  }, [projects]);

  // 入力の度に絞り込むと日本語 IME の変換中もチラつくので、確定を待てる程度だけ遅らせる
  useEffect(() => {
    const timer = window.setTimeout(() => setKw(kwInput.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [kwInput]);

  // 絞り込み条件が変わったら 1 ページ目から取り直す
  // （2 ページ目のまま絞ると「該当ありません」に見えてしまう）
  useEffect(() => {
    actionRef.current?.reloadAndRest?.();
  }, [kw, filter]);

  // 選択中の顧客配下でのチップ件数。0 件のチップは押せないようにするため常に出す
  const filterCounts = useMemo(() => {
    const c: ProjectFilterCounts = {
      all: 0,
      planned: 0,
      active: 0,
      paused: 0,
      done: 0,
      overdue: 0,
    };
    if (!selectedId) return c;
    for (const p of projects) {
      if (p.customerId !== selectedId) continue;
      c.all += 1;
      c[p.status] += 1;
      if (isOverdue(p)) c.overdue += 1;
    }
    return c;
  }, [projects, selectedId]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    if (selectedId) form.setFieldsValue({ customerId: selectedId });
    setCreating(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    form.setFieldsValue({
      customerId: p.customerId,
      name: p.name,
      description: p.description,
      status: p.status,
      kind: p.kind ?? "project",
      quotaDays: p.monthlyQuotaMinutes
        ? Math.round((p.monthlyQuotaMinutes / minutesPerDay) * 100) / 100
        : undefined,
      // 運用型は終了日が null（＝継続中）でありうる。RangePicker の後端は空のまま開く
      range: [dayjs(p.start), p.end ? dayjs(p.end) : null],
    });
    setCreating(true);
  };

  const confirmDelete = (p: Project) => {
    const c = customerMap[p.customerId];
    modal.confirm({
      title: t("projects.delete.title"),
      content: t("projects.delete.content", {
        customer: c?.name ?? "",
        name: p.name,
      }),
      okText: t("projects.delete.ok"),
      okButtonProps: { danger: true },
      cancelText: t("projects.cancel"),
      onOk: async () => {
        await deleteProject(p.id);
        message.success(t("projects.deleted"));
      },
    });
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const end = v.range?.[1] ? v.range[1].format("YYYY-MM-DD") : null;
      // 枠なし（空欄）は 0 を送る＝後端が null にクリアする。通常项目は枠の概念自体がない
      const quotaDays = v.kind === "ops" ? (v.quotaDays ?? 0) : 0;
      const payload = {
        customerId: v.customerId,
        name: v.name,
        description: v.description,
        status: (v.status ?? "planned") as ProjectStatus,
        kind: (v.kind ?? "project") as ProjectKind,
        start: v.range[0].format("YYYY-MM-DD"),
        end,
        monthlyQuotaMinutes: Math.round(quotaDays * minutesPerDay),
      };
      if (editing) {
        // 終了日を空にした＝「継続中に戻す」。end:null だけでは未変更と区別できないため明示フラグを送る
        await updateProject(editing.id, { ...payload, clearEnd: end === null });
        message.success(t("projects.updated"));
      } else {
        await addProject(payload);
        message.success(t("projects.created"));
        setSelectedId(v.customerId);
      }
      setCreating(false);
      setEditing(null);
      form.resetFields();
    } finally {
      setSubmitting(false);
    }
  };

  const submitCustomer = async () => {
    const v = await custForm.validateFields();
    setCustSubmitting(true);
    try {
      const c = await addCustomer(v.name, v.shortName, v.teamId);
      message.success(t("projects.customer.created"));
      setSelectedId(c.id);
      setCustOpen(false);
      custForm.resetFields();
    } finally {
      setCustSubmitting(false);
    }
  };

  // 折叠/展开左列；折叠时清掉搜索词（输入框被隐藏，留着会造成「列表少了」的错觉）
  const toggleCustCollapsed = () => {
    setCustCollapsed((prev) => {
      const next = !prev;
      if (next) setCustKw("");
      try {
        localStorage.setItem(CUST_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* localStorage 不可用时忽略 */
      }
      return next;
    });
  };

  // 右侧表格列
  const columns: ProColumns<Project>[] = [
    {
      title: "",
      dataIndex: "sort",
      width: 44,
      align: "center",
      search: false,
      render: () => (
        <DragHandle
          hint={t("projects.drag.hint")}
          disabledHint={t("projects.drag.disabled")}
        />
      ),
    },
    {
      title: t("projects.form.name"),
      dataIndex: "name",
      width: 240,
      ellipsis: true,
      // 絞り込みは下の検索行（ProjectFilterBar）に一本化した
      search: false,
      sorter: true,
      render: (_, p) => (
        <a
          className="pm-tbl-name"
          onClick={() => nav(`/projects/${p.id}/gantt`)}
        >
          {p.name}
        </a>
      ),
    },
    {
      title: t("projects.form.description"),
      dataIndex: "description",
      width: 220,
      ellipsis: true,
      search: false,
      render: (_, p) =>
        p.description || (
          <span className="pm-tbl-muted">{t("projects.card.noDesc")}</span>
        ),
    },
    {
      title: t("projects.form.status"),
      dataIndex: "status",
      width: 110,
      search: false,
      sorter: true,
      render: (_, p) => {
        const meta = PROJECT_STATUS_META[p.status];
        return (
          <Tag color={meta.color} variant="filled">
            {t(meta.i18nKey)}
          </Tag>
        );
      },
    },
    {
      title: t("projects.form.range"),
      dataIndex: "range",
      width: 210,
      search: false,
      sorter: true,
      render: (_, p) => {
        // 終了日なし＝継続中（運用型）。期限がないので「遅れ」判定もしない
        if (!p.end) {
          return (
            <span className="pm-tbl-date">
              {fmt(p.start, "YYYY/MM/DD")} —{" "}
              <span className="pm-tbl-ongoing">
                {t("projects.card.ongoing")}
              </span>
            </span>
          );
        }
        const overdue = isOverdue(p);
        return (
          <span className="pm-tbl-date">
            {fmt(p.start, "YYYY/MM/DD")} — {fmt(p.end, "YYYY/MM/DD")}
            {overdue && (
              <span className="pm-tbl-overdue">
                · {t("projects.card.overdue")}
              </span>
            )}
          </span>
        );
      },
    },
    {
      title: t("projects.col.progress"),
      dataIndex: "progress",
      width: 160,
      search: false,
      sorter: true,
      render: (_, p) => {
        // 運用型：進捗率はタスクが随時増える分母のせいで鋸歯状になり達成率として読めないため、
        // 「今月の消化件数 + 未完了の滞留件数」というフロー指標に差し替える（保守運用の実務指標）
        if (p.kind === "ops") {
          const done = p.monthDoneCount ?? 0;
          const total = p.monthTotalCount ?? 0;
          const open = p.openTaskCount ?? 0;
          const quota = p.monthlyQuotaMinutes ?? 0;
          const used = p.monthActualMinutes ?? 0;
          const planned = p.monthPlannedMinutes ?? 0;
          // 実績が未入力のうちは 0 のままになるので、その場合だけ予定を見込みとして出す。
          // 「実績 0」を黙って予定で埋めると消化率を過大に見せることになるため、ラベルで区別する。
          const showPlanned = used === 0 && planned > 0;
          const shown = showPlanned ? planned : used;
          const over = quota > 0 && shown > quota;
          const counts = (
            <span className="pm-tbl-ops-month">
              {t("projects.ops.thisMonth", { done, total })}
            </span>
          );
          if (quota <= 0) {
            // 枠を設定していない運用プロジェクトは従来どおり件数だけ
            return (
              <div className="pm-tbl-ops">
                {counts}
                <Tag
                  color={open > 0 ? "processing" : "default"}
                  variant="filled"
                  className="pm-tbl-ops-open"
                >
                  {t("projects.ops.open", { count: open })}
                </Tag>
              </div>
            );
          }
          return (
            <Tooltip
              title={t("projects.ops.quotaTooltip", {
                planned: fmtDuration(planned),
                actual: fmtDuration(used),
                quota: fmtDuration(quota),
              })}
            >
              <div className="pm-tbl-quota">
                <div className="pm-tbl-quota-head">
                  <span
                    className={`pm-tbl-quota-num${over ? " is-over" : ""}`}
                  >
                    {t(
                      showPlanned
                        ? "projects.ops.quotaPlanned"
                        : "projects.ops.quotaActual",
                      { used: fmtDuration(shown), quota: fmtDuration(quota) }
                    )}
                  </span>
                  {over && (
                    <Tag color="warning" variant="filled">
                      {t("projects.ops.quotaOver")}
                    </Tag>
                  )}
                </div>
                <div className="pm-tbl-quota-rail">
                  <span
                    className={`pm-tbl-quota-fill${over ? " is-over" : ""}${
                      showPlanned ? " is-planned" : ""
                    }`}
                    style={{
                      width: `${Math.min(100, (shown / quota) * 100)}%`,
                    }}
                  />
                </div>
                <div className="pm-tbl-quota-sub">
                  {counts}
                  <span className="pm-tbl-ops-sep">·</span>
                  <span>{t("projects.ops.open", { count: open })}</span>
                </div>
              </div>
            </Tooltip>
          );
        }
        const pct = p.progress ?? 0;
        return (
          <Progress
            percent={pct}
            size="small"
            strokeColor={pct === 100 ? "#52c41a" : "#2f6bff"}
            railColor="#f0f2f5"
          />
        );
      },
    },
    {
      title: t("projects.col.actions"),
      valueType: "option",
      width: 120,
      render: (_, p) => [
        <Tooltip key="enter" title={t("projects.card.enter")}>
          <a
            className="pm-tbl-act"
            onClick={() => nav(`/projects/${p.id}/gantt`)}
          >
            <ArrowRightOutlined />
          </a>
        </Tooltip>,
        <Tooltip key="edit" title={t("projects.card.edit")}>
          <a className="pm-tbl-act" onClick={() => openEdit(p)}>
            <EditOutlined />
          </a>
        </Tooltip>,
        <Tooltip key="del" title={t("projects.card.delete")}>
          <a
            className="pm-tbl-act pm-tbl-danger"
            onClick={() => confirmDelete(p)}
          >
            <DeleteOutlined />
          </a>
        </Tooltip>,
      ],
    },
  ];

  return (
    <PageContainer
      title={t("projects.title")}
      subTitle={t("projects.subtitle")}
      /* 案件名フィルタ（下の検索行）は「この一覧を絞る」もの。こちらは案件を跨いで
         タスク / バグまで探す ⌘K パレットの入口なので、混同しないようヘッダー側に離す。
         ビュー切替もここに置く＝俯瞰の「全社俯瞰 / マイタスク」と同じ並び。 */
      extra={[
        <SearchButton key="search" />,
        <Segmented<"list" | "annual">
          key="view"
          value={rightView}
          onChange={setRightView}
          options={[
            { value: "list", label: t("projects.view.list") },
            { value: "annual", label: t("projects.view.annual") },
          ]}
        />,
      ]}
    >
      {!baseLoaded ? (
        <div className="pm-loading">
          <Spin size="large" />
        </div>
      ) : (
        <div className={`pm-body${custCollapsed ? " is-collapsed" : ""}`}>
          {/* 左：客户 / 产品（可折叠成只剩头像图标）
              外层 wrap 只负责占位（被 grid 拉伸到行高），Card 用 absolute 填满它——
              绝对定位的卡片不参与行高计算，所以客户再多也撑不高行，
              左卡高度只由右侧表格（或 --pm-panel-min-h）决定，底部自然齐平 */}
          <div className="pm-left-wrap">
            <Card
              size="small"
              className={`pm-left${custCollapsed ? " is-collapsed" : ""}`}
              title={custCollapsed ? undefined : t("projects.customers.title")}
              extra={
                <div className="pm-left-actions">
                  {!custCollapsed && (
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      title={t("projects.customers.new")}
                      onClick={() => {
                        custForm.resetFields();
                        setCustOpen(true);
                      }}
                    />
                  )}
                  <Tooltip
                    title={t(
                      custCollapsed
                        ? "projects.customers.expand"
                        : "projects.customers.collapse"
                    )}
                    placement="right"
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={
                        custCollapsed ? (
                          <MenuUnfoldOutlined />
                        ) : (
                          <MenuFoldOutlined />
                        )
                      }
                      onClick={toggleCustCollapsed}
                    />
                  </Tooltip>
                </div>
              }
              styles={{ body: { padding: 8 } }}
            >
              {!custCollapsed && (
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder={t("projects.customers.searchPlaceholder")}
                  value={custKw}
                  onChange={(e) => setCustKw(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
              )}
              <div className="pm-cust-list">
                {custList.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      custCollapsed ? null : t("projects.customers.empty")
                    }
                    style={{ margin: "24px 0" }}
                  />
                ) : (
                  custList.map((c) => {
                    const st = custStats.get(c.id);
                    const count = st?.count ?? 0;
                    const rated = st?.rated ?? 0;
                    const avg = rated ? Math.round((st?.sum ?? 0) / rated) : 0;
                    const active = c.id === selectedId;
                    const avatar = (
                      <Avatar
                        shape="square"
                        style={{
                          background: avatarColor(c.id),
                          flex: "0 0 auto",
                        }}
                      >
                        {initials(c.name)}
                      </Avatar>
                    );
                    return (
                      // 折叠时名称/件数只能靠 Tooltip 呈现；展开时 title 传空串即不显示
                      <Tooltip
                        key={c.id}
                        placement="right"
                        title={
                          custCollapsed
                            ? `${c.name} · ${t("projects.customers.count", {
                                count,
                              })}`
                            : ""
                        }
                      >
                        <div
                          className={`pm-cust${active ? " is-active" : ""}`}
                          onClick={() => setSelectedId(c.id)}
                        >
                          {custCollapsed ? (
                            <Badge
                              count={count}
                              size="small"
                              offset={[-2, 2]}
                              color={active ? "#2f6bff" : "#c2c8d2"}
                            >
                              {avatar}
                            </Badge>
                          ) : (
                            avatar
                          )}
                          <div className="pm-cust-info">
                            <div className="pm-cust-name">{c.name}</div>
                            <div className="pm-cust-sub">
                              {t("projects.customers.count", { count })}
                              {rated > 0 &&
                                ` · ${t("projects.customers.avg", { avg })}`}
                            </div>
                          </div>
                          <Tag
                            color={active ? "blue" : "default"}
                            variant="filled"
                            style={{ marginInlineEnd: 0 }}
                          >
                            {count}
                          </Tag>
                        </div>
                      </Tooltip>
                    );
                  })
                )}
              </div>
            </Card>
          </div>

          {/* 右：版本表格 / 年度スケジュール
              ビュー切替は PageContainer の extra（俯瞰と同じ位置）に上げてあるので、
              ここは中身から始まる ＝ 左の「顧客 / 製品」カードと上端が揃う */}
          <div className="pm-right">
            {rightView === "annual" ? (
              <AnnualSchedule
                projects={projects.filter((p) => p.customerId === selectedId)}
                customerName={selectedCustomer?.name}
                onOpenProject={(id) => nav(`/projects/${id}/gantt`)}
                onEditProject={openEdit}
                onCreate={openCreate}
              />
            ) : (
              <DndContext
                sensors={dragSensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={pageRowIds}
                  strategy={verticalListSortingStrategy}
                >
                  <DragEnabledContext.Provider value={dragEnabled}>
                    <ProTable<Project>
                      key={tableKey}
                      rowKey="id"
                      actionRef={actionRef}
                      columns={columns}
                      cardBordered
                      components={{ body: { row: DraggableRow } }}
                      headerTitle={
                        <span className="pm-tbl-title">
                          {selectedCustomer?.name ?? "—"}
                        </span>
                      }
                      /* 既定の検索パネルはカードの外に出てしまい「全体検索」に
                         見えるので使わない。同じ絞り込みは toolbar の 2 行目
                         （multipleLine + filter）に置く＝カードの中に収まる。 */
                      search={false}
                      toolbar={{
                        multipleLine: true,
                        filter: (
                          <ProjectFilterBar
                            counts={filterCounts}
                            value={filter}
                            onChange={setFilter}
                            keyword={kwInput}
                            onKeyword={setKwInput}
                            disabled={!selectedId}
                          />
                        ),
                      }}
                      dateFormatter="string"
                      /* y を渡すのは「表头固定 + body だけスクロール」の
                         2 テーブル構成にするため。実際の高さは index.css 側で
                         grid 行の残りぶんに置き換える（max-height を打ち消す）ので、
                         ここの数値自体は効かない＝行数で外側の高さは変わらない。 */
                      scroll={{ x: 1104, y: 360 }}
                      pagination={{
                        defaultPageSize: 20,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                      }}
                      locale={{
                        emptyText: (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                              selectedId
                                ? custStats.get(selectedId)?.count
                                  ? kw
                                    ? t("projects.filter.emptyKw", { kw })
                                    : t("projects.noMatch")
                                  : t("projects.emptyHint")
                                : t("projects.selectCustomerFirst")
                            }
                          >
                            {/* この行はプロジェクトしか見ないので、打った語が
                                タスクやバグの名前だと空振りする。そのまま
                                ⌘K パレットへ渡して探し直せるようにしておく */}
                            {kw && (
                              <Button
                                className="pm-filter-bridge"
                                icon={<SearchOutlined />}
                                onClick={() => openTaskSearch(kw)}
                              >
                                {t("projects.filter.bridge", { kw })}
                              </Button>
                            )}
                          </Empty>
                        ),
                      }}
                      toolBarRender={() => [
                        <Button
                          key="create"
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={openCreate}
                          disabled={!selectedId}
                        >
                          {t("projects.create")}
                        </Button>,
                      ]}
                      request={async (params, sort) => {
                        if (!selectedId) {
                          orderedIdsRef.current = [];
                          setPageRowIds([]);
                          setDragEnabled(false);
                          return { data: [], success: true, total: 0 };
                        }
                        const q = kw.toLowerCase();
                        let list = projects.filter(
                          (p) => p.customerId === selectedId
                        );
                        if (filter === "overdue") {
                          list = list.filter(isOverdue);
                        } else if (filter !== "all") {
                          list = list.filter((p) => p.status === filter);
                        }
                        if (q) {
                          list = list.filter((p) =>
                            `${p.name} ${p.description ?? ""}`
                              .toLowerCase()
                              .includes(q)
                          );
                        }
                        // 列排序优先；无列排序时保持「手动顺序」（store/后端 sort_order 顺序）。
                        // 注意：ProTable 传入的 sort 形如 {name:null,status:null,...}（含全部可排序列、
                        // 无排序时值为 null），不能取 Object.keys()[0]，否则会被当成 name 降序——
                        // 必须挑出真正有方向（ascend/descend）的那一列。
                        const sortKey = sort
                          ? Object.keys(sort).find(
                              (k) =>
                                sort[k] === "ascend" || sort[k] === "descend"
                            )
                          : undefined;
                        if (sortKey) {
                          const dir = sort?.[sortKey] === "ascend" ? 1 : -1;
                          list = list.slice().sort((a, b) => {
                            let r = 0;
                            switch (sortKey) {
                              case "name":
                                r = a.name.localeCompare(b.name);
                                break;
                              case "status":
                                r = a.status.localeCompare(b.status);
                                break;
                              case "progress":
                                r = (a.progress ?? 0) - (b.progress ?? 0);
                                break;
                              case "range":
                                r = a.start.localeCompare(b.start);
                                break;
                            }
                            return r * dir;
                          });
                        }
                        // 当前显示顺序（分页前全量）→ 拖动基准
                        orderedIdsRef.current = list.map((p) => p.id);
                        // 列排序下仍可拖动（拖后自动清排序）；仅搜索/筛选时禁用
                        setDragEnabled(!q && filter === "all");
                        const total = list.length;
                        const current = params.current ?? 1;
                        const pageSize = params.pageSize ?? 10;
                        const data = list.slice(
                          (current - 1) * pageSize,
                          current * pageSize
                        );
                        setPageRowIds(data.map((d) => d.id));
                        return { data, success: true, total };
                      }}
                    />
                  </DragEnabledContext.Provider>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      )}

      {/* 版本弹窗 */}
      <Modal
        title={t(
          editing ? "projects.form.editTitle" : "projects.form.createTitle"
        )}
        open={creating}
        onOk={submit}
        confirmLoading={submitting}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
        }}
        okText={t(editing ? "projects.form.save" : "projects.form.create")}
        cancelText={t("projects.cancel")}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="customerId"
            label={t("projects.form.customer")}
            rules={[
              { required: true, message: t("projects.form.customerRequired") },
            ]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t("projects.form.customerPlaceholder")}
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={t("projects.form.name")}
            rules={[
              { required: true, message: t("projects.form.nameRequired") },
            ]}
          >
            <Input placeholder={t("projects.form.namePlaceholder")} />
          </Form.Item>
          <Form.Item name="description" label={t("projects.form.description")}>
            <Input.TextArea
              rows={2}
              placeholder={t("projects.form.descriptionPlaceholder")}
            />
          </Form.Item>
          <Form.Item
            name="status"
            label={t("projects.form.status")}
            initialValue="planned"
            rules={[
              { required: true, message: t("projects.form.statusRequired") },
            ]}
          >
            <Select
              options={(
                Object.keys(PROJECT_STATUS_META) as ProjectStatus[]
              ).map((s) => ({
                value: s,
                label: t(PROJECT_STATUS_META[s].i18nKey),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="kind"
            label={t("projects.form.kind")}
            initialValue="project"
            tooltip={t("projects.form.kindTip")}
            rules={[
              { required: true, message: t("projects.form.kindRequired") },
            ]}
          >
            <Select
              options={(Object.keys(PROJECT_KIND_META) as ProjectKind[]).map(
                (k) => ({
                  value: k,
                  label: t(PROJECT_KIND_META[k].i18nKey),
                  // 選択肢の下に一行で「どっちを選ぶべきか」を出す（種別は初見で迷う）
                  desc: t(PROJECT_KIND_META[k].descKey),
                })
              )}
              optionRender={(o) => (
                <div>
                  <div>{o.data.label}</div>
                  <div className="pm-opt-desc">{o.data.desc}</div>
                </div>
              )}
            />
          </Form.Item>
          <Form.Item
            name="range"
            label={t("projects.form.range")}
            // 運用型は終了日未定（継続中）を許すので、必須チェックは開始日だけに掛ける
            rules={[
              {
                validator: (_, value: (dayjs.Dayjs | null)[] | undefined) => {
                  if (!value?.[0]) {
                    return Promise.reject(
                      new Error(t("projects.form.rangeRequired"))
                    );
                  }
                  if (!value[1] && formKind !== "ops") {
                    return Promise.reject(
                      new Error(t("projects.form.endRequired"))
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
            extra={formKind === "ops" ? t("projects.form.endOptional") : null}
            initialValue={[dayjs(), dayjs().add(60, "day")]}
          >
            <DatePicker.RangePicker
              style={{ width: "100%" }}
              // 運用型のみ後端を空のまま確定できる
              allowEmpty={[false, formKind === "ops"]}
              placeholder={[
                t("projects.form.startPlaceholder"),
                formKind === "ops"
                  ? t("projects.form.endOngoing")
                  : t("projects.form.endPlaceholder"),
              ]}
            />
          </Form.Item>
          {/* 月次工数枠は保守契約にしか存在しない概念なので、運用型のときだけ出す */}
          {formKind === "ops" && (
            <Form.Item
              name="quotaDays"
              label={t("projects.form.quota")}
              tooltip={t("projects.form.quotaTip")}
              extra={t("projects.form.quotaOptional")}
            >
              <InputNumber
                min={0}
                step={0.5}
                precision={2}
                style={{ width: "100%" }}
                addonAfter={t("projects.form.quotaUnit")}
                placeholder={t("projects.form.quotaPlaceholder")}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 新建客户弹窗 */}
      <Modal
        title={t("projects.customer.createTitle")}
        open={custOpen}
        onOk={submitCustomer}
        confirmLoading={custSubmitting}
        onCancel={() => setCustOpen(false)}
        okText={t("projects.customer.create")}
        cancelText={t("projects.cancel")}
        destroyOnHidden
      >
        <Form form={custForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label={t("projects.customer.name")}
            rules={[
              { required: true, message: t("projects.customer.nameRequired") },
            ]}
          >
            <Input placeholder={t("projects.customer.namePlaceholder")} />
          </Form.Item>
          <Form.Item name="shortName" label={t("projects.customer.shortName")}>
            <Input placeholder={t("projects.customer.shortNamePlaceholder")} />
          </Form.Item>
          {multiTeam && (
            <Form.Item
              name="teamId"
              label={t("projects.customer.team")}
              initialValue={
                teams.find((tm) => tm.isDefault)?.id ?? teams[0]?.id
              }
              rules={[
                {
                  required: true,
                  message: t("projects.customer.teamRequired"),
                },
              ]}
            >
              <Select
                options={teams.map((tm) => ({
                  label: tm.name,
                  value: tm.id,
                }))}
                placeholder={t("projects.customer.teamPlaceholder")}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </PageContainer>
  );
}

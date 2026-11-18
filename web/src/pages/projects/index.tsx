import SubProjectAddButton from "./SubProjectAddButton";
import { expandedProjectIds } from "@/pm/utils/projectExpansion";
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  HolderOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ActionType, ProColumns } from "@ant-design/pro-components";
import { PageContainer, ProTable } from "@ant-design/pro-components";
import SearchButton from "@/components/TaskSearchPalette/SearchButton";
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
import { useIntl, useModel, useNavigate, useSearchParams } from "@umijs/max";
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
  PROJECT_DISPLAY_STATUS_META,
  projectDisplayStatus,
} from "@/pm/utils/projectStatus";
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
  applyProjectFilter,
  EMPTY_PROJECT_FILTER,
  isProjectFilterEmpty,
  isOverdue,
  type ProjectFilter,
  type ProjectFilterCounts,
} from "./FilterBar";
import ProjectCardGrid, {
  opsMonthCounts,
  useCreateEntryText,
} from "./ProjectCardGrid";
import SubProjectDrawer from "./SubProjectDrawer";
import TableMoreMenu, { type TableDensity } from "./TableMoreMenu";
import { shouldOpenProjectRow } from "./projectRowInteraction";
import { useData } from "@/pm/store";
import {
  PROJECT_KIND_META,
  type Project,
  type ProjectKind,
} from "@/pm/types";
import dayjs, { fmt, fmtDuration } from "@/pm/utils/date";
import {
  extendedParentRange,
  groupChildren,
  isOverdueWithSubs,
  subSummary,
} from "@/pm/utils/projectTree";
import "./index.css";

/** 表の行。トップレベルの親は children にサブを持つ。 */
type Row = Project & {
  children?: Row[];
  __last?: boolean;
};
/**
 * 表の最小幅（＝列幅の合計 36+206+112+96+196+136+100）。
 * 1440×900・サイドバー折りたたみ（64）・顧客パネル展開（320）のとき表の実幅は約 910px なので、
 * それ以下に収めて横スクロールなしで「進捗」「操作」列まで見えるようにする（旧 1104 では進捗が切れた）。
 * 実幅がこれより広ければ antd が各列を比例して広げる。
 */
const TABLE_SCROLL_X = 882;

// 默认展开，只有手动折叠的父项目需要保存；不沿用旧版默认收起记录。
const COLLAPSED_KEY = "pm.projects.collapsedIds";
function readStoredCollapsedProjects(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
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

// 「版本一覧」内の表示形式（リスト / カード）。ユーザーごとに記憶し、
// ブラウザを閉じても / ページを移動しても前回の選択で開く。
// 同じブラウザを別アカウントで使っても混ざらないよう、キーにチーム + ログイン ID を含める
type ViewMode = "list" | "card";
const VIEW_MODE_KEY = "pm.projects.viewMode";
function viewModeKey(user?: { tenantId?: string; loginId?: string }) {
  return user?.loginId
    ? `${VIEW_MODE_KEY}:${user.tenantId ?? ""}:${user.loginId}`
    : VIEW_MODE_KEY;
}
function readStoredViewMode(key: string): ViewMode {
  try {
    // ユーザー別キーが未保存なら、旧（ブラウザ共通）キーの値を引き継ぐ
    const v = localStorage.getItem(key) ?? localStorage.getItem(VIEW_MODE_KEY);
    return v === "card" ? "card" : "list";
  } catch {
    return "list";
  }
}

// リスト表示の密度と非表示列（⋯ メニューで変更）。刷新后恢复
const DENSITY_KEY = "pm.projects.density";
const HIDDEN_COLS_KEY = "pm.projects.hiddenColumns";
function readStoredDensity(): TableDensity {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    return v === "large" || v === "small" ? v : "middle";
  } catch {
    return "middle";
  }
}
function readStoredHiddenCols(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_COLS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function storeValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

// ===== リスト先頭の「＋ 新しいプロジェクトを作成」行 =====
// dataSource に混ぜると dnd-kit / 列ソート / 絞り込み / ページングが全部この行を
// 数えてしまうので、tbody の wrapper で先頭に差し込むだけにする（データとは無関係）。
interface CreateRowCtx {
  colSpan: number;
  canCreate: boolean;
  title: string;
  sub: string;
  onCreate: () => void;
}
const CreateRowContext = createContext<CreateRowCtx | null>(null);

function BodyWrapper({
  children,
  ...rest
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  const ctx = useContext(CreateRowContext);
  return (
    <tbody {...rest}>
      {ctx && (
        <tr
          className="pm-create-row"
          onClick={ctx.canCreate ? ctx.onCreate : undefined}
        >
          <td colSpan={ctx.colSpan}>
            <button
              type="button"
              className={`pm-create-row-btn${ctx.canCreate ? "" : " is-disabled"}`}
              disabled={!ctx.canCreate}
              aria-disabled={!ctx.canCreate}
            >
              {ctx.canCreate && (
                <>
                  <PlusOutlined />
                  <span className="pm-create-row-title">{ctx.title}</span>
                </>
              )}
              {!ctx.canCreate && <span className="pm-create-row-sub">{ctx.sub}</span>}
            </button>
          </td>
        </tr>
      )}
      {children}
    </tbody>
  );
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
  // 「版本一覧」内の表示形式。年度スケジュール側には影響しない
  const { initialState } = useModel("@@initialState");
  const vmKey = viewModeKey(initialState?.currentUser);
  const [viewMode, setViewModeState] = useState<ViewMode>(() =>
    readStoredViewMode(vmKey)
  );
  const setViewMode = (v: ViewMode) => {
    setViewModeState(v);
    try {
      localStorage.setItem(vmKey, v);
    } catch {
      /* localStorage 不可用时忽略 */
    }
  };
  const [density, setDensityState] = useState<TableDensity>(readStoredDensity);
  const setDensity = (v: TableDensity) => {
    setDensityState(v);
    storeValue(DENSITY_KEY, v);
  };
  const [hiddenCols, setHiddenColsState] =
    useState<string[]>(readStoredHiddenCols);
  const setHiddenCols = (keys: string[]) => {
    setHiddenColsState(keys);
    storeValue(HIDDEN_COLS_KEY, JSON.stringify(keys));
  };
  // カードビュー用：表と同じ絞り込み・並び順の全件（ページング前・トップレベルのみ）
  const [cardList, setCardList] = useState<Project[]>([]);
  // 新出现的父项目也默认展开，手动折叠跨刷新保留。
  const [collapsedIds, setCollapsedIdsState] =
    useState<string[]>(readStoredCollapsedProjects);
  const expandedIds = expandedProjectIds(
    projects.map((p) => p.id), collapsedIds
  );
  const setCollapsedIds = (next: string[]) => {
    setCollapsedIdsState(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      /* localStorage 不可用时忽略 */
    }
  };
  const toggleExpanded = (id: string) => {
    if (expandedIds.includes(id)) {
      setCollapsedIds([...new Set([...collapsedIds, id])]);
    } else {
      setCollapsedIds(collapsedIds.filter((x) => x !== id));
    }
  };
  // カードビューのサブ一覧ドロワー（親 id）
  const [drawerParentId, setDrawerParentId] = useState<string | null>(null);
  // 表格内の絞り込み行（状態チップ）
  const [filter, setFilter] = useState<ProjectFilter>(EMPTY_PROJECT_FILTER);
  const actionRef = useRef<ActionType>(null);

  // 拖动排序：当前页行 id（SortableContext items）+ 是否可拖（无搜索/筛选时）
  const [pageRowIds, setPageRowIds] = useState<string[]>([]);
  const [dragEnabled, setDragEnabled] = useState(false);
  // 表格当前「全量显示顺序」（已应用列排序、分页前），拖动以此为基准计算新顺序。
  // トップレベルの並びと、親ごとのサブの並びを別々に持つ（並べ替えは同じ階層内だけ）
  const orderedIdsRef = useRef<string[]>([]);
  const childOrderRef = useRef<Map<string, string[]>>(new Map());
  // 拖动后强制 remount 表格：清掉列排序、并让 ProTable 刷新行顺序
  const [tableKey, setTableKey] = useState(0);
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !selectedId) return;
    // 並べ替えは同じ階層内だけ：トップレベル同士 / 同じ親のサブ同士。
    // 階層をまたぐ移動は「編集 → 親プロジェクト」で行う
    const byId = (id: string) => projects.find((p) => p.id === id);
    const a = byId(String(active.id));
    const o = byId(String(over.id));
    if (!a || !o) return;
    const parentId = a.parentId ?? null;
    if ((o.parentId ?? null) !== parentId) {
      message.info(t("projects.sub.dragSameLevel"));
      return;
    }
    // 以「当前显示顺序」为基准 arrayMove（含列排序后的顺序；当前页是其连续切片）
    const fullIds = parentId
      ? (childOrderRef.current.get(parentId) ?? [])
      : orderedIdsRef.current;
    const from = fullIds.indexOf(String(active.id));
    const to = fullIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(fullIds, from, to);
    // reorderProjects 内部先同步乐观更新 store（手动顺序），再 await 落库
    const promise = reorderProjects(selectedId, next, parentId);
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
  // サブプロジェクト作成モード（親）。null＝通常の作成 / 編集
  const [subParent, setSubParent] = useState<Project | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  // 種別に応じて期間フォームの必須／プレースホルダを切り替える（ops のみ終了日を空で確定できる）
  const formKind: ProjectKind = Form.useWatch("kind", form) ?? "project";
  // 編集モーダルの「親プロジェクト」選択と顧客（候補は同じ顧客のトップレベル・通常のみ）
  const formParentId: string | undefined = Form.useWatch("parentId", form);
  const formCustomerId: string | undefined = Form.useWatch("customerId", form);

  // 親 id → サブ一覧（一覧 API の parentId から導出。sort_order 順）
  const childrenOf = useMemo(() => groupChildren(projects), [projects]);
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p] as const)),
    [projects]
  );
  // トップレベル判定：親が無い、または親が一覧に無い（念のため孤児はトップレベル扱い）
  const isTopLevel = (p: Project) =>
    !p.parentId || !projectById.has(p.parentId);

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
  // サブプロジェクトは件数・平均に入れない（親の進捗にもう集計済みなので二重計上になる）。subs は別に数える。
  const custStats = useMemo(() => {
    const m = new Map<
      string,
      { count: number; rated: number; sum: number; subs: number }
    >();
    const ids = new Set(projects.map((p) => p.id));
    for (const p of projects) {
      const s = m.get(p.customerId) ?? {
        count: 0,
        rated: 0,
        sum: 0,
        subs: 0,
      };
      m.set(p.customerId, s);
      if (p.parentId && ids.has(p.parentId)) {
        s.subs += 1;
        continue;
      }
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
  const createEntrySub = useCreateEntryText(selectedCustomer?.name);

  // 切换客户 → 重置表格到第一页并重新拉取，并记住选中项供刷新后恢复
  useEffect(() => {
    // 顧客ごとに件数も状態の内訳も変わるので、絞り込みは引き継がず必ず解除する
    setFilter(EMPTY_PROJECT_FILTER);
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

  // 絞り込み条件が変わったら 1 ページ目から取り直す
  // （2 ページ目のまま絞ると「該当ありません」に見えてしまう）
  useEffect(() => {
    actionRef.current?.reloadAndRest?.();
  }, [filter]);

  // 選択中の顧客配下でのチップ件数。0 件のチップは押せないようにするため常に出す
  const filterCounts = useMemo(() => {
    const c: ProjectFilterCounts = {
      all: 0,
      planned: 0,
      active: 0,
      ready: 0,
      paused: 0,
      done: 0,
      overdue: 0,
    };
    if (!selectedId) return c;
    // チップの件数はトップレベル基準（ページングと同じ口径）。期限超過はサブの超過も含める
    for (const p of projects) {
      if (p.customerId !== selectedId || !isTopLevel(p)) continue;
      c.all += 1;
      c[projectDisplayStatus(p)] += 1;
      if (isOverdueWithSubs(p, childrenOf.get(p.id))) c.overdue += 1;
    }
    return c;
  }, [projects, selectedId, childrenOf]);

  const openCreate = () => {
    setEditing(null);
    setSubParent(null);
    form.resetFields();
    if (selectedId) form.setFieldsValue({ customerId: selectedId });
    setCreating(true);
  };

  /** サブプロジェクト作成：顧客・種別は親から継承（読み取り専用）、期間の既定は親の期間 */
  const openCreateSub = (parent: Project) => {
    if (parent.parentId || parent.kind === "ops") return;
    setEditing(null);
    setSubParent(parent);
    form.resetFields();
    form.setFieldsValue({
      customerId: parent.customerId,
      kind: "project",
      start: dayjs(parent.start),
      end: parent.end ? dayjs(parent.end) : null,
    });
    setCreating(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    setSubParent(null);
    form.setFieldsValue({
      customerId: p.customerId,
      parentId: p.parentId ?? undefined,
      name: p.name,
      description: p.description,
      kind: p.kind ?? "project",
      quotaDays: p.monthlyQuotaMinutes
        ? Math.round((p.monthlyQuotaMinutes / minutesPerDay) * 100) / 100
        : undefined,
      // 終了日は null（＝期限なし）でありうる。その場合は空のまま開く
      start: dayjs(p.start),
      end: p.end ? dayjs(p.end) : null,
    });
    setCreating(true);
  };

  const confirmDelete = (p: Project) => {
    // サブを持つ親は削除できない（後端も拒否する）。先に知らせて API を呼ばない
    if ((childrenOf.get(p.id)?.length ?? 0) > 0) {
      modal.warning({
        title: t("projects.delete.title"),
        content: t("projects.sub.deleteBlocked"),
        okText: t("projects.sub.close"),
      });
      return;
    }
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

  /**
   * サブの期間が親の期間からはみ出すとき「親プロジェクトの期間も延長しますか？」を聞く。
   * はい＝親も延長 / いいえ＝サブだけ保存。どちらかを必ず選ばせる（× や Esc で閉じない）。
   */
  const askExtendParent = (next: { start: string; end: string | null }) =>
    new Promise<boolean>((resolve) => {
      modal.confirm({
        title: t("projects.sub.extendTitle"),
        content: t("projects.sub.extendContent", {
          range: `${fmt(next.start, "YYYY/MM/DD")} — ${
            next.end ? fmt(next.end, "YYYY/MM/DD") : t("projects.card.ongoing")
          }`,
        }),
        okText: t("projects.sub.extendYes"),
        cancelText: t("projects.sub.extendNo"),
        closable: false,
        keyboard: false,
        maskClosable: false,
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const start = (v.start ?? dayjs()).format("YYYY-MM-DD");
      const end = v.end ? v.end.format("YYYY-MM-DD") : null;
      // サブとして保存する場合の親（サブ作成モード / 編集で親を選択）。
      // 顧客・種別は親で決まる（後端も上書きする）
      const parent =
        subParent ??
        (v.parentId ? projectById.get(v.parentId as string) : undefined);
      const kind = (parent ? "project" : (v.kind ?? "project")) as ProjectKind;
      // 枠なし（空欄）は 0 を送る＝後端が null にクリアする。通常项目は枠の概念自体がない
      const quotaDays = kind === "ops" ? (v.quotaDays ?? 0) : 0;
      const payload = {
        customerId: parent ? parent.customerId : v.customerId,
        name: v.name,
        description: v.description,
        kind,
        start,
        end,
        monthlyQuotaMinutes: Math.round(quotaDays * minutesPerDay),
      };
      // 親の期間からはみ出すなら、保存前に「親の期間も延長しますか？」
      const extendTo = parent ? extendedParentRange(parent, start, end) : null;
      const extend = extendTo ? await askExtendParent(extendTo) : false;
      // 延長に失敗した場合はサブをまだ保存しない（再試行で重複作成しないため）。
      if (parent && extendTo && extend) {
        await updateProject(parent.id, {
          start: extendTo.start,
          ...(extendTo.end ? { end: extendTo.end } : {}),
        });
      }
      if (editing) {
        // 終了日を空にした＝「継続中に戻す」。end:null だけでは未変更と区別できないため明示フラグを送る。
        // 親を外した＝トップレベルへ戻す（parentId 省略は「未変更」なので clearParent を送る）
        const parentPatch = v.parentId
          ? { parentId: v.parentId as string }
          : editing.parentId
            ? { clearParent: true }
            : {};
        await updateProject(editing.id, {
          ...payload,
          clearEnd: end === null,
          ...parentPatch,
        });
        message.success(t("projects.updated"));
      } else {
        await addProject({ ...payload, parentId: subParent?.id ?? null });
        message.success(t(subParent ? "projects.sub.created" : "projects.created"));
        setSelectedId(payload.customerId);
        // 作ったサブが見えるよう親を展開しておく
        if (subParent && !expandedIds.includes(subParent.id)) {
          setCollapsedIds(collapsedIds.filter((id) => id !== subParent.id));
        }
      }
      setCreating(false);
      setEditing(null);
      setSubParent(null);
      form.resetFields();
    } finally {
      setSubmitting(false);
    }
  };

  /** 全サブ完了の提案から親を納品済みにする（自動では変えない。確認してから） */
  const confirmMarkDone = (p: Project) => {
    modal.confirm({
      title: t("projects.sub.markDoneTitle"),
      content: t("projects.sub.markDoneConfirm", {
        count: childrenOf.get(p.id)?.length ?? 0,
        name: p.name,
        status: t(PROJECT_DISPLAY_STATUS_META[projectDisplayStatus(p)].i18nKey),
      }),
      okText: t("projects.sub.markDone"),
      cancelText: t("projects.cancel"),
      onOk: async () => {
        await updateProject(p.id, { status: "done" });
        message.success(t("projects.updated"));
      },
    });
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
  // 列幅：1440px 幅 + 顧客パネル展開（表の実幅 ≒ 900px）でも横スクロールなしで
  // 進捗 / 操作まで見えるよう、合計を scroll.x（TABLE_SCROLL_X）以内に収める。説明列は狭めて省略 + Tooltip。
  // 名前列を優先して広げ（最大 2 行で折り返し）、期間列は「—」の後で 2 行に折り返す前提で狭める。
  const baseColumns: ProColumns<Row>[] = [
    {
      title: "",
      dataIndex: "sort",
      width: 36,
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
      width: 254,
      // 絞り込みは下の検索行（ProjectFilterBar）に一本化した
      search: false,
      sorter: true,
      onCell: () => ({ className: "pm-col-name" }),
      render: (_, p) => {
        // サブ行：縮進 + 接続線 + 状態の点 + 「サブ」タグ
        if (p.parentId && projectById.has(p.parentId)) {
          return (
            <div className="pm-tbl-namewrap">
              <span className={`pm-tree-line${p.__last ? " is-last" : ""}`} />
              <i className={`pm-sub-dot is-${projectDisplayStatus(p)}`} />
              <a
                className="pm-tbl-name pm-tbl-cname"
                title={p.name}
                onClick={() => nav(`/projects/${p.id}/gantt`)}
              >
                {p.name}
              </a>
              <span className="pm-tbl-subbadge">{t("projects.sub.tag")}</span>
            </div>
          );
        }
        const subs = childrenOf.get(p.id) ?? [];
        const open = expandedIds.includes(p.id);
        return (
          <div className="pm-tbl-namewrap">
            {subs.length > 0 ? (
              <Button
                type="text"
                size="small"
                className="pm-tbl-caret"
                aria-expanded={open}
                aria-label={t(open ? "projects.sub.collapse" : "projects.sub.expand")}
                icon={open ? <DownOutlined /> : <RightOutlined />}
                onClick={() => toggleExpanded(p.id)}
              />
            ) : (
              <span className="pm-tbl-caret-ph" />
            )}
            <a
              className="pm-tbl-name"
              title={p.name}
              onClick={() => nav(`/projects/${p.id}/gantt`)}
            >
              {p.name}
            </a>
            <SubProjectAddButton
              kind={p.kind}
              parentId={p.parentId}
              disabled={!selectedId}
              label={t("projects.sub.add")}
              onAdd={() => openCreateSub(p)}
            />
            {subs.length > 0 && (
              <span className="pm-tbl-subcnt">
                {t("projects.sub.pill", { count: subs.length })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      title: t("projects.form.description"),
      dataIndex: "description",
      width: 96,
      search: false,
      render: (_, p) => {
        // サブ行は説明の代わりに「工数 N日」（親進捗の重み＝どう集計されたか分かるように）
        if (p.parentId && projectById.has(p.parentId)) {
          const days = (p.rollupWeightMinutes ?? 0) / minutesPerDay;
          return (
            <Tooltip title={t("projects.sub.effortTip")}>
              <span className="pm-tbl-effort">
                {t("projects.sub.effortDays", {
                  days: Math.round(days * 10) / 10,
                })}
              </span>
            </Tooltip>
          );
        }
        return p.description ? (
          <Tooltip title={p.description} placement="topLeft">
            <span className="pm-tbl-desc">{p.description}</span>
          </Tooltip>
        ) : (
          <span className="pm-tbl-muted">{t("projects.card.noDesc")}</span>
        );
      },
    },
    {
      title: t("projects.form.status"),
      dataIndex: "status",
      width: 96,
      search: false,
      sorter: true,
      render: (_, p) => {
        const meta = PROJECT_DISPLAY_STATUS_META[projectDisplayStatus(p)];
        // 全サブ完了の提案（親の状態は自動では変えない）
        const sum = subSummary(childrenOf.get(p.id));
        return (
          <>
            <Tag color={meta.color} variant="filled">
              {t(meta.i18nKey)}
            </Tag>
            {sum.allDone && p.status !== "done" && (
              <Tooltip
                title={`${t("projects.sub.allDone")} ${t("projects.sub.markDoneAsk")}`}
              >
                <CheckCircleFilled
                  className="pm-tbl-alldone"
                  onClick={() => confirmMarkDone(p)}
                />
              </Tooltip>
            )}
          </>
        );
      },
    },
    {
      title: t("projects.form.range"),
      dataIndex: "range",
      width: 164,
      search: false,
      sorter: true,
      render: (_, p) => {
        const subs = childrenOf.get(p.id);
        const overdueOwn = isOverdue(p);
        // 親：自分は期限内（または終了日なし）でもサブが超過していれば期限超過扱い（理由は Tooltip）
        const overdueSub = !overdueOwn && isOverdueWithSubs(p, subs);
        const subBadge = overdueSub && (
          <Tooltip title={t("projects.sub.overdueHint")}>
            <span className="pm-tbl-overdue">
              · {t("projects.card.overdue")}
            </span>
          </Tooltip>
        );
        // 終了日なし＝期限なし。自分自身の期限超過判定はしない（サブ由来の超過だけ出す）
        if (!p.end) {
          return (
            <span className="pm-tbl-date">
              <span className="pm-tbl-d">{fmt(p.start, "YYYY/MM/DD")} —</span>{" "}
              <span className="pm-tbl-ongoing">
                {t("projects.card.ongoing")}
              </span>
              {subBadge}
            </span>
          );
        }
        return (
          <span className="pm-tbl-date">
            <span className="pm-tbl-d">{fmt(p.start, "YYYY/MM/DD")} —</span>{" "}
            <span className="pm-tbl-d">
              {fmt(p.end, "YYYY/MM/DD")}
              {overdueOwn && (
                <span className="pm-tbl-overdue">
                  · {t("projects.card.overdue")}
                </span>
              )}
              {subBadge}
            </span>
          </span>
        );
      },
    },
    {
      title: t("projects.col.progress"),
      dataIndex: "progress",
      width: 136,
      search: false,
      sorter: true,
      render: (_, p) => {
        // 運用型：進捗率はタスクが随時増える分母のせいで鋸歯状になり達成率として読めないため、
        // 「今月の消化件数 + 未完了の滞留件数」というフロー指標に差し替える（保守運用の実務指標）
        if (p.kind === "ops") {
          const { done, total } = opsMonthCounts(p);
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
                  <span className={`pm-tbl-quota-num${over ? " is-over" : ""}`}>
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
        const bar = (
          <Progress
            percent={pct}
            size="small"
            strokeColor={pct === 100 ? "#52c41a" : "#2f6bff"}
            railColor="#f0f2f5"
          />
        );
        // 親：Σ（サブから自動集計）を左に付け、Tooltip で集計規則を説明
        if ((childrenOf.get(p.id)?.length ?? 0) > 0) {
          return (
            <div className="pm-tbl-prog">
              <Tooltip title={t("projects.sub.sigmaTip")}>
                <span className="pm-tbl-sigma">Σ</span>
              </Tooltip>
              {bar}
            </div>
          );
        }
        return bar;
      },
    },
    {
      title: t("projects.col.actions"),
      valueType: "option",
      width: 100,
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
  const columns = baseColumns;
  // ⋯ メニューで表示 / 非表示を切り替えられる列。名前と操作列は常に出す
  const toggleableColumns = ["description", "status", "range", "progress"].map(
    (key) => ({
      key,
      label: String(
        baseColumns.find((c) => "dataIndex" in c && c.dataIndex === key)
          ?.title ?? key
      ),
    })
  );

  // 一覧が空のときの説明（表の emptyText とカードの空ヒントで共通）
  const emptyDescription = selectedId
    ? custStats.get(selectedId)?.count
      ? t("projects.noMatch")
      : t("projects.emptyHint")
    : t("projects.selectCustomerFirst");

  // リスト先頭の作成行に渡す内容（行は tbody wrapper が描画する）
  const createRowCtx: CreateRowCtx = {
    colSpan: columns.length,
    canCreate: !!selectedId,
    title: t("projects.createEntry.listTitle"),
    sub: createEntrySub,
    onCreate: openCreate,

  };
  const drawerParent = drawerParentId
    ? (projectById.get(drawerParentId) ?? null)
    : null;
  const selectedStats = selectedId ? custStats.get(selectedId) : undefined;
  // 編集モーダルの「親プロジェクト」候補：同じ顧客のトップレベル・通常プロジェクト（自分を除く）
  const parentOptions = projects
    .filter(
      (p) =>
        p.customerId === (formCustomerId ?? editing?.customerId) &&
        isTopLevel(p) &&
        p.kind !== "ops" &&
        p.id !== editing?.id
    )
    .map((p) => ({ value: p.id, label: p.name }));
  const editingHasSubs = !!editing && (childrenOf.get(editing.id)?.length ?? 0) > 0;
  // dnd-kit の並び：表示中の行順（トップレベル + 展開中の親のサブ）。実データ行のみ
  const openIds = new Set(expandedIds);
  const sortableItems = pageRowIds.flatMap((id) =>
    openIds.has(id) ? [id, ...(childOrderRef.current.get(id) ?? [])] : [id]
  );

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
                              offset={[-4, 2]}
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
                  items={sortableItems}
                  strategy={verticalListSortingStrategy}
                >
                  <DragEnabledContext.Provider value={dragEnabled}>
                    <CreateRowContext.Provider value={createRowCtx}>
                      <ProTable<Row>
                        key={tableKey}
                        rowKey="id"
                        actionRef={actionRef}
                        columns={columns}
                        cardBordered
                        components={{
                          body: { row: DraggableRow, wrapper: BodyWrapper },
                        }}
                        /* サブはツリーデータ（children）。展開は名前列の ▸/▾ で行うので
                           antd 既定の展開アイコンと縮進は消し、接続線は名前列で描く */
                        expandable={{
                          expandedRowKeys: expandedIds,
                          expandIcon: () => null,
                          indentSize: 0,
                        }}
                        // 行のどこでもダブルクリックで開く（名前を狙わなくてよい）。
                        // ボタン / リンク / ドラッグハンドル上は各自の操作に任せる
                        onRow={(r) => ({
                          onDoubleClick: (e) => {
                            if (!shouldOpenProjectRow(e.target, e.currentTarget)) return;
                            window.getSelection()?.removeAllRanges();
                            nav(`/projects/${r.id}/gantt`);
                          },
                        })}
                        rowClassName={(r) =>
                          r.parentId && projectById.has(r.parentId)
                            ? "pm-row-child"
                            : ""
                        }
                        headerTitle={
                          <span className="pm-tbl-title">
                            {selectedCustomer?.name ?? "—"}
                            {selectedStats && selectedStats.subs > 0 && (
                              <small className="pm-tbl-title-sub">
                                {t("projects.sub.headerCount", {
                                  count: selectedStats.count,
                                  subs: selectedStats.subs,
                                })}
                              </small>
                            )}
                          </span>
                        }
                        /* 既定の検索パネルはカードの外に出てしまい「全体検索」に
                           見えるので使わない。同じ絞り込みは toolbar の 2 行目
                           （multipleLine + filter）に置く＝カードの中に収まる。 */
                        search={false}
                        /* 既定の 再読み込み / 密度 / 列設定 アイコンは設定メニュー
                           （TableMoreMenu）にまとめたので出さない */
                        options={false}
                        size={density}
                        columnsState={{
                          value: Object.fromEntries(
                            hiddenCols.map((k) => [k, { show: false }])
                          ),
                        }}
                        toolbar={{
                          multipleLine: true,
                          filter: (
                            <ProjectFilterBar
                              counts={filterCounts}
                              value={filter}
                              onChange={setFilter}
                              disabled={!selectedId}
                            />
                          ),
                        }}
                        dateFormatter="string"
                        /* y を渡すのは「表头固定 + body だけスクロール」の
                           2 テーブル構成にするため。実際の高さは index.css 側で
                           grid 行の残りぶんに置き換える（max-height を打ち消す）ので、
                           ここの数値自体は効かない＝行数で外側の高さは変わらない。 */
                        scroll={{ x: TABLE_SCROLL_X, y: 360 }}
                        pagination={{
                          defaultPageSize: 20,
                          showSizeChanger: true,
                          pageSizeOptions: [10, 20, 50, 100],
                        }}
                        locale={{
                          emptyText: (
                            <Empty
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                              description={emptyDescription}
                            />
                          ),
                        }}
                        /* 作成の入口は表の先頭行 / カードの先頭セルに移したので、
                           右上は表示形式と設定の独立ボタン */
                        toolBarRender={() => [
                          <TableMoreMenu
                            key="more"
                            viewMode={viewMode}
                            onViewMode={setViewMode}
                            onReload={() => actionRef.current?.reload()}
                            density={density}
                            onDensity={setDensity}
                            columns={toggleableColumns}
                            hiddenColumns={hiddenCols}
                            onHiddenColumns={setHiddenCols}
                          />,
                        ]}
                        /* カード表示は表の部分だけ差し替える：ツールバー（絞り込み・切替）と
                           request（絞り込み・列ソート）はそのまま共有される */
                        tableViewRender={(
                          { columns: visibleColumns, rowSelection },
                          defaultDom
                        ) =>
                          viewMode === "card" ? (
                            <ProjectCardGrid
                              projects={cardList}
                              childrenOf={childrenOf}
                              customerName={selectedCustomer?.name}
                              canCreate={!!selectedId}
                              onCreate={openCreate}
                              onOpen={(p) => nav(`/projects/${p.id}/gantt`)}
                              onEdit={openEdit}
                              onDelete={confirmDelete}
                              onShowSubs={(p) => setDrawerParentId(p.id)}
                              onAddSub={openCreateSub}
                              emptyHint={
                                selectedId ? (
                                  <span>{emptyDescription}</span>
                                ) : undefined
                              }
                            />
                          ) : (
                            <CreateRowContext.Provider
                              value={{
                                ...createRowCtx,
                                // 列表示設定と選択列を含む実際の列数。
                                colSpan:
                                  (visibleColumns?.length ?? columns.length) +
                                  (rowSelection ? 1 : 0),
                              }}
                            >
                              {defaultDom}
                            </CreateRowContext.Provider>
                          )
                        }
                        request={async (params, sort) => {
                          if (!selectedId) {
                            orderedIdsRef.current = [];
                            childOrderRef.current = new Map();
                            setPageRowIds([]);
                            setDragEnabled(false);
                            setCardList([]);
                            return { data: [], success: true, total: 0 };
                          }
                          // 絞り込み・件数・ページングはトップレベル基準。サブは親の children として付ける
                          let list = applyProjectFilter(
                            projects.filter(
                              (p) => p.customerId === selectedId && isTopLevel(p)
                            ),
                            filter,
                            childrenOf
                          );
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
                          const cmp = (a: Project, b: Project) => {
                            if (!sortKey) return 0;
                            const dir = sort?.[sortKey] === "ascend" ? 1 : -1;
                            let r = 0;
                            switch (sortKey) {
                              case "name":
                                r = a.name.localeCompare(b.name);
                                break;
                              case "status":
                                r = projectDisplayStatus(a).localeCompare(projectDisplayStatus(b));
                                break;
                              case "progress":
                                r = (a.progress ?? 0) - (b.progress ?? 0);
                                break;
                              case "range":
                                r = a.start.localeCompare(b.start);
                                break;
                            }
                            return r * dir;
                          };
                          if (sortKey) list = list.slice().sort(cmp);
                          // 当前显示顺序（分页前全量）→ 拖动基准（トップレベル / 親ごとのサブ）
                          orderedIdsRef.current = list.map((p) => p.id);
                          const childOrder = new Map<string, string[]>();
                          const withChildren = (p: Project): Row => {
                            const kids = childrenOf.get(p.id);
                            if (!kids?.length) return p;
                            const sorted = sortKey ? kids.slice().sort(cmp) : kids;
                            childOrder.set(
                              p.id,
                              sorted.map((c) => c.id)
                            );
                            const rows: Row[] = sorted.map((c, i) => ({
                              ...c,
                              __last: i === sorted.length - 1,
                            }));
                            return { ...p, children: rows };
                          };
                          childOrderRef.current = childOrder;
                          setCardList(list);
                          // 列排序下仍可拖动（拖后自动清排序）；仅筛选时禁用
                          setDragEnabled(isProjectFilterEmpty(filter));
                          const total = list.length;
                          const current = params.current ?? 1;
                          const pageSize = params.pageSize ?? 10;
                          const data = list
                            .slice((current - 1) * pageSize, current * pageSize)
                            .map(withChildren);
                          setPageRowIds(data.map((d) => d.id));
                          return { data, success: true, total };
                        }}
                      />
                    </CreateRowContext.Provider>
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
          editing
            ? "projects.form.editTitle"
            : subParent
              ? "projects.sub.createTitle"
              : "projects.form.createTitle"
        )}
        open={creating}
        onOk={submit}
        confirmLoading={submitting}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
          setSubParent(null);
        }}
        okText={t(editing ? "projects.form.save" : "projects.form.create")}
        cancelText={t("projects.cancel")}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          {subParent ? (
            // サブ作成：親は読み取り専用（点 + 親の名前 + 親の期間）。顧客は親で決まる
            <Form.Item label={t("projects.sub.parent")}>
              <div className="pm-sub-ro">
                <i className={`pm-sub-dot is-${projectDisplayStatus(subParent)}`} />
                <span className="pm-sub-ro-name" title={subParent.name}>
                  {subParent.name}
                </span>
                <span className="pm-sub-ro-range">
                  {fmt(subParent.start, "YYYY/MM/DD")} —{" "}
                  {subParent.end
                    ? fmt(subParent.end, "YYYY/MM/DD")
                    : t("projects.card.ongoing")}
                </span>
              </div>
            </Form.Item>
          ) : (
            <Form.Item
              name="customerId"
              label={t("projects.form.customer")}
              tooltip={formParentId ? t("projects.sub.customerFixed") : undefined}
              rules={[
                {
                  required: true,
                  message: t("projects.form.customerRequired"),
                },
              ]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                // サブの顧客は親と同じ（変えるなら先に親から外す）
                disabled={!!formParentId}
                placeholder={t("projects.form.customerPlaceholder")}
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
                onChange={() => form.setFieldsValue({ parentId: undefined })}
              />
            </Form.Item>
          )}
          {editing && (
            // 編集：親プロジェクトの付け替え（同じ顧客のトップレベル・通常のみ。空＝トップレベル）
            <Form.Item
              name="parentId"
              label={t("projects.sub.parent")}
              tooltip={t("projects.sub.parentTip")}
              extra={
                editingHasSubs
                  ? t("projects.sub.parentDisabledHasSubs")
                  : formKind === "ops" && !formParentId
                    ? t("projects.sub.parentDisabledOps")
                    : undefined
              }
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                disabled={
                  editingHasSubs || (formKind === "ops" && !formParentId)
                }
                placeholder={t("projects.sub.parentNone")}
                options={parentOptions}
                // サブは通常プロジェクトのみ（種別は親から継承）
                onChange={(v) => {
                  if (v) form.setFieldsValue({ kind: "project" });
                }}
              />
            </Form.Item>
          )}
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
          {/* 状態はフォームで入力しない（新規は後端の既定値 planned、編集では送らず現状維持） */}
          {subParent ? (
            // サブの種別は親（通常プロジェクト）を継承。選ばせない
            <Form.Item label={t("projects.form.kind")}>
              <div className="pm-sub-ro">{t("projects.sub.kindInherited")}</div>
            </Form.Item>
          ) : (
          <Form.Item
            name="kind"
            label={t("projects.form.kind")}
            initialValue="project"
            tooltip={t("projects.form.kindTip")}
            extra={formParentId ? t("projects.sub.kindInherited") : undefined}
            rules={[
              { required: true, message: t("projects.form.kindRequired") },
            ]}
          >
            <Select
              // サブは通常プロジェクトのみ（v1：運用型はサブにも親にもならない）
              disabled={!!formParentId}
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
          )}
          {/* 開始日・終了日は別々の入力。開始日は必須（新規は作成当日を既定値）、終了日は種別を問わず任意 */}
          <div className="pm-form-row">
            <Form.Item
              name="start"
              label={t("projects.form.start")}
              initialValue={dayjs()}
              rules={[
                { required: true, message: t("projects.form.startRequired") },
              ]}
              extra={
                subParent
                  ? t("projects.sub.rangeHint", {
                      range: `${fmt(subParent.start, "YYYY/MM/DD")} — ${
                        subParent.end
                          ? fmt(subParent.end, "YYYY/MM/DD")
                          : t("projects.card.ongoing")
                      }`,
                    })
                  : undefined
              }
            >
              <DatePicker
                style={{ width: "100%" }}
                allowClear={false}
                placeholder={t("projects.form.startPlaceholder")}
              />
            </Form.Item>
            <Form.Item
              name="end"
              label={t("projects.form.end")}
              dependencies={["start"]}
              extra={t("projects.form.endOptional")}
              rules={[
                ({ getFieldValue }) => ({
                  validator: (_, value: dayjs.Dayjs | null | undefined) => {
                    const start: dayjs.Dayjs | undefined =
                      getFieldValue("start");
                    if (value && start && value.isBefore(start, "day")) {
                      return Promise.reject(
                        new Error(t("projects.form.endBeforeStart"))
                      );
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <DatePicker
                style={{ width: "100%" }}
                placeholder={t("projects.form.endOngoing")}
              />
            </Form.Item>
          </div>
          {subParent && (
            // 親進捗の集計規則（例つき）
            <div className="pm-sub-note">
              <b>{t("projects.sub.noteTitle")}</b>
              <br />
              {t("projects.sub.noteBody")}
              <br />
              {t("projects.sub.noteExample")}
            </div>
          )}
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

      {/* カードビュー：サブプロジェクト一覧ドロワー */}
      <SubProjectDrawer
        parent={drawerParent}
        subs={drawerParent ? (childrenOf.get(drawerParent.id) ?? []) : []}
        onClose={() => setDrawerParentId(null)}
        onOpen={(p) => nav(`/projects/${p.id}/gantt`)}
        onEdit={openEdit}
        onDelete={confirmDelete}
        onAddSub={openCreateSub}
        onMarkDone={confirmMarkDone}
      />

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

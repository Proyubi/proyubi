import {
  AppstoreOutlined,
  BugOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EditOutlined,
  ExperimentOutlined,
  FilterOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  SolutionOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "@umijs/max";
import type { InputRef, MenuProps } from "antd";
import {
  App as AntApp,
  Badge,
  Button,
  Checkbox,
  DatePicker,
  Divider,
  Drawer,
  Dropdown,
  Input,
  Popconfirm,
  Popover,
  Segmented,
  Select,
  Table,
  Tag,
  TreeSelect,
} from "antd";
import type { ColumnsType, TableProps } from "antd/es/table";
import dayjs from "dayjs";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/pm/api";
import {
  BUG_SEVERITY_META,
  BUG_STATUS_META,
  BUG_STATUS_ORDER,
  type Bug,
  type BugStatus,
  type Environment,
  environmentLabel,
  QC_PRIORITY_META,
  type QcPriority,
  type Task,
} from "@/pm/types";
import {
  type BugFilters,
  bugAgeDays,
  bugDisplayNo,
  bugOverview,
  type DateRange,
  filterBugsExceptStatus,
  isActiveBug,
  LEGACY_ENV_PREFIX,
  matchBugStatus,
  UNASSIGNED,
  WHOLE_PRODUCT,
} from "@/pm/utils/bug";
import { buildTaskTreeData } from "@/pm/utils/taskTree";
import BugEditDrawer from "./bug-edit";
import EnvironmentManager from "./environment-manager";

type AppApi = ReturnType<typeof AntApp.useApp>;
type T = (id: string, v?: Record<string, string | number>) => string;

const PRIORITY_KEYS: QcPriority[] = ["high", "medium", "low"];
const RANK: Record<QcPriority, number> = { high: 3, medium: 2, low: 1 };
const PRIORITY_ARROW: Record<QcPriority, string> = {
  high: "↑",
  medium: "→",
  low: "↓",
};
/** 経過日数がこれを超えた未完了バグは注意色 */
const AGE_WARN_DAYS = 14;
const ISO_FMT = "YYYY-MM-DDTHH:mm:ss";

const PAGE_SIZE_KEY = "pm.quality.bugPageSize";
const OPTIONAL_COLS_KEY = "pm.quality.bugOptionalColumns";
type OptionalCol = "reporter" | "environment";

type SortKey =
  | "seq"
  | "severity"
  | "priority"
  | "status"
  | "reportedOn"
  | "resolvedAt";
type SortOrder = "ascend" | "descend";
const DEFAULT_SORT: [SortKey, SortOrder] = ["seq", "descend"];

/**
 * URL クエリ ⇄ 一覧条件。条件を URL に持つのは、リロードで消えないことと
 * 「未対応 × 担当ダライ」のような絞り込みをリンクで共有できるようにするため。
 * tab / bug(詳細) 以外のキーはバグ一覧専用。
 */
const Q = {
  status: "status",
  keyword: "q",
  severity: "sev",
  priority: "pri",
  assignee: "assignee",
  project: "project",
  task: "task",
  reporter: "reporter",
  environment: "env",
  reportedFrom: "rf",
  reportedTo: "rt",
  resolvedFrom: "sf",
  resolvedTo: "st",
  sort: "sort",
  bug: "bug",
} as const;
const FILTER_KEYS = [
  Q.keyword,
  Q.severity,
  Q.priority,
  Q.assignee,
  Q.project,
  Q.task,
  Q.reporter,
  Q.environment,
  Q.reportedFrom,
  Q.reportedTo,
  Q.resolvedFrom,
  Q.resolvedTo,
];

function readRange(sp: URLSearchParams, from: string, to: string): DateRange {
  const a = sp.get(from);
  const b = sp.get(to);
  return a || b ? [a, b] : null;
}

function readLocal<V>(key: string, fallback: V): V {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as V) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* プライベートモード等では保存しない */
  }
}

/** 詳細ドロワーのバッジ配色：ベース色から文字/薄い背景/枠線を導出。 */
function badgeStyle(color: string): CSSProperties {
  return {
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 26%, transparent)`,
  };
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="qc-detail-row">
      <span className="qc-detail-row-label">
        <span className="qc-detail-row-icon">{icon}</span>
        {label}
      </span>
      <span className="qc-detail-row-value">{children}</span>
    </div>
  );
}

/** 状態ピル（一覧・一括変更メニュー共通） */
export function BugStatusPill({ status, t }: { status: BugStatus; t: T }) {
  const color = BUG_STATUS_META[status].color;
  return (
    <span
      className="qc-status-pill"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <i />
      {t(BUG_STATUS_META[status].i18nKey)}
    </span>
  );
}

function SeverityLabel({ v, t }: { v: QcPriority; t: T }) {
  return (
    <span
      className={`qc-sev qc-sev-${v}`}
      style={{ "--qc-c": BUG_SEVERITY_META[v].color } as CSSProperties}
    >
      <i />
      {t(BUG_SEVERITY_META[v].i18nKey)}
    </span>
  );
}

function PriorityLabel({ v, t }: { v: QcPriority; t: T }) {
  return (
    <span
      className="qc-pri"
      style={{ "--qc-c": QC_PRIORITY_META[v].color } as CSSProperties}
    >
      <b>{PRIORITY_ARROW[v]}</b>
      {t(QC_PRIORITY_META[v].i18nKey)}
    </span>
  );
}

const AVATAR_COLORS = [
  "#4f6bed",
  "#0f9d8a",
  "#d9480f",
  "#9c36b5",
  "#1971c2",
  "#2b8a3e",
  "#c2255c",
  "#5f3dc4",
];
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function MemberLabel({ id, name }: { id: string; name: string }) {
  return (
    <span className="qc-member">
      <span className="qc-avatar" style={{ background: avatarColor(id) }}>
        {name.slice(0, 1)}
      </span>
      <span className="qc-member-name">{name}</span>
    </span>
  );
}

export interface BugsTabProps {
  customerId?: string;
  /** タブが表示中か（`/` ショートカットの有効化に使う） */
  active: boolean;
  /** 全製品（詳細の製品表示用） */
  allCustomers: { id: string; name: string }[];
  /** 全版本（customerId でグルーピング） */
  allProjects: { id: string; name: string; customerId: string }[];
  bugs: Bug[];
  /** 当該製品配下の環境マスタ */
  environments: Environment[];
  reloadEnvironments: (cid: string) => Promise<void>;
  taskMap: Record<string, string>;
  /** 顧客配下の全タスク（一括紐付けの WBS ツリー用） */
  tasks: Task[];
  memberOptions: { label: string; value: string }[];
  caseMap: Record<string, string>;
  gotoGantt: (taskId: string) => void;
  t: T;
  message: AppApi["message"];
  reloadBugs: (cid: string) => Promise<void>;
}

export default function BugsTab(p: BugsTabProps) {
  const { t, message, customerId } = p;
  const { modal } = AntApp.useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---------------- URL の条件 ----------------
  const patchParams = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const statusParam = searchParams.get(Q.status);
  const status: BugFilters["status"] =
    statusParam === "all" || BUG_STATUS_ORDER.includes(statusParam as BugStatus)
      ? (statusParam as BugFilters["status"])
      : "active";

  const urlKeyword = searchParams.get(Q.keyword) ?? "";
  // 入力中は手元の state、少し待ってから URL へ（1 打鍵ごとに履歴を書き換えない）
  const [keyword, setKeyword] = useState(urlKeyword);
  useEffect(() => setKeyword(urlKeyword), [urlKeyword]);
  useEffect(() => {
    if (keyword === urlKeyword) return;
    const h = setTimeout(() => patchParams({ [Q.keyword]: keyword }), 300);
    return () => clearTimeout(h);
  }, [keyword]);

  const filters: Omit<BugFilters, "status"> = useMemo(
    () => ({
      keyword,
      severity: (searchParams.get(Q.severity) as QcPriority) || undefined,
      priority: (searchParams.get(Q.priority) as QcPriority) || undefined,
      assignee: searchParams.get(Q.assignee) || undefined,
      project: searchParams.get(Q.project) || undefined,
      task:
        (searchParams.get(Q.task) as BugFilters["task"] | null) || undefined,
      reporter: searchParams.get(Q.reporter) || undefined,
      environment: searchParams.get(Q.environment) || undefined,
      reported: readRange(searchParams, Q.reportedFrom, Q.reportedTo),
      resolved: readRange(searchParams, Q.resolvedFrom, Q.resolvedTo),
    }),
    [searchParams, keyword]
  );

  const [sortKey, sortOrder] = useMemo((): [SortKey, SortOrder] => {
    const [k, o] = (searchParams.get(Q.sort) ?? "").split(":");
    const keys: SortKey[] = [
      "seq",
      "severity",
      "priority",
      "status",
      "reportedOn",
      "resolvedAt",
    ];
    if (keys.includes(k as SortKey) && (o === "ascend" || o === "descend"))
      return [k as SortKey, o];
    return DEFAULT_SORT;
  }, [searchParams]);

  const clearAllFilters = () => {
    setKeyword("");
    patchParams(
      Object.fromEntries(
        [...FILTER_KEYS, Q.status, Q.sort].map((k) => [k, null])
      )
    );
  };

  // ---------------- 一覧データ ----------------
  const today = dayjs().format("YYYY-MM-DD");
  const overview = useMemo(() => bugOverview(p.bugs, today), [p.bugs, today]);

  const exceptStatus = useMemo(
    () => filterBugsExceptStatus(p.bugs, filters),
    [p.bugs, filters]
  );
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: exceptStatus.length, active: 0 };
    for (const k of BUG_STATUS_ORDER) c[k] = 0;
    for (const b of exceptStatus) {
      c[b.status]++;
      if (isActiveBug(b.status)) c.active++;
    }
    return c;
  }, [exceptStatus]);

  const rows = useMemo(() => {
    const list = exceptStatus.filter((b) => matchBugStatus(b, status));
    const dir = sortOrder === "ascend" ? 1 : -1;
    const val = (b: Bug): number | string | null => {
      switch (sortKey) {
        case "severity":
          return RANK[b.severity];
        case "priority":
          return RANK[b.priority];
        case "status":
          return BUG_STATUS_ORDER.indexOf(b.status);
        case "reportedOn":
          return b.reportedOn ?? null;
        case "resolvedAt":
          return b.resolvedAt ?? null;
        default:
          return b.seq;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va !== vb) {
        if (va == null) return 1; // 値なしは常に末尾
        if (vb == null) return -1;
        return (va < vb ? -1 : 1) * dir;
      }
      return b.seq - a.seq;
    });
  }, [exceptStatus, status, sortKey, sortOrder]);

  // ---------------- 表示補助 ----------------
  const custProjects = useMemo(
    () => p.allProjects.filter((pr) => pr.customerId === customerId),
    [p.allProjects, customerId]
  );
  const projNameMap = useMemo(
    () => Object.fromEntries(p.allProjects.map((pr) => [pr.id, pr.name])),
    [p.allProjects]
  );
  const custNameMap = useMemo(
    () => Object.fromEntries(p.allCustomers.map((c) => [c.id, c.name])),
    [p.allCustomers]
  );
  const memberNameMap = useMemo(
    () => Object.fromEntries(p.memberOptions.map((m) => [m.value, m.label])),
    [p.memberOptions]
  );

  const reporterOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of p.bugs)
      m.set(b.reporterUserId, b.reporterName || b.reporterUserId);
    return Array.from(m, ([value, label]) => ({ value, label }));
  }, [p.bugs]);

  const environmentOptions = useMemo(() => {
    const opts = p.environments.map((e) => ({
      value: e.id,
      label: e.label ?? environmentLabel(e),
    }));
    const legacy = new Set<string>();
    for (const b of p.bugs)
      if (!b.environmentId && b.environment) legacy.add(b.environment);
    for (const l of legacy)
      opts.push({ value: `${LEGACY_ENV_PREFIX}${l}`, label: l });
    return opts;
  }, [p.environments, p.bugs]);

  const fmtDate = (v?: string | null) => {
    if (!v) return "";
    const ymd = v.slice(0, 10);
    return ymd.slice(0, 4) === today.slice(0, 4) ? ymd.slice(5) : ymd;
  };

  // ---------------- 保存（取り消し付き） ----------------
  const reload = useCallback(async () => {
    if (customerId) await p.reloadBugs(customerId);
  }, [customerId, p.reloadBugs]);

  const savedWithUndo = (undo: () => Promise<unknown>) => {
    const key = `qc-bug-undo-${Date.now()}`;
    message.open({
      key,
      type: "success",
      duration: 5,
      content: (
        <span>
          {t("quality.msg.saved")}
          <Button
            type="link"
            size="small"
            onClick={async () => {
              message.destroy(key);
              await undo();
              message.success(t("quality.msg.undone"));
              await reload();
            }}
          >
            {t("quality.common.undo")}
          </Button>
        </span>
      ),
    });
  };

  /** 状態の取り消し：状態を戻したうえで、遷移でスタンプ/クリアされた完了日時も元に戻す */
  const restoreStatus = async (b: Bug) => {
    await api.updateBugStatus(b.id, b.status);
    await api.updateBug(
      b.id,
      b.resolvedAt
        ? { resolvedAt: dayjs(b.resolvedAt).format(ISO_FMT) }
        : { clearResolvedAt: true }
    );
  };

  const setStatus = async (b: Bug, next: BugStatus) => {
    if (next === b.status) return;
    await api.updateBugStatus(b.id, next);
    await reload();
    savedWithUndo(() => restoreStatus(b));
  };
  const setSeverity = async (b: Bug, next: QcPriority) => {
    await api.updateBug(b.id, { severity: next });
    await reload();
    savedWithUndo(() => api.updateBug(b.id, { severity: b.severity }));
  };
  const setPriority = async (b: Bug, next: QcPriority) => {
    await api.updateBug(b.id, { priority: next });
    await reload();
    savedWithUndo(() => api.updateBug(b.id, { priority: b.priority }));
  };
  const setAssignee = async (b: Bug, memberId?: string) => {
    await api.updateBug(b.id, {
      assigneeMemberId: memberId,
      clearAssignee: !memberId,
    });
    await reload();
    savedWithUndo(() =>
      api.updateBug(b.id, {
        assigneeMemberId: b.assigneeMemberId ?? undefined,
        clearAssignee: !b.assigneeMemberId,
      })
    );
  };

  // ---------------- 詳細 / 編集 ----------------
  const detailId = searchParams.get(Q.bug);
  const detail = useMemo(
    () => (detailId ? p.bugs.find((b) => b.id === detailId) ?? null : null),
    [detailId, p.bugs]
  );
  const openDetail = (b: Bug) => patchParams({ [Q.bug]: b.id });
  const closeDetail = () => patchParams({ [Q.bug]: null });

  const [editing, setEditing] = useState<{
    open: boolean;
    bugId?: string;
    copyFromId?: string;
  }>({ open: false });
  // BugEditDrawer は onClose を取得 effect の依存に持つので参照を固定する
  const closeEditing = useCallback(() => setEditing({ open: false }), []);
  const [envManagerOpen, setEnvManagerOpen] = useState(false);

  const projectLabel = (b: Bug) => {
    const cust = custNameMap[b.customerId] ?? "";
    if (b.projectId) {
      const proj = projNameMap[b.projectId] ?? b.projectId;
      return cust ? `${cust} / ${proj}` : proj;
    }
    return `${cust} ${t("quality.bug.wholeProduct")}`;
  };

  const copyLink = async (b: Bug) => {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ tab: "bugs", [Q.bug]: b.id }).toString();
    try {
      await navigator.clipboard.writeText(url.toString());
      message.success(t("quality.bug.linkCopied"));
    } catch {
      message.info(url.toString());
    }
  };

  const confirmDelete = (b: Bug) => {
    modal.confirm({
      title: t("quality.bug.deleteConfirm"),
      content: `${bugDisplayNo(b)} ${b.title}`,
      okButtonProps: { danger: true },
      okText: t("quality.common.delete"),
      cancelText: t("quality.common.cancel"),
      onOk: async () => {
        await api.deleteBug(b.id);
        message.success(t("quality.msg.deleted"));
        if (detailId === b.id) closeDetail();
        await reload();
      },
    });
  };

  // ---------------- 一括操作 ----------------
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  useEffect(() => setSelectedIds([]), [customerId]);

  const taskTreeData = useMemo(
    () => buildTaskTreeData(custProjects, p.tasks),
    [custProjects, p.tasks]
  );

  const runBatch = async (fn: (id: string) => Promise<unknown>) => {
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    try {
      await Promise.all(selectedIds.map(fn));
      message.success(t("quality.msg.batchDone", { n: selectedIds.length }));
      setSelectedIds([]);
      await reload();
    } finally {
      setBatchBusy(false);
    }
  };

  const batchLink = async (taskId?: string, unlink?: boolean) => {
    if (selectedIds.length === 0 || (!taskId && !unlink)) return;
    setBatchBusy(true);
    try {
      const n = await api.batchLinkBugTask(selectedIds, taskId, unlink);
      message.success(t("quality.bug.batchLinkedN", { n }));
      setSelectedIds([]);
      await reload();
    } finally {
      setBatchBusy(false);
    }
  };

  const confirmBatchDelete = () => {
    modal.confirm({
      title: t("quality.bug.batchDeleteConfirm", { n: selectedIds.length }),
      okButtonProps: { danger: true },
      okText: t("quality.common.delete"),
      cancelText: t("quality.common.cancel"),
      onOk: () => runBatch((id) => api.deleteBug(id)),
    });
  };

  // ---------------- ページング / 列設定 ----------------
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() =>
    readLocal(PAGE_SIZE_KEY, 50)
  );
  const filterSignature = `${customerId}|${status}|${JSON.stringify(filters)}`;
  useEffect(() => setPage(1), [filterSignature]);

  const [optionalCols, setOptionalCols] = useState<OptionalCol[]>(() =>
    readLocal<OptionalCol[]>(OPTIONAL_COLS_KEY, [])
  );

  // ---------------- `/` で検索へ ----------------
  const searchRef = useRef<InputRef>(null);
  useEffect(() => {
    if (!p.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
      )
        return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.active]);

  // ---------------- エクスポート ----------------
  const exportCsv = () => {
    const header = [
      t("quality.bug.no"),
      t("quality.bug.title"),
      t("quality.bug.severity"),
      t("quality.bug.priority"),
      t("quality.bug.status"),
      t("quality.bug.assignee"),
      t("quality.bug.reporter"),
      t("quality.bug.project"),
      t("quality.bug.task"),
      t("quality.bug.environment"),
      t("quality.bug.reportedOn"),
      t("quality.bug.resolvedAt"),
      t("quality.bug.reopenCountHeader"),
    ];
    const body = rows.map((b) => [
      bugDisplayNo(b),
      b.title,
      t(BUG_SEVERITY_META[b.severity].i18nKey),
      t(QC_PRIORITY_META[b.priority].i18nKey),
      t(BUG_STATUS_META[b.status].i18nKey),
      b.assigneeName ?? "",
      b.reporterName ?? "",
      b.projectId
        ? projNameMap[b.projectId] ?? ""
        : t("quality.bug.wholeProductShort"),
      b.taskId ? p.taskMap[b.taskId] ?? "" : "",
      b.environment ?? "",
      b.reportedOn ?? "",
      b.resolvedAt?.slice(0, 10) ?? "",
      String(b.reopenCount ?? 0),
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    // BOM 付き：Excel で開いたときの文字化け防止
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const product = customerId ? custNameMap[customerId] ?? "bugs" : "bugs";
    a.download = `${product}_bugs_${dayjs().format("YYYYMMDD")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------------- 列 ----------------
  const sortOrderOf = (k: SortKey) => (sortKey === k ? sortOrder : null);

  const inlineSelect = {
    size: "small" as const,
    variant: "borderless" as const,
    className: "qc-inline-select",
    popupMatchSelectWidth: false,
  };

  const columns: ColumnsType<Bug> = [
    {
      title: t("quality.bug.no"),
      key: "seq",
      width: 76,
      sorter: true,
      sortOrder: sortOrderOf("seq"),
      render: (_v, r) => <span className="qc-bug-no">{bugDisplayNo(r)}</span>,
    },
    {
      title: t("quality.bug.title"),
      key: "title",
      render: (_v, r) => (
        <div className="qc-bug-title-cell">
          <a
            className="qc-bug-title"
            title={r.title}
            onClick={() => openDetail(r)}
          >
            {r.title}
          </a>
          <div className="qc-bug-meta">
            <span>
              {r.projectId
                ? projNameMap[r.projectId] ?? "—"
                : t("quality.bug.wholeProductShort")}
            </span>
            {r.taskId && (
              <a
                className="qc-bug-meta-task"
                onClick={() => p.gotoGantt(r.taskId as string)}
              >
                <LinkOutlined />
                {p.taskMap[r.taskId] ?? t("quality.common.openGantt")}
              </a>
            )}
            {r.testCaseId && p.caseMap[r.testCaseId] && (
              <span>
                <ExperimentOutlined /> {p.caseMap[r.testCaseId]}
              </span>
            )}
            {r.reopenCount > 0 && (
              <span className="qc-bug-meta-reopen">
                {t("quality.bug.reopenCount", { n: r.reopenCount })}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      title: t("quality.bug.severity"),
      key: "severity",
      width: 92,
      sorter: true,
      sortOrder: sortOrderOf("severity"),
      render: (_v, r) => (
        <Select
          {...inlineSelect}
          value={r.severity}
          onChange={(v) => setSeverity(r, v)}
          options={PRIORITY_KEYS.map((k) => ({
            value: k,
            label: <SeverityLabel v={k} t={t} />,
          }))}
        />
      ),
    },
    {
      title: t("quality.bug.priority"),
      key: "priority",
      width: 88,
      sorter: true,
      sortOrder: sortOrderOf("priority"),
      render: (_v, r) => (
        <Select
          {...inlineSelect}
          value={r.priority}
          onChange={(v) => setPriority(r, v)}
          options={PRIORITY_KEYS.map((k) => ({
            value: k,
            label: <PriorityLabel v={k} t={t} />,
          }))}
        />
      ),
    },
    {
      title: t("quality.bug.status"),
      key: "status",
      width: 118,
      sorter: true,
      sortOrder: sortOrderOf("status"),
      render: (_v, r) => (
        <Select
          {...inlineSelect}
          value={r.status}
          onChange={(v) => setStatus(r, v)}
          options={BUG_STATUS_ORDER.map((k) => ({
            value: k,
            label: <BugStatusPill status={k} t={t} />,
          }))}
        />
      ),
    },
    {
      title: t("quality.bug.assignee"),
      key: "assignee",
      width: 148,
      render: (_v, r) => (
        <Select
          {...inlineSelect}
          allowClear
          showSearch={{ optionFilterProp: "label" }}
          value={r.assigneeMemberId ?? undefined}
          style={{ maxWidth: 140 }}
          placeholder={
            <span className="qc-unassigned">
              {t("quality.common.unassigned")}
            </span>
          }
          options={p.memberOptions}
          labelRender={(o) => (
            <MemberLabel
              id={String(o.value)}
              name={
                memberNameMap[String(o.value)] ??
                r.assigneeName ??
                String(o.label ?? "")
              }
            />
          )}
          optionRender={(o) => (
            <MemberLabel id={String(o.value)} name={String(o.label)} />
          )}
          onChange={(v) => setAssignee(r, v)}
        />
      ),
    },
    ...(optionalCols.includes("reporter")
      ? [
          {
            title: t("quality.bug.reporter"),
            key: "reporter",
            width: 110,
            ellipsis: true,
            render: (_v: unknown, r: Bug) =>
              r.reporterName || <span className="qc-muted">—</span>,
          },
        ]
      : []),
    ...(optionalCols.includes("environment")
      ? [
          {
            title: t("quality.bug.environment"),
            key: "environment",
            width: 150,
            ellipsis: true,
            render: (_v: unknown, r: Bug) =>
              r.environment || <span className="qc-muted">—</span>,
          },
        ]
      : []),
    {
      title: t("quality.bug.reportedOn"),
      key: "reportedOn",
      width: 100,
      sorter: true,
      sortOrder: sortOrderOf("reportedOn"),
      render: (_v, r) => {
        const age = isActiveBug(r.status)
          ? bugAgeDays(r.reportedOn, today)
          : null;
        return (
          <span className="qc-date" title={r.reportedOn ?? undefined}>
            {fmtDate(r.reportedOn)}
            {age != null && (
              <span
                className={`qc-age${age > AGE_WARN_DAYS ? " qc-age-warn" : ""}`}
              >
                {t("quality.bug.ageDays", { n: age })}
              </span>
            )}
          </span>
        );
      },
    },
    {
      title: t("quality.bug.resolvedAt"),
      key: "resolvedAt",
      width: 96,
      sorter: true,
      sortOrder: sortOrderOf("resolvedAt"),
      render: (_v, r) =>
        r.resolvedAt ? (
          <span className="qc-date" title={r.resolvedAt.slice(0, 10)}>
            {fmtDate(r.resolvedAt)}
          </span>
        ) : (
          <span className="qc-muted">—</span>
        ),
    },
    {
      key: "actions",
      width: 48,
      fixed: "right",
      render: (_v, r) => {
        const items: MenuProps["items"] = [
          {
            key: "edit",
            icon: <EditOutlined />,
            label: t("quality.bug.edit"),
            onClick: () => setEditing({ open: true, bugId: r.id }),
          },
          {
            key: "duplicate",
            icon: <PlusOutlined />,
            label: t("quality.bug.duplicate"),
            onClick: () => setEditing({ open: true, copyFromId: r.id }),
          },
          {
            key: "link",
            icon: <LinkOutlined />,
            label: t("quality.bug.copyLink"),
            onClick: () => copyLink(r),
          },
          { type: "divider" },
          {
            key: "delete",
            icon: <DeleteOutlined />,
            danger: true,
            label: `${t("quality.common.delete")}…`,
            onClick: () => confirmDelete(r),
          },
        ];
        return (
          <Dropdown menu={{ items }} trigger={["click"]}>
            <Button
              type="text"
              size="small"
              className="qc-row-more"
              aria-label={t("quality.bug.more")}
              icon={<MoreOutlined />}
            />
          </Dropdown>
        );
      },
    },
  ];

  const onTableChange: TableProps<Bug>["onChange"] = (pg, _f, sorter) => {
    if (pg.current) setPage(pg.current);
    if (pg.pageSize && pg.pageSize !== pageSize) {
      setPageSize(pg.pageSize);
      writeLocal(PAGE_SIZE_KEY, pg.pageSize);
    }
    const s = Array.isArray(sorter) ? sorter[0] : sorter;
    const key = s?.columnKey as SortKey | undefined;
    const order = s?.order as SortOrder | undefined;
    const isDefault =
      !key || !order || (key === DEFAULT_SORT[0] && order === DEFAULT_SORT[1]);
    const nextSort = isDefault ? null : `${key}:${order}`;
    if (nextSort !== searchParams.get(Q.sort))
      patchParams({ [Q.sort]: nextSort });
  };

  // ---------------- 詳細フィルタ ----------------
  const rangeValue = (
    r: DateRange
  ): [dayjs.Dayjs | null, dayjs.Dayjs | null] => [
    r?.[0] ? dayjs(r[0]) : null,
    r?.[1] ? dayjs(r[1]) : null,
  ];
  const rangePatch = (
    from: string,
    to: string,
    v: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  ) => ({
    [from]: v?.[0]?.format("YYYY-MM-DD") ?? null,
    [to]: v?.[1]?.format("YYYY-MM-DD") ?? null,
  });
  const rangeText = (r: DateRange) =>
    `${r?.[0] ?? ""} 〜 ${r?.[1] ?? ""}`.trim();

  const envLabelOf = (v: string) =>
    environmentOptions.find((o) => o.value === v)?.label ??
    v.replace(LEGACY_ENV_PREFIX, "");

  const advancedChips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.reported)
    advancedChips.push({
      key: "reported",
      label: t("quality.bug.chip.reported", {
        v: rangeText(filters.reported),
      }),
      clear: () =>
        patchParams({ [Q.reportedFrom]: null, [Q.reportedTo]: null }),
    });
  if (filters.resolved)
    advancedChips.push({
      key: "resolved",
      label: t("quality.bug.chip.resolved", {
        v: rangeText(filters.resolved),
      }),
      clear: () =>
        patchParams({ [Q.resolvedFrom]: null, [Q.resolvedTo]: null }),
    });
  if (filters.task)
    advancedChips.push({
      key: "task",
      label: t("quality.bug.chip.task", {
        v: t(
          filters.task === "linked"
            ? "quality.bug.taskLinked"
            : "quality.bug.taskUnlinked"
        ),
      }),
      clear: () => patchParams({ [Q.task]: null }),
    });
  if (filters.reporter)
    advancedChips.push({
      key: "reporter",
      label: t("quality.bug.chip.reporter", {
        v:
          reporterOptions.find((o) => o.value === filters.reporter)?.label ??
          "",
      }),
      clear: () => patchParams({ [Q.reporter]: null }),
    });
  if (filters.environment)
    advancedChips.push({
      key: "environment",
      label: t("quality.bug.chip.environment", {
        v: envLabelOf(filters.environment),
      }),
      clear: () => patchParams({ [Q.environment]: null }),
    });

  const anyFilter =
    FILTER_KEYS.some((k) => searchParams.get(k)) || keyword.trim() !== "";

  const advancedPanel = (
    <div className="qc-adv-panel">
      <div className="qc-adv-field">
        <span>{t("quality.bug.reportedOn")}</span>
        <DatePicker.RangePicker
          allowEmpty={[true, true]}
          format="YYYY-MM-DD"
          value={rangeValue(filters.reported ?? null)}
          onChange={(v) =>
            patchParams(rangePatch(Q.reportedFrom, Q.reportedTo, v))
          }
        />
      </div>
      <div className="qc-adv-field">
        <span>{t("quality.bug.resolvedAt")}</span>
        <DatePicker.RangePicker
          allowEmpty={[true, true]}
          format="YYYY-MM-DD"
          value={rangeValue(filters.resolved ?? null)}
          onChange={(v) =>
            patchParams(rangePatch(Q.resolvedFrom, Q.resolvedTo, v))
          }
        />
      </div>
      <div className="qc-adv-field">
        <span>{t("quality.bug.filterTask")}</span>
        <Segmented
          value={filters.task ?? ""}
          onChange={(v) => patchParams({ [Q.task]: String(v) || null })}
          options={[
            { value: "", label: t("quality.common.all") },
            { value: "linked", label: t("quality.bug.taskLinked") },
            { value: "unlinked", label: t("quality.bug.taskUnlinked") },
          ]}
        />
      </div>
      <div className="qc-adv-field">
        <span>{t("quality.bug.reporter")}</span>
        <Select
          allowClear
          showSearch={{ optionFilterProp: "label" }}
          placeholder={t("quality.common.all")}
          value={filters.reporter}
          options={reporterOptions}
          onChange={(v) => patchParams({ [Q.reporter]: v ?? null })}
        />
      </div>
      <div className="qc-adv-field">
        <span>{t("quality.bug.environment")}</span>
        <Select
          allowClear
          showSearch={{ optionFilterProp: "label" }}
          placeholder={t("quality.common.all")}
          value={filters.environment}
          options={environmentOptions}
          onChange={(v) => patchParams({ [Q.environment]: v ?? null })}
        />
      </div>
    </div>
  );

  const settingsPanel = (
    <div className="qc-settings-panel">
      <Button
        type="text"
        block
        icon={<SettingOutlined />}
        onClick={() => setEnvManagerOpen(true)}
      >
        {t("quality.env.manage")}
      </Button>
      <Divider style={{ margin: "6px 0" }} />
      <div className="qc-settings-label">{t("quality.bug.columns")}</div>
      <Checkbox.Group
        className="qc-settings-cols"
        value={optionalCols}
        onChange={(v) => {
          const next = v as OptionalCol[];
          setOptionalCols(next);
          writeLocal(OPTIONAL_COLS_KEY, next);
        }}
        options={[
          { value: "reporter", label: t("quality.bug.reporter") },
          { value: "environment", label: t("quality.bug.environment") },
        ]}
      />
    </div>
  );

  // ---------------- 状態チップ ----------------
  const statusChips: ({ key: BugFilters["status"]; label: string } | null)[] = [
    { key: "active", label: t("quality.bug.statusActive") },
    null,
    ...(["open", "in_progress", "resolved", "verifying"] as BugStatus[]).map(
      (k) => ({ key: k, label: t(BUG_STATUS_META[k].i18nKey) })
    ),
    null,
    ...(["closed", "wontfix"] as BugStatus[]).map((k) => ({
      key: k,
      label: t(BUG_STATUS_META[k].i18nKey),
    })),
    { key: "all", label: t("quality.common.all") },
  ];

  const applyOverview = (patch: Record<string, string | null>) => {
    setKeyword("");
    patchParams({
      ...Object.fromEntries(
        [...FILTER_KEYS, Q.status, Q.sort].map((k) => [k, null])
      ),
      ...patch,
    });
  };

  return (
    <div className="qc-bugs">
      {/* 概況 */}
      <div className="qc-bug-overview">
        <button type="button" onClick={() => applyOverview({})}>
          {t("quality.bug.overview.active")}
          <b>{overview.active}</b>
        </button>
        <button
          type="button"
          onClick={() => applyOverview({ [Q.severity]: "high" })}
        >
          {t("quality.bug.overview.highSeverity")}
          <b className={overview.activeHighSeverity ? "is-danger" : ""}>
            {overview.activeHighSeverity}
          </b>
        </button>
        <button
          type="button"
          onClick={() => applyOverview({ [Q.assignee]: UNASSIGNED })}
        >
          {t("quality.common.unassigned")}
          <b className={overview.activeUnassigned ? "is-warn" : ""}>
            {overview.activeUnassigned}
          </b>
        </button>
        <button
          type="button"
          disabled={overview.oldestActiveDays == null}
          onClick={() => applyOverview({ [Q.sort]: "reportedOn:ascend" })}
        >
          {t("quality.bug.overview.oldest")}
          <b
            className={
              (overview.oldestActiveDays ?? 0) > AGE_WARN_DAYS ? "is-warn" : ""
            }
          >
            {overview.oldestActiveDays ?? "—"}
          </b>
          {overview.oldestActiveDays != null && t("quality.bug.overview.days")}
        </button>
        <span className="qc-bug-overview-week">
          {t("quality.bug.overview.thisWeek", {
            reported: overview.reportedThisWeek,
            resolved: overview.resolvedThisWeek,
          })}
        </span>
      </div>

      {/* 状態 */}
      <div className="qc-status-chips">
        {statusChips.map((c, i) =>
          c ? (
            <button
              key={c.key}
              type="button"
              className={status === c.key ? "is-on" : ""}
              aria-pressed={status === c.key}
              onClick={() =>
                patchParams({ [Q.status]: c.key === "active" ? null : c.key })
              }
            >
              {c.key in BUG_STATUS_META && (
                <i
                  style={{
                    background: BUG_STATUS_META[c.key as BugStatus].color,
                  }}
                />
              )}
              {c.label}
              <span className="qc-status-chip-n">
                {statusCounts[c.key] ?? 0}
              </span>
            </button>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: 区切り線は位置固定
            <span key={`sep-${i}`} className="qc-status-chips-sep" />
          )
        )}
      </div>

      {/* 検索・絞り込み */}
      <div className="qc-bug-toolbar">
        <Input
          ref={searchRef}
          allowClear
          className="qc-bug-search"
          prefix={<SearchOutlined className="qc-muted" />}
          suffix={keyword ? undefined : <kbd className="qc-kbd">/</kbd>}
          placeholder={t("quality.bug.searchPlaceholder")}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Select
          allowClear
          style={{ width: 170 }}
          popupMatchSelectWidth={false}
          placeholder={t("quality.bug.filterProject")}
          value={filters.project}
          onChange={(v) => patchParams({ [Q.project]: v ?? null })}
          options={[
            { value: WHOLE_PRODUCT, label: t("quality.bug.wholeProductShort") },
            ...custProjects.map((pr) => ({ value: pr.id, label: pr.name })),
          ]}
        />
        <Select
          allowClear
          showSearch={{ optionFilterProp: "label" }}
          style={{ width: 130 }}
          popupMatchSelectWidth={false}
          placeholder={t("quality.bug.filterAssignee")}
          value={filters.assignee}
          onChange={(v) => patchParams({ [Q.assignee]: v ?? null })}
          options={[
            ...p.memberOptions,
            { value: UNASSIGNED, label: t("quality.common.unassigned") },
          ]}
        />
        <Select
          allowClear
          style={{ width: 100 }}
          placeholder={t("quality.bug.filterSeverity")}
          value={filters.severity}
          onChange={(v) => patchParams({ [Q.severity]: v ?? null })}
          options={PRIORITY_KEYS.map((k) => ({
            value: k,
            label: t(BUG_SEVERITY_META[k].i18nKey),
          }))}
        />
        <Select
          allowClear
          style={{ width: 100 }}
          placeholder={t("quality.bug.filterPriority")}
          value={filters.priority}
          onChange={(v) => patchParams({ [Q.priority]: v ?? null })}
          options={PRIORITY_KEYS.map((k) => ({
            value: k,
            label: t(QC_PRIORITY_META[k].i18nKey),
          }))}
        />
        <Popover
          trigger="click"
          placement="bottomLeft"
          content={advancedPanel}
          title={t("quality.bug.advancedFilter")}
        >
          <Button type="text" icon={<FilterOutlined />}>
            {t("quality.bug.advancedFilter")}
            {advancedChips.length > 0 && (
              <Badge
                count={advancedChips.length}
                size="small"
                color="#1677ff"
              />
            )}
          </Button>
        </Popover>
        <span className="qc-grow" />
        <Button
          type="text"
          icon={<DownloadOutlined />}
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          {t("quality.bug.export")}
        </Button>
        <Popover
          trigger="click"
          placement="bottomRight"
          content={settingsPanel}
        >
          <Button
            type="text"
            icon={<SettingOutlined />}
            aria-label={t("quality.bug.settings")}
          />
        </Popover>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEditing({ open: true })}
        >
          {t("quality.bug.add")}
        </Button>
      </div>

      {anyFilter && (
        <div className="qc-filter-chips">
          {advancedChips.map((c) => (
            <Tag
              key={c.key}
              closable
              color="blue"
              variant="filled"
              onClose={(e) => {
                e.preventDefault();
                c.clear();
              }}
            >
              {c.label}
            </Tag>
          ))}
          <Button type="link" size="small" onClick={clearAllFilters}>
            {t("quality.bug.clearFilters")}
          </Button>
        </div>
      )}

      <Table<Bug>
        rowKey="id"
        size="middle"
        className="qc-bug-table"
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1040 + optionalCols.length * 130 }}
        onChange={onTableChange}
        showSorterTooltip={false}
        rowClassName={(r) => (isActiveBug(r.status) ? "" : "qc-bug-row-done")}
        pagination={{
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (total, [start, end]) =>
            t("quality.bug.pageTotal", { total, start, end }),
        }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
        }}
        locale={{ emptyText: t("quality.bug.empty") }}
      />

      {/* 一括操作バー（選択時のみ） */}
      {selectedIds.length > 0 && (
        <div className="qc-batch-bar" role="toolbar">
          <strong>
            {t("quality.bug.selectedN", { n: selectedIds.length })}
          </strong>
          <Dropdown
            trigger={["click"]}
            disabled={batchBusy}
            menu={{
              items: BUG_STATUS_ORDER.map((k) => ({
                key: k,
                label: <BugStatusPill status={k} t={t} />,
              })),
              onClick: ({ key }) =>
                runBatch((id) => api.updateBugStatus(id, key)),
            }}
          >
            <Button type="text">{t("quality.bug.batchStatus")}</Button>
          </Dropdown>
          <Dropdown
            trigger={["click"]}
            disabled={batchBusy}
            menu={{
              style: { maxHeight: 320, overflowY: "auto" },
              items: [
                {
                  key: UNASSIGNED,
                  label: (
                    <span className="qc-unassigned">
                      {t("quality.common.unassigned")}
                    </span>
                  ),
                },
                ...p.memberOptions.map((m) => ({
                  key: m.value,
                  label: <MemberLabel id={m.value} name={m.label} />,
                })),
              ],
              onClick: ({ key }) =>
                runBatch((id) =>
                  api.updateBug(
                    id,
                    key === UNASSIGNED
                      ? { clearAssignee: true }
                      : { assigneeMemberId: key }
                  )
                ),
            }}
          >
            <Button type="text">{t("quality.bug.batchAssignee")}</Button>
          </Dropdown>
          <Popover
            trigger="click"
            content={
              <TreeSelect
                showSearch
                treeNodeFilterProp="title"
                treeData={taskTreeData}
                value={undefined}
                disabled={batchBusy}
                style={{ width: 320 }}
                popupMatchSelectWidth={false}
                placeholder={t("quality.bug.batchLinkN", {
                  n: selectedIds.length,
                })}
                onChange={(v) => batchLink(v as string | undefined)}
                notFoundContent={t("quality.bug.noTask")}
              />
            }
          >
            <Button type="text" disabled={batchBusy}>
              {t("quality.bug.batchLink")}
            </Button>
          </Popover>
          <Popconfirm
            title={t("quality.bug.batchUnlinkConfirm", {
              n: selectedIds.length,
            })}
            onConfirm={() => batchLink(undefined, true)}
          >
            <Button type="text" disabled={batchBusy}>
              {t("quality.bug.batchUnlink")}
            </Button>
          </Popconfirm>
          <span className="qc-batch-sep" />
          <Button
            type="text"
            danger
            disabled={batchBusy}
            onClick={confirmBatchDelete}
          >
            {t("quality.common.delete")}
          </Button>
          <Button
            type="text"
            icon={<CloseOutlined />}
            aria-label={t("quality.bug.clearSelection")}
            onClick={() => setSelectedIds([])}
          />
        </div>
      )}

      {/* 詳細 drawer（読み取り専用。編集は右上ボタンから） */}
      <Drawer
        className="qc-detail-drawer"
        title={
          detail ? (
            <div className="qc-detail-head">
              <span className="qc-detail-no">{bugDisplayNo(detail)}</span>
            </div>
          ) : (
            ""
          )
        }
        open={!!detail}
        onClose={closeDetail}
        // 編集ドロワー（bug-edit.tsx）と同じ幅に揃える
        width="60%"
        extra={
          detail && (
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing({ open: true, bugId: detail.id });
                closeDetail();
              }}
            >
              {t("quality.bug.edit")}
            </Button>
          )
        }
      >
        {detail && (
          <div className="qc-bug-detail">
            <div className="qc-detail-badges">
              <span
                className="qc-badge"
                style={badgeStyle(BUG_STATUS_META[detail.status].color)}
              >
                <span
                  className="qc-dot"
                  style={{ background: BUG_STATUS_META[detail.status].color }}
                />
                {t(BUG_STATUS_META[detail.status].i18nKey)}
              </span>
              <span
                className="qc-badge"
                style={badgeStyle(BUG_SEVERITY_META[detail.severity].color)}
              >
                {t("quality.bug.severity")}·
                {t(BUG_SEVERITY_META[detail.severity].i18nKey)}
              </span>
              <span
                className="qc-badge"
                style={badgeStyle(QC_PRIORITY_META[detail.priority].color)}
              >
                {t("quality.bug.priority")}·
                {t(QC_PRIORITY_META[detail.priority].i18nKey)}
              </span>
              {detail.reopenCount > 0 && (
                <span className="qc-badge" style={badgeStyle("#fa541c")}>
                  {t("quality.bug.reopenCount", { n: detail.reopenCount })}
                </span>
              )}
            </div>

            <div className="qc-detail-grid">
              <MetaRow icon={<BugOutlined />} label={t("quality.bug.title")}>
                <span className="qc-detail-title">{detail.title}</span>
              </MetaRow>
              <MetaRow
                icon={<AppstoreOutlined />}
                label={t("quality.bug.project")}
              >
                {projectLabel(detail)}
              </MetaRow>
              <MetaRow
                icon={<UserOutlined />}
                label={t("quality.bug.reporter")}
              >
                {detail.reporterName || <span className="qc-muted">—</span>}
              </MetaRow>
              <MetaRow
                icon={<SolutionOutlined />}
                label={t("quality.bug.assignee")}
              >
                {detail.assigneeName || (
                  <span className="qc-muted">
                    {t("quality.common.unassigned")}
                  </span>
                )}
              </MetaRow>
              <MetaRow
                icon={<DesktopOutlined />}
                label={t("quality.bug.environment")}
              >
                {detail.environment || <span className="qc-muted">—</span>}
              </MetaRow>
              <MetaRow
                icon={<ExperimentOutlined />}
                label={t("quality.bug.testCase")}
              >
                {detail.testCaseId ? (
                  p.caseMap[detail.testCaseId] ?? detail.testCaseId
                ) : (
                  <span className="qc-muted">—</span>
                )}
              </MetaRow>
              <MetaRow icon={<LinkOutlined />} label={t("quality.bug.task")}>
                {detail.taskId ? (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto" }}
                    onClick={() => p.gotoGantt(detail.taskId as string)}
                  >
                    {p.taskMap[detail.taskId] ?? t("quality.common.openGantt")}
                  </Button>
                ) : (
                  <span className="qc-muted">—</span>
                )}
              </MetaRow>
              <MetaRow
                icon={<CalendarOutlined />}
                label={t("quality.bug.reportedOn")}
              >
                {detail.reportedOn || <span className="qc-muted">—</span>}
              </MetaRow>
              <MetaRow
                icon={<CheckCircleOutlined />}
                label={t("quality.bug.resolvedAt")}
              >
                {detail.resolvedAt ? (
                  detail.resolvedAt.slice(0, 10)
                ) : (
                  <span className="qc-muted">—</span>
                )}
              </MetaRow>
            </div>

            <div className="qc-detail-section">
              <div className="qc-detail-section-title">
                {t("quality.bug.description")}
              </div>
              {detail.description ? (
                // 説明は富文本 HTML（貼图可）。sanitize は後端保存時に実施。
                <div
                  className="qc-bug-desc"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: 富文本説明の描画
                  dangerouslySetInnerHTML={{ __html: detail.description }}
                />
              ) : (
                <div className="qc-bug-desc qc-bug-desc-empty">
                  {t("quality.bug.noDescription")}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* 編集/新規/複製 ドロワー（ページ幅 60%） */}
      <BugEditDrawer
        open={editing.open}
        bugId={editing.bugId}
        copyFromId={editing.copyFromId}
        customerId={customerId}
        onClose={closeEditing}
        onSaved={() => {
          reload();
        }}
      />

      <EnvironmentManager
        open={envManagerOpen}
        customerId={customerId}
        environments={p.environments}
        onClose={() => setEnvManagerOpen(false)}
        onChanged={() => {
          if (customerId) p.reloadEnvironments(customerId);
        }}
        t={t}
        message={message}
      />
    </div>
  );
}

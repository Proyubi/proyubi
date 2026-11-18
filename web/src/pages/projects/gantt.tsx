import {
  CompressOutlined,
  ExclamationCircleFilled,
  ExpandOutlined,
  FolderOpenOutlined,
  LayoutOutlined,
  LeftOutlined,
  PlusOutlined,
  SearchOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { useIntl, useNavigate, useParams, useSearchParams } from "@umijs/max";
import {
  App as AntApp,
  Breadcrumb,
  Button,
  Empty,
  Input,
  Progress,
  Segmented,
  Spin,
  Tabs,
  Tag,
} from "antd";
import {
  PROJECT_DISPLAY_STATUS_META,
  projectDisplayStatus,
} from "@/pm/utils/projectStatus";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listProjectDocs } from "@/pm/api";
import BoardView from "@/pm/board/BoardView";
import DesignBoardTab from "@/pm/design/DesignBoardTab";
import ProjectDocsPanel from "@/pm/docs/ProjectDocsPanel";
import GanttChart from "@/pm/gantt/GanttChart";
import type { Scale } from "@/pm/gantt/ganttLayout";
import TaskFormModal, { type TaskFormValue } from "@/pm/gantt/TaskFormModal";
import RoadmapView from "@/pm/roadmap/RoadmapView";
import RoadmapOptionManager from "@/pm/roadmap/RoadmapOptionManager";
import { useData, useProjectProgress } from "@/pm/store";
import type { PmDoc, Task } from "@/pm/types";
import { fmt, ISO } from "@/pm/utils/date";
import { matchTasks } from "@/pm/utils/filter";
import "./gantt.css";

type ViewTab = "gantt" | "board" | "roadmap" | "design";

export default function GanttPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusTaskId = searchParams.get("taskId") ?? undefined;
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { modal } = AntApp.useApp();
  const {
    projects,
    customerMap,
    memberMap,
    members,
    tasksOf,
    depsOf,
    toggleCollapse,
    setCollapsedAll,
    addTask,
    updateTask,
    deleteTask,
    setTaskStatus,
    setTaskAssignees,
    ensureBase,
    loadProject,
    baseLoaded,
    isProjectLoaded,
    holidays,
  } = useData();

  useEffect(() => {
    ensureBase();
    loadProject(projectId);
  }, [ensureBase, loadProject, projectId]);

  // 从俯瞰页带 ?taskId= 跳入：高亮该任务行
  useEffect(() => {
    if (focusTaskId) setSelectedId(focusTaskId);
  }, [focusTaskId]);

  const project = projects.find((p) => p.id === projectId);
  // サブプロジェクトなら親（パンくずに「親：xxx」を出す）
  const parentProject = project?.parentId
    ? projects.find((p) => p.id === project.parentId)
    : undefined;
  const tasks = tasksOf(projectId);
  const deps = depsOf(projectId);
  const progress = useProjectProgress(projectId);
  const ready = baseLoaded && isProjectLoaded(projectId);

  const tabParam = searchParams.get("tab");
  const tab: ViewTab =
    tabParam === "board" || tabParam === "roadmap" || tabParam === "design"
      ? tabParam
      : "gantt";
  const setTab = (next: ViewTab) => {
    const sp = new URLSearchParams(searchParams);
    if (next === "gantt") sp.delete("tab");
    else sp.set("tab", next);
    // デザインボードの ?open= / ?new= は他のタブに持ち越さない
    sp.delete("open");
    sp.delete("new");
    setSearchParams(sp, { replace: true });
  };
  const [scale, setScale] = useState<Scale>("day");
  const [selectedId, setSelectedId] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | undefined>();
  const [parentForChild, setParentForChild] = useState<Task | undefined>();
  const [optionMgrOpen, setOptionMgrOpen] = useState(false);
  /** WBS / ボード内のキーワード絞り込み。案件を跨ぐ検索は ⌘K パレット側の担当。 */
  const [filterKw, setFilterKw] = useState("");

  // 案件を移動したら絞り込みは持ち越さない
  useEffect(() => {
    setFilterKw("");
  }, [projectId]);

  // 案件資料（外部ドライブのリンク）。ボタンの件数表示のため、ドロワーを開く前から取得しておく
  const [docs, setDocs] = useState<PmDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const reloadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      setDocs(await listProjectDocs(projectId));
    } catch {
      setDocs([]);
    } finally {
      setDocsLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    setDocs([]);
    setDocsOpen(false);
    if (projectId) reloadDocs();
  }, [projectId, reloadDocs]);
  // タスク編集ドロワーの「資料」タブで追加された分をボタンの件数に反映する
  useEffect(() => {
    if (!formOpen && editing) reloadDocs();
  }, [formOpen]);
  const docCount = useMemo(() => docs.filter((d) => !d.isRoot).length, [docs]);
  const openDocs = () => {
    setDocsOpen(true);
    // タスク編集ドロワー側で紐付けが変わっている可能性があるので開くたびに取り直す
    reloadDocs();
  };

  // ロードマップは行モデルが別なので絞り込みの対象外。タブを離れたら解除する。
  const filterable = tab === "gantt" || tab === "board";
  const activeKw = filterable ? filterKw : "";
  const filterResult = useMemo(
    () => matchTasks(tasks, activeKw),
    [tasks, activeKw]
  );

  const collapsedCount = useMemo(
    () => tasks.filter((t) => t.type === "summary" && t.collapsed).length,
    [tasks]
  );

  if (!ready) {
    return (
      <div style={{ textAlign: "center", marginTop: 160 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!project) {
    return (
      <Empty
        description={t("projects.gantt.notFound")}
        style={{ marginTop: 120 }}
      />
    );
  }
  const meta = PROJECT_DISPLAY_STATUS_META[projectDisplayStatus(project, progress)];
  const customerName = customerMap[project.customerId]?.name;

  const openCreateRoot = () => {
    setEditing(undefined);
    // 顶部「添加任务」始终新建根任务，允许一个项目下并列多个根（多棵 WBS 树）
    setParentForChild(undefined);
    setFormOpen(true);
  };
  const openAddChild = (parent: Task) => {
    setEditing(undefined);
    setParentForChild(parent);
    setFormOpen(true);
  };
  const openEdit = (task: Task) => {
    setParentForChild(undefined);
    setEditing(task);
    setFormOpen(true);
  };
  const confirmDelete = (task: Task) => {
    modal.confirm({
      title: t("projects.gantt.deleteTask.title", { name: task.name }),
      icon: <ExclamationCircleFilled />,
      content:
        task.type === "summary"
          ? t("projects.gantt.deleteTask.summary")
          : t("projects.gantt.deleteTask.leaf"),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: () => {
        deleteTask(task.id);
        if (selectedId === task.id) setSelectedId(undefined);
      },
    });
  };

  const handleAssigneeChange = async (taskId: string, ids: string[]) => {
    // 楽観更新（updateTask だと PUT → 全タスク refetch まで選択が反映されない）
    await setTaskAssignees(taskId, ids);
  };

  const handleSubmit = async (v: TaskFormValue) => {
    const isMs = v.type === "milestone";
    const start = v.range[0].format(ISO);
    // milestone：单一时间点，end === start
    const end = isMs ? start : v.range[1].format(ISO);
    // 実績起止：里程碑不收集。開始日のみでも保存可＝着手中（進行中）。
    // 開始が権威：開始あり＝実績あり、終了なし＝ongoing。開始なし＝未着手（両端無効）。
    const aStart = !isMs ? v.actualRange?.[0] ?? null : null;
    const aEnd = !isMs ? v.actualRange?.[1] ?? null : null;
    const hasActual = aStart != null;
    const actualStart = hasActual ? aStart!.format(ISO) : null;
    const actualEnd = hasActual && aEnd != null ? aEnd!.format(ISO) : null;
    // 工期（予定/実績の 手动 d + h）：milestone/summary 不收集（summary 由子任务汇总）。
    // 解耦后「手动 d/h」独立存储：days != null 即该套手动优先，否则后端回退按期间派生。
    // - hours：通常タスクは常に数値（空→0）で送り、後端の「null=不変」更新と衝突しないように。
    // - days：手填→数值；両框（d も h も）空＝「自動へ戻す」意図。だが update は null=不変のため
    //   days:null では既存の手动値を NULL へ戻せない → clearEffort 旗で明示クリアする。
    const collectEffort = !isMs && v.type !== "summary";
    const plannedEffortHours = collectEffort ? v.plannedEffortHours ?? 0 : null;
    const actualEffortHours = collectEffort ? v.actualEffortHours ?? 0 : null;
    // days は「未設定（自動）」を保てるよう ?? 0 せず null をそのまま透传。
    const plannedEffortDays = collectEffort
      ? v.plannedEffortDays ?? null
      : null;
    const actualEffortDays = collectEffort ? v.actualEffortDays ?? null : null;
    // 予定・実績どちらの d も空＝両套とも手动解除 → 自動（期間派生）へ戻す。
    const clearEffort =
      collectEffort && plannedEffortDays == null && actualEffortDays == null;

    if (editing) {
      await updateTask(editing.id, {
        name: v.name,
        type: v.type,
        start,
        end,
        actualStart,
        actualEnd,
        plannedEffortHours,
        actualEffortHours,
        plannedEffortDays,
        actualEffortDays,
        // 两套 d 均空 → 显式清回 null（回退期间派生）；否则 days!=null 即手动写入
        clearEffort,
        // 未着手（開始なし）→ 実績両端を明示クリア
        clearActual: !hasActual,
        // 着手中（開始あり・終了なし）→ 終了だけを明示クリア（既存の完了日を進行中へ戻す）
        clearActualEnd: hasActual && actualEnd == null,
        progress: isMs ? 100 : v.progress,
        // 状态仅通常タスク可选；里程碑/汇总不收集，由后端保持原值/缺省
        status: isMs || v.type === "summary" ? undefined : v.status,
        assigneeIds: v.assigneeIds,
        levels: v.levels,
        description: v.description,
        // 所属项目（フェーズ）/ 上位タスク（親フェーズ）：reparent 让 parentId 成为权威值（含移到根级）
        projectId: v.projectId ?? editing.projectId,
        parentId: v.parentId ?? null,
        reparent: true,
        roadmapVisible: v.roadmapVisible,
        roadmapLane: v.roadmapLane ?? null,
        milestoneColor: isMs ? v.milestoneColor ?? null : null,
      });
    } else {
      const parentId = parentForChild?.id ?? null;
      const siblings = tasks.filter((t) => t.parentId === parentId);
      const order = siblings.reduce((m, t) => Math.max(m, t.order), -1) + 1;
      // 给叶子加子任务 → 父先变汇总，避免汇总值被父自身的工期/进度污染
      if (parentForChild && parentForChild.type !== "summary") {
        await updateTask(parentForChild.id, {
          type: "summary",
          assigneeIds: [],
        });
      }
      await addTask({
        projectId,
        parentId,
        name: v.name,
        type: v.type,
        start,
        end,
        actualStart,
        actualEnd,
        plannedEffortHours,
        actualEffortHours,
        plannedEffortDays,
        actualEffortDays,
        progress: isMs ? 100 : v.progress,
        status: isMs || v.type === "summary" ? undefined : v.status,
        assigneeIds: v.assigneeIds,
        levels: v.levels,
        description: v.description,
        order,
        roadmapVisible: v.roadmapVisible,
        roadmapLane: v.roadmapLane ?? null,
        milestoneColor: isMs ? v.milestoneColor ?? null : null,
      });
    }
    setFormOpen(false);
  };

  return (
    <div className="gp-page">
      <div className="gp-header">
        {/* パンくずは「親まで」。案件名は直下の見出しが名乗るので繰り返さない
            （以前はパンくずと見出しで同じ文字列が 2 行続いていた）。 */}
        <div className="gp-header-top">
          <Breadcrumb
            items={[
              {
                title: (
                  <a onClick={() => nav("/projects")}>{t("projects.title")}</a>
                ),
              },
              // 顧客名が未取得のときは空リンクを出さず、パンくずを 1 段に留める
              ...(customerName
                ? [
                    {
                      title: (
                        <a
                          onClick={() =>
                            nav(`/projects?customerId=${project.customerId}`)
                          }
                        >
                          {customerName}
                        </a>
                      ),
                    },
                  ]
                : []),
              // サブプロジェクト：親を 1 段挟む（「親：xxx」→ 親のガントへ）
              ...(parentProject
                ? [
                    {
                      title: (
                        <a
                          onClick={() =>
                            nav(`/projects/${parentProject.id}/gantt`)
                          }
                        >
                          {t("projects.sub.parentCrumb", {
                            name: parentProject.name,
                          })}
                        </a>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
        <div className="gp-header-main">
          <div className="gp-title-block">
            <Button
              className="gp-back"
              type="text"
              icon={<LeftOutlined />}
              onClick={() => nav(`/projects?customerId=${project.customerId}`)}
            />
            <h1 className="gp-title" title={project.name}>
              {project.name}
            </h1>
            <Tag color={meta.color} bordered={false}>
              {t(meta.i18nKey)}
            </Tag>
            {/* 期間と進捗は「識別」ではなく「状況」。区切り線で見出しから切り離す */}
            <span className="gp-meta">
              <span className="gp-dates">
                {fmt(project.start, "YYYY/MM/DD")} ～{" "}
                {project.end
                  ? fmt(project.end, "YYYY/MM/DD")
                  : t("projects.card.ongoing")}
              </span>
              <Progress
                className="gp-progress"
                percent={progress}
                size="small"
                strokeColor={progress === 100 ? "#52c41a" : "#2f6bff"}
              />
            </span>
          </div>
          {(tab === "gantt" || tab === "board") && (
            <div className="gp-actions">
              <Button icon={<FolderOpenOutlined />} onClick={openDocs}>
                {t("docs.projectButton", { n: docCount })}
              </Button>
              {/* モックアップ一覧（M6）。1280px でツールバーが折り返さないようアイコンのみ */}
              <Button
                icon={<LayoutOutlined />}
                title={t("mockup.page.entry")}
                aria-label={t("mockup.page.entry")}
                onClick={() => nav(`/projects/${projectId}/mockups`)}
              />
              {tab === "gantt" && (
                <>
                  <Segmented
                    value={scale}
                    onChange={(v) => setScale(v as Scale)}
                    options={[
                      { value: "day", label: t("projects.gantt.scale.day") },
                      { value: "week", label: t("projects.gantt.scale.week") },
                    ]}
                  />
                  {/* ラベルは短縮形。「すべて」に効くことは title（ネイティブ tooltip）で補う */}
                  <Button
                    icon={
                      collapsedCount > 0 ? (
                        <ExpandOutlined />
                      ) : (
                        <CompressOutlined />
                      )
                    }
                    title={
                      collapsedCount > 0
                        ? t("projects.gantt.expandAll")
                        : t("projects.gantt.collapseAll")
                    }
                    onClick={() =>
                      setCollapsedAll(projectId, collapsedCount === 0)
                    }
                  >
                    {collapsedCount > 0
                      ? t("projects.gantt.expandAllShort")
                      : t("projects.gantt.collapseAllShort")}
                  </Button>
                </>
              )}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreateRoot}
              >
                {t("projects.gantt.addTask")}
              </Button>
            </div>
          )}
          {tab === "design" && (
            <div className="gp-actions">
              <Button icon={<FolderOpenOutlined />} onClick={openDocs}>
                {t("docs.projectButton", { n: docCount })}
              </Button>
              <Button
                icon={<LayoutOutlined />}
                title={t("mockup.page.entry")}
                aria-label={t("mockup.page.entry")}
                onClick={() => nav(`/projects/${projectId}/mockups`)}
              />
            </div>
          )}
          {tab === "roadmap" && (
            <div className="gp-actions">
              <Button icon={<FolderOpenOutlined />} onClick={openDocs}>
                {t("docs.projectButton", { n: docCount })}
              </Button>
              {/* モックアップ一覧（M6）。1280px でツールバーが折り返さないようアイコンのみ */}
              <Button
                icon={<LayoutOutlined />}
                title={t("mockup.page.entry")}
                aria-label={t("mockup.page.entry")}
                onClick={() => nav(`/projects/${projectId}/mockups`)}
              />
              <Button
                icon={<TagsOutlined />}
                onClick={() => setOptionMgrOpen(true)}
              >
                {t("projects.roadmap.optionManager.entry")}
              </Button>
            </div>
          )}
        </div>
        {/* 絞り込みはツールバー（gp-actions）ではなくタブ行の右端に置く。
            gp-header-main は flex-wrap:wrap なので、日/週・折りたたむ・追加 の隣に足すと
            1280px 幅で行が折り返し、height:calc(100vh - 32px) 固定のガントが 1 行分縮む。
            タブ行の右側は元々空いており、「今のタブの中身を絞る」という意味とも一致する。 */}
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as ViewTab)}
          className="gp-tabs"
          tabBarExtraContent={
            filterable ? (
              <div className="gp-filter">
                <Input
                  allowClear
                  value={filterKw}
                  onChange={(e) => setFilterKw(e.target.value)}
                  placeholder={t("projects.gantt.filter.placeholder")}
                  prefix={<SearchOutlined className="gp-filter-icon" />}
                  className="gp-filter-input"
                />
                {filterKw.trim() && (
                  <span
                    className={`gp-filter-hits${
                      filterResult.hitCount === 0 ? " is-zero" : ""
                    }`}
                  >
                    {t("projects.gantt.filter.hits", {
                      n: filterResult.hitCount,
                    })}
                  </span>
                )}
              </div>
            ) : null
          }
          items={[
            { key: "gantt", label: t("projects.gantt.tab.wbs") },
            { key: "board", label: t("projects.gantt.tab.board") },
            { key: "roadmap", label: t("projects.gantt.tab.roadmap") },
            { key: "design", label: t("projects.gantt.tab.design") },
          ]}
        />
      </div>

      {tab === "design" ? (
        <DesignBoardTab projectId={projectId} />
      ) : tab === "roadmap" ? (
        <RoadmapView projectId={projectId} />
      ) : tab === "board" ? (
        <BoardView
          tasks={tasks}
          memberMap={memberMap}
          selectedId={selectedId}
          keepIds={filterResult.keepIds}
          hitIds={filterResult.hitIds}
          keyword={activeKw}
          onSelect={setSelectedId}
          onEdit={openEdit}
          onStatusChange={setTaskStatus}
        />
      ) : filterResult.keepIds && filterResult.hitCount === 0 ? (
        <div className="gp-empty">
          <Empty
            description={t("projects.gantt.filter.empty", {
              kw: filterKw.trim(),
            })}
          >
            <Button onClick={() => setFilterKw("")}>
              {t("projects.gantt.filter.clear")}
            </Button>
          </Empty>
        </div>
      ) : tasks.length === 0 ? (
        <div className="gp-empty">
          <Empty description={t("projects.gantt.empty.desc")}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateRoot}
            >
              {t("projects.gantt.addTask")}
            </Button>
          </Empty>
        </div>
      ) : (
        <GanttChart
          tasks={tasks}
          deps={deps}
          memberMap={memberMap}
          members={members}
          scale={scale}
          holidays={holidays}
          plannedTotal={project?.plannedTotalMinutes ?? null}
          actualTotal={project?.actualTotalMinutes ?? null}
          selectedId={selectedId}
          keepIds={filterResult.keepIds}
          hitIds={filterResult.hitIds}
          keyword={activeKw}
          onSelect={setSelectedId}
          onToggle={toggleCollapse}
          onAddChild={openAddChild}
          onEdit={openEdit}
          onDelete={confirmDelete}
          onAssigneeChange={handleAssigneeChange}
        />
      )}

      <TaskFormModal
        open={formOpen}
        showDocs
        task={editing}
        parentName={parentForChild?.name}
        members={members}
        projects={projects}
        activeProject={project}
        customerMap={customerMap}
        currentProjectTasks={tasks}
        onCancel={() => setFormOpen(false)}
        onSubmit={handleSubmit}
      />
      <ProjectDocsPanel
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        project={project}
        tasks={tasks}
        docs={docs}
        loading={docsLoading}
        onChanged={reloadDocs}
        onOpenTask={(taskId) => {
          const tk = tasks.find((x) => x.id === taskId);
          if (!tk) return;
          setDocsOpen(false);
          setSelectedId(taskId);
          openEdit(tk);
        }}
      />
      <RoadmapOptionManager
        open={optionMgrOpen}
        onClose={() => setOptionMgrOpen(false)}
      />
    </div>
  );
}

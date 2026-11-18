import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Checkbox, DatePicker, Segmented, Select, Spin } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { PageContainer } from "@ant-design/pro-components";
import { useIntl } from "@umijs/max";
import { useData } from "@/pm/store";
import { getWorkload } from "@/pm/api";
import type { Task, WorkloadItem } from "@/pm/types";
import ResourceView, {
  type ResourceMode,
  type ResourceScale,
} from "@/pm/resource/ResourceView";
import ResourceListView from "@/pm/resource/ResourceListView";
import ResourceStats from "@/pm/resource/ResourceStats";
import TaskFormModal, { type TaskFormValue } from "@/pm/gantt/TaskFormModal";

/** 月份时间窗：[开始月, 结束月]；null = 自动（覆盖全部任务期间） */
type MonthRange = [Dayjs, Dayjs] | null;

/** 视图形态：タイムライン（甘特风）/ リスト（表格） */
type ViewType = "timeline" | "list";

export default function ResourcesPage() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  const {
    members,
    projects,
    customerMap,
    ensureBase,
    baseLoaded,
    loadProject,
    isProjectLoaded,
    tasksOf,
    updateTask,
  } = useData();

  const [mode, setMode] = useState<ResourceMode>("single");
  // 视图形态：默认タイムライン，可切到リスト（同一份筛选数据）
  const [viewType, setViewType] = useState<ViewType>("timeline");
  // 时间轴粒度：默认「日」逐日查看，可切到「週」
  const [scale, setScale] = useState<ResourceScale>("day");
  const [memberId, setMemberId] = useState<string>();
  const [items, setItems] = useState<WorkloadItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 任务编辑（点击任务名 / 甘特条打开）
  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | undefined>();
  const [editProjectId, setEditProjectId] = useState<string>();
  // 待解析的编辑请求：等所属项目任务加载完成后再打开弹窗
  const [pendingEdit, setPendingEdit] = useState<{
    taskId: string;
    projectId: string;
  } | null>(null);
  // 时间窗：默认显示「本月前 2 个月 ~ 本月后 3 个月」共 6 个月窗口（开始月 / 结束月已预填）。
  // 清空后即 null = 自动（覆盖该成员/全员全部任务期间，跨年也不裁掉）。
  const [monthRange, setMonthRange] = useState<MonthRange>(() => [
    dayjs().subtract(2, "month").startOf("month"),
    dayjs().add(3, "month").startOf("month"),
  ]);
  // 隐藏已完成任务（progress >= 100）
  const [hideCompleted, setHideCompleted] = useState(true);

  useEffect(() => {
    ensureBase();
  }, [ensureBase]);

  // 单人模式默认选中第一个成员
  useEffect(() => {
    if (!baseLoaded) return;
    if (mode !== "single") return;
    const stillValid = memberId && members.some((m) => m.id === memberId);
    if (stillValid) return;
    setMemberId(members[0]?.id);
  }, [baseLoaded, members, mode, memberId]);

  // 防止过期响应覆盖最新（切换成员 / 模式时）
  const reqSeq = useRef(0);

  // 拉取工时：全员模式无 memberId；单人模式按 memberId
  const reloadWorkload = useCallback(() => {
    if (!baseLoaded) return;
    if (mode === "single" && !memberId) {
      setItems([]);
      return;
    }
    const seq = ++reqSeq.current;
    setLoading(true);
    getWorkload(mode === "single" ? memberId : undefined)
      .then((list) => {
        if (seq !== reqSeq.current) return;
        setItems(list ?? []);
      })
      .finally(() => {
        if (seq === reqSeq.current) setLoading(false);
      });
  }, [baseLoaded, mode, memberId]);

  useEffect(() => {
    reloadWorkload();
  }, [reloadWorkload]);

  // 点击任务 → 确保所属项目任务已加载，再解析出完整 Task 打开编辑
  const handleEditTask = useCallback(
    (item: WorkloadItem) => {
      setPendingEdit({ taskId: item.taskId, projectId: item.projectId });
      loadProject(item.projectId);
    },
    [loadProject]
  );

  useEffect(() => {
    if (!pendingEdit) return;
    if (!isProjectLoaded(pendingEdit.projectId)) return;
    const task = tasksOf(pendingEdit.projectId).find(
      (x) => x.id === pendingEdit.taskId
    );
    if (task) {
      setEditTask(task);
      setEditProjectId(pendingEdit.projectId);
      setFormOpen(true);
    }
    setPendingEdit(null);
  }, [pendingEdit, isProjectLoaded, tasksOf]);

  const closeForm = () => {
    setFormOpen(false);
    setEditTask(undefined);
  };

  const handleSubmit = async (v: TaskFormValue) => {
    if (!editTask) return;
    const isMs = v.type === "milestone";
    const start = v.range[0].format("YYYY-MM-DD");
    const end = isMs ? start : v.range[1].format("YYYY-MM-DD");
    const aStart = !isMs ? v.actualRange?.[0] ?? null : null;
    const aEnd = !isMs ? v.actualRange?.[1] ?? null : null;
    // 着手判定は「開始あり」のみ（gantt と統一）。終了なし＝着手中。
    const hasActual = aStart != null;
    const actualStart = hasActual ? aStart!.format("YYYY-MM-DD") : null;
    const actualEnd =
      hasActual && aEnd != null ? aEnd!.format("YYYY-MM-DD") : null;
    // 工数（予定/実績の 手动 d + h）：milestone/summary 不収集。gantt.tsx handleSubmit と同じ規則。
    const collectEffort = !isMs && v.type !== "summary";
    const plannedEffortHours = collectEffort ? v.plannedEffortHours ?? 0 : null;
    const actualEffortHours = collectEffort ? v.actualEffortHours ?? 0 : null;
    const plannedEffortDays = collectEffort
      ? v.plannedEffortDays ?? null
      : null;
    const actualEffortDays = collectEffort ? v.actualEffortDays ?? null : null;
    const clearEffort =
      collectEffort && plannedEffortDays == null && actualEffortDays == null;
    await updateTask(editTask.id, {
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
      clearEffort,
      clearActual: !hasActual,
      clearActualEnd: hasActual && actualEnd == null,
      progress: isMs ? 100 : v.progress,
      status: isMs || v.type === "summary" ? undefined : v.status,
      assigneeIds: v.assigneeIds,
      levels: v.levels,
      description: v.description,
      projectId: v.projectId ?? editTask.projectId,
      parentId: v.parentId ?? null,
      reparent: true,
      roadmapVisible: v.roadmapVisible,
      roadmapLane: v.roadmapLane ?? null,
      milestoneColor: isMs ? v.milestoneColor ?? null : null,
    });
    closeForm();
    reloadWorkload();
  };

  const selectedMember = useMemo(
    () => members.find((m) => m.id === memberId),
    [members, memberId]
  );

  const memberOptions = useMemo(
    () =>
      members.map((m) => ({
        value: m.id,
        label: (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: m.color || "#1677ff",
                display: "inline-block",
              }}
            />
            {m.name}
          </span>
        ),
        // 供搜索匹配
        title: m.name,
      })),
    [members]
  );

  // 隐藏已完成（progress >= 100）后参与展示的条目
  const visibleItems = useMemo(
    () =>
      hideCompleted ? items.filter((it) => (it.progress ?? 0) < 100) : items,
    [items, hideCompleted]
  );

  // 传给视图的时间窗：选了月份则按 [开始月, 结束月]；否则 null = 自动覆盖全部任务
  const range = useMemo(
    () =>
      monthRange
        ? {
            start: monthRange[0].format("YYYY-MM-DD"),
            end: monthRange[1].format("YYYY-MM-DD"),
          }
        : null,
    [monthRange]
  );

  const pickMember = (id: string) => {
    setMemberId(id);
    setMode("single");
  };

  return (
    <PageContainer
      title={t("resources.title")}
      subTitle={t("resources.subtitle")}
    >
      {!baseLoaded ? (
        <div style={{ textAlign: "center", padding: "120px 0" }}>
          <Spin size="large" />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Segmented<ResourceMode>
              value={mode}
              onChange={(v) => setMode(v)}
              options={[
                { value: "single", label: t("resources.mode.single") },
                { value: "all", label: t("resources.mode.all") },
              ]}
            />
            {mode === "single" && (
              <Select
                showSearch
                style={{ minWidth: 220 }}
                value={memberId}
                onChange={setMemberId}
                placeholder={t("resources.member.placeholder")}
                notFoundContent={t("resources.member.empty")}
                optionFilterProp="title"
                options={memberOptions}
              />
            )}
            <DatePicker.RangePicker
              picker="month"
              value={monthRange}
              onChange={(v) =>
                setMonthRange(v?.[0] && v[1] ? [v[0], v[1]] : null)
              }
              allowClear
              placeholder={[
                t("resources.range.start"),
                t("resources.range.end"),
              ]}
            />
            <Segmented<ViewType>
              value={viewType}
              onChange={(v) => setViewType(v)}
              options={[
                { value: "timeline", label: t("resources.view.timeline") },
                { value: "list", label: t("resources.view.list") },
              ]}
            />
            {viewType === "timeline" && (
              <Segmented<ResourceScale>
                value={scale}
                onChange={(v) => setScale(v)}
                options={[
                  { value: "day", label: t("resources.scale.day") },
                  { value: "week", label: t("resources.scale.week") },
                ]}
              />
            )}
            <Checkbox
              checked={hideCompleted}
              onChange={(e) => setHideCompleted(e.target.checked)}
            >
              {t("resources.hideCompleted")}
            </Checkbox>
          </div>

          {/* 個人モード：工時実績サマリー（実績は完了タスクも含むため、hideCompleted 前の items を渡す） */}
          {mode === "single" && memberId && (
            <ResourceStats
              loading={loading}
              items={items}
              member={selectedMember}
              members={members}
              range={range}
            />
          )}

          {viewType === "timeline" ? (
            <ResourceView
              mode={mode}
              scale={scale}
              loading={loading}
              items={visibleItems}
              member={selectedMember}
              members={members}
              onPickMember={pickMember}
              onEditTask={handleEditTask}
              range={range}
            />
          ) : (
            <ResourceListView
              loading={loading}
              items={visibleItems}
              members={members}
              onEditTask={handleEditTask}
            />
          )}
        </div>
      )}

      <TaskFormModal
        open={formOpen}
        task={editTask}
        members={members}
        projects={projects}
        customerMap={customerMap}
        currentProjectTasks={editProjectId ? tasksOf(editProjectId) : []}
        onCancel={closeForm}
        onSubmit={handleSubmit}
      />
    </PageContainer>
  );
}

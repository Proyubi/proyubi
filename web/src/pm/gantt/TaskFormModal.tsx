import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "@umijs/max";
import {
  Drawer,
  Button,
  Form,
  Input,
  InputNumber,
  DatePicker,
  Select,
  Slider,
  Segmented,
  Collapse,
  Switch,
  Row,
  Col,
  Tabs,
  Space,
  Typography,
} from "antd";
import type {
  Customer,
  Member,
  Project,
  Task,
  TaskStatus,
  TaskType,
} from "../types";
import { TASK_STATUS_META, TASK_STATUS_ORDER } from "../types";
import type { Dayjs } from "dayjs";
import dayjs, {
  effortFromDH,
  effortMinutes,
  fmtDuration,
  getHoursPerDay,
  isManualEffort,
  workingDays,
} from "../utils/date";
import { listTasks } from "../api";
import { useData } from "../store";
import RichTextEditor from "../components/RichTextEditor";
import TaskActivity from "../components/TaskActivity";
import TaskComments from "../components/TaskComments";
import TaskLinks from "../components/TaskLinks";
import DesignTaskPanel from "../design/DesignTaskPanel";
import MockupPanel from "../mockup/MockupPanel";
import TaskDocs from "../docs/TaskDocs";
import { TaskBugs, TaskTestCases } from "../components/TaskQuality";

/** rootId 及其全部子孙的 id 集合（用于父级下拉排除自身子树，防环） */
function subtreeIds(rootId: string, tasks: Task[]): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) {
      if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
        ids.add(t.id);
        grew = true;
      }
    }
  }
  return ids;
}

export interface TaskFormValue {
  name: string;
  type: TaskType;
  /** 计划起止 */
  range: [Dayjs, Dayjs];
  /** 实际起止（可空；任一为空视为未填） */
  actualRange?: [Dayjs | null, Dayjs | null] | null;
  /** 予定工期·小时（0–23.75，可小数 0.25 步进）。与 plannedEffortDays 组手动 d/h；days空且本字段空/0 才回退期间派生 */
  plannedEffortHours?: number | null;
  /** 実績工期·小时（0–23.75，可小数 0.25 步进）。与 actualEffortDays 组手动 d/h；days空且本字段空/0 才回退期间派生 */
  actualEffortHours?: number | null;
  /** 予定工期·日数（手动，1d=24h）。与 plannedEffortHours 组成手动 d/h；days空且 hours空/0=回退期间派生 */
  plannedEffortDays?: number | null;
  /** 実績工期·日数（手动，1d=24h）。与 actualEffortHours 组成手动 d/h；days空且 hours空/0=回退期间派生 */
  actualEffortDays?: number | null;
  progress: number;
  /** 看板业务状态（仅通常タスク有意义） */
  status: TaskStatus;
  assigneeIds: string[];
  levels: string[];
  description?: string;
  // ===== 所属（仅编辑时） =====
  /** 所属项目（フェーズ）；跨项目移动用 */
  projectId?: string;
  /** 上位タスク（親フェーズ）；null=最上位（根级） */
  parentId?: string | null;
  // ===== 路线图设置 =====
  roadmapVisible?: boolean;
  roadmapLane?: string | null;
  milestoneColor?: string | null;
}

interface Props {
  open: boolean;
  /** 编辑时传入；新建为 undefined */
  task?: Task;
  /** 新建子任务时的父任务名（仅用于标题提示） */
  parentName?: string;
  members: Member[];
  /** 全部项目（编辑时用于「所属项目」下拉，按客户分组） */
  projects?: Project[];
  /** 当前 Gantt 页所属项目（新建任务时无 projectId 字段，作为期间约束的兜底） */
  activeProject?: Project;
  customerMap?: Record<string, Customer>;
  /** 当前编辑任务所属项目的全部任务（用于父级下拉与排除自身子树） */
  currentProjectTasks?: Task[];
  /** Drive 資料は Gantt から開く場合だけ有効にする。共用先（リソース等）では非表示。 */
  showDocs?: boolean;
  onCancel: () => void;
  onSubmit: (v: TaskFormValue) => void;
}

export default function TaskFormModal({
  open,
  task,
  parentName,
  members,
  projects,
  activeProject,
  customerMap,
  currentProjectTasks,
  showDocs = false,
  onCancel,
  onSubmit,
}: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { roadmapOptionsOf, holidays } = useData();
  // 路线图字典下拉（泳道 / 里程碑色），取代写死枚举
  const laneOptions = useMemo(
    () =>
      roadmapOptionsOf("lane").map((o) => ({
        value: o.optionKey,
        label: o.label,
      })),
    [roadmapOptionsOf]
  );
  const msColorOptions = useMemo(
    () =>
      roadmapOptionsOf("ms_color").map((o) => ({
        value: o.optionKey,
        label: o.label,
      })),
    [roadmapOptionsOf]
  );
  // 看板业务状态下拉（带色点），复用 board 的标签与圆点色
  const statusOptions = useMemo(
    () =>
      TASK_STATUS_ORDER.map((s) => ({
        value: s,
        label: (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: TASK_STATUS_META[s].color,
                flex: "none",
              }}
            />
            {t(TASK_STATUS_META[s].i18nKey)}
          </span>
        ),
      })),
    [intl]
  );
  const [form] = Form.useForm<TaskFormValue>();
  const type = Form.useWatch("type", form);
  const selectedProjectId = Form.useWatch("projectId", form);
  /** 切到「其他项目」时拉取该项目任务，用于父级下拉 */
  const [otherTasks, setOtherTasks] = useState<Task[]>([]);
  /** 上一次的 type，用于「新建时切换到 milestone」自动套默认时刻 */
  const prevType = useRef<TaskType | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    if (task) {
      form.setFieldsValue({
        name: task.name,
        type: task.type,
        range: [dayjs(task.start), dayjs(task.end)],
        // 実績：開始日のみ＝着手中（進行中）も復元する。両端そろっている時だけ
        // 復元すると、着手中タスクを開き直した際に空欄表示→保存で開始日まで消える。
        actualRange: task.actualStart
          ? [
              dayjs(task.actualStart),
              task.actualEnd ? dayjs(task.actualEnd) : null,
            ]
          : [null, null],
        plannedEffortHours: task.plannedEffortHours ?? null,
        actualEffortHours: task.actualEffortHours ?? null,
        plannedEffortDays: task.plannedEffortDays ?? null,
        actualEffortDays: task.actualEffortDays ?? null,
        progress: task.progress,
        status: task.status ?? "todo",
        assigneeIds: task.assigneeIds,
        levels: task.levels ?? [],
        description: task.description ?? "",
        projectId: task.projectId,
        parentId: task.parentId,
        roadmapVisible: task.roadmapVisible ?? false,
        roadmapLane: task.roadmapLane ?? null,
        milestoneColor: task.milestoneColor ?? null,
      });
    } else {
      form.setFieldsValue({
        name: "",
        type: "task",
        // 新建默认：今天 → 3 天后（纯日期）
        range: [dayjs().startOf("day"), dayjs().add(3, "day").startOf("day")],
        actualRange: [null, null],
        plannedEffortHours: null,
        actualEffortHours: null,
        plannedEffortDays: null,
        actualEffortDays: null,
        progress: 0,
        status: "todo",
        assigneeIds: [],
        levels: [],
        description: "",
        roadmapVisible: false,
        roadmapLane: null,
        milestoneColor: null,
      });
    }
    prevType.current = task?.type ?? "task";
  }, [open, task, form]);

  // 新建时切换 type 到 milestone：默认套今天（单一日期）；
  // 从 milestone 切回普通/汇总：恢复 今天→3 天后 默认区间。仅新建生效。
  useEffect(() => {
    if (!open || task || !type) return;
    const prev = prevType.current;
    if (type === prev) return;
    if (type === "milestone") {
      const ms = dayjs().startOf("day");
      form.setFieldValue("range", [ms, ms]);
    } else if (prev === "milestone") {
      form.setFieldValue("range", [
        dayjs().startOf("day"),
        dayjs().add(3, "day").startOf("day"),
      ]);
    }
    prevType.current = type;
  }, [open, task, type, form]);

  // 切到「其他项目」时拉取目标项目任务（父级下拉用）；本项目用 currentProjectTasks
  useEffect(() => {
    if (!open || !task) return;
    if (!selectedProjectId || selectedProjectId === task.projectId) {
      setOtherTasks([]);
      return;
    }
    let alive = true;
    listTasks(selectedProjectId)
      .then((ts) => {
        if (alive) setOtherTasks(ts);
      })
      .catch(() => {
        if (alive) setOtherTasks([]);
      });
    return () => {
      alive = false;
    };
  }, [open, task, selectedProjectId]);

  // 所属项目下拉：按客户分组
  const projectOptions = useMemo(() => {
    if (!projects?.length) return [];
    const byCustomer = new Map<string, { value: string; label: string }[]>();
    for (const p of projects) {
      const arr = byCustomer.get(p.customerId) ?? [];
      arr.push({ value: p.id, label: p.name });
      byCustomer.set(p.customerId, arr);
    }
    return [...byCustomer.entries()].map(([cid, opts]) => ({
      label: customerMap?.[cid]?.name ?? "—",
      title: customerMap?.[cid]?.name ?? "—",
      options: opts,
    }));
  }, [projects, customerMap]);

  // 上位タスク（親フェーズ）下拉：所选项目的 summary 任务；同项目时排除自身子树
  const parentOptions = useMemo(() => {
    if (!task) return [];
    const sameProject =
      !selectedProjectId || selectedProjectId === task.projectId;
    const pool = sameProject ? currentProjectTasks ?? [] : otherTasks;
    const excluded = sameProject
      ? subtreeIds(task.id, currentProjectTasks ?? [])
      : new Set<string>();
    return pool
      .filter((p) => p.type === "summary" && !excluded.has(p.id))
      .map((p) => ({ value: p.id, label: p.name }));
  }, [task, selectedProjectId, currentProjectTasks, otherTasks]);

  // 期间约束：予定期間（计划起止）必须落在所属项目的周期内
  // 所属项目 = 编辑时所选项目 ?? 任务原项目 ?? 当前 Gantt 页项目
  const boundProject = useMemo(() => {
    const pid = selectedProjectId ?? task?.projectId ?? activeProject?.id;
    return projects?.find((p) => p.id === pid) ?? activeProject;
  }, [projects, selectedProjectId, task, activeProject]);

  const disabledDate = (d: Dayjs) => {
    if (!boundProject || !d) return false;
    return (
      d.isBefore(dayjs(boundProject.start), "day") ||
      d.isAfter(dayjs(boundProject.end), "day")
    );
  };

  const submit = async () => {
    const v = await form.validateFields();
    // summary（フェーズ）で期間未入力の場合、後端 NOT NULL を満たすため
    // 所属プロジェクトの期間（無ければ当日）で暫定補完する。子タスク追加後は rollup で上書きされる。
    if (v.type === "summary" && (!v.range?.[0] || !v.range?.[1])) {
      const s = boundProject ? dayjs(boundProject.start) : dayjs();
      const e = boundProject ? dayjs(boundProject.end) : dayjs();
      v.range = [s, e];
    }
    onSubmit(v);
  };

  const isMilestone = type === "milestone";
  const isSummary = type === "summary";
  // summary（フェーズ）で子タスクを持つ場合、期間・進捗・実績は子から自動集計され
  // 直接編集しても rollup で上書きされるため read-only にする（保存されないように見える混乱を防止）
  const hasChildren =
    !!task && (currentProjectTasks ?? []).some((c) => c.parentId === task.id);
  const isDerived = type === "summary" && hasChildren;

  // 工期プレビュー（手动 d/h 優先・否则 期間派生）：予定／実績を各々独立に即時算出し誤読を防ぐ。
  // - days != null → 手动 d/h：fmtDuration(effortFromDH(d,h)) + 「手動設定」badge。
  // - days == null → 期間（工作日数 D × hoursPerDay）派生：fmtDuration(effortMinutes(...)) + 「期間から自動」badge。
  // - 期間（s/e）が空＝下の 2 行ヒント＋[使う]も隠す（previewOf が null を返す条件と同じ）。
  const rangeW = Form.useWatch("range", form);
  const actualRangeW = Form.useWatch("actualRange", form);
  const plannedEffortHoursW = Form.useWatch("plannedEffortHours", form);
  const actualEffortHoursW = Form.useWatch("actualEffortHours", form);
  const plannedEffortDaysW = Form.useWatch("plannedEffortDays", form);
  const actualEffortDaysW = Form.useWatch("actualEffortDays", form);
  const previewOf = (
    s?: Dayjs | null,
    e?: Dayjs | null,
    hours?: number | null,
    days?: number | null
  ) => {
    if (isMilestone || isSummary) return null;
    // 手动设置：d/h 优先（days 非空 或 hours>0；即便期间为空也回示手动工期，与 effortOf 一致）
    const manual = isManualEffort(days, hours);
    if (!s || !e) {
      // 期间为空：仅在手动设置时回示工期（无法给期间派生提示/建议）
      if (!manual) return null;
      return {
        manual: true,
        dur: fmtDuration(effortFromDH(days ?? 0, hours ?? 0)),
        days: 0,
        derivedDur: "",
      };
    }
    const sIso = dayjs(s).format("YYYY-MM-DD");
    const eIso = dayjs(e).format("YYYY-MM-DD");
    const D = workingDays(sIso, eIso, holidays);
    const derivedDur = fmtDuration(
      effortMinutes(sIso, eIso, hours ?? 0, holidays)
    );
    return {
      manual,
      // 手动优先回示 d/h 工期；否则期间派生
      dur: manual
        ? fmtDuration(effortFromDH(days ?? 0, hours ?? 0))
        : derivedDur,
      days: D,
      derivedDur,
    };
  };
  const plannedPreview = useMemo(
    () =>
      previewOf(
        rangeW?.[0],
        rangeW?.[1],
        plannedEffortHoursW,
        plannedEffortDaysW
      ),
    [
      isMilestone,
      isSummary,
      rangeW,
      plannedEffortHoursW,
      plannedEffortDaysW,
      holidays,
    ]
  );
  const actualPreview = useMemo(
    () =>
      previewOf(
        actualRangeW?.[0],
        actualRangeW?.[1],
        actualEffortHoursW,
        actualEffortDaysW
      ),
    [
      isMilestone,
      isSummary,
      actualRangeW,
      actualEffortHoursW,
      actualEffortDaysW,
      holidays,
    ]
  );

  // 工期 Form.Item の extra（回示 badge + 2 本ヒント + [使う]）を生成。
  // which: 'planned' | 'actual'（[使う]が書き込む套を切替）。
  const renderEffortExtra = (
    which: "planned" | "actual",
    preview: ReturnType<typeof previewOf>
  ) => {
    if (!preview) return undefined;
    const daysField =
      which === "planned" ? "plannedEffortDays" : "actualEffortDays";
    const hoursField =
      which === "planned" ? "plannedEffortHours" : "actualEffortHours";
    // 回示 badge：手动 or 期間から自動（dur=派生工期）
    const badge = preview.manual
      ? t("projects.taskForm.effortManualBadge")
      : intl.formatMessage(
          { id: "projects.taskForm.effortAutoBadge" },
          { dur: preview.derivedDur }
        );
    // D（営業日数）。期間が空（preview.days===0 かつ手动 only）の場合はヒント/ボタンを隠す。
    const D = preview.days;
    const showHints = D > 0;
    // 換算単位（1営業日=何時間）。営業日＝人日を同一視 → 総工数（時間）= D × hpd。
    // 小数（7.5 等）でも桁溢れしないよう小数2桁に丸める。
    const hpd = getHoursPerDay();
    const totalH = Math.round(D * hpd * 100) / 100;
    return (
      <Space direction="vertical" size={2} style={{ width: "100%" }}>
        <span>
          {preview.dur}
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            {badge}
          </Typography.Text>
        </span>
        {showHints && (
          <span>
            {intl.formatMessage(
              { id: "projects.taskForm.effortHint" },
              { days: D, hours: totalH, hpd }
            )}
            <Typography.Link
              style={{ marginLeft: 8 }}
              onClick={() => {
                form.setFieldsValue({
                  [daysField]: D,
                  [hoursField]: 0,
                } as Partial<TaskFormValue>);
              }}
            >
              {t("projects.taskForm.effortUse")}
            </Typography.Link>
          </span>
        )}
      </Space>
    );
  };

  // 予定期間の検証ルール（milestone 単一日付 / 通常タスクの RangePicker で共用）
  const rangeRules = isDerived
    ? []
    : [
        ...(isSummary
          ? []
          : [
              {
                required: true,
                message: t("projects.taskForm.rangeRequired"),
              },
            ]),
        {
          validator: (_: unknown, value: [Dayjs, Dayjs] | undefined) => {
            if (!boundProject || !value?.[0] || !value?.[1]) {
              return Promise.resolve();
            }
            // 纯日期校验：end 不得早于 start
            if (value[1].isBefore(value[0])) {
              return Promise.reject(
                new Error(t("projects.taskForm.rangeRequired"))
              );
            }
            // 项目周期约束：start 当天 00:00、end 当天 23:59
            const start = dayjs(boundProject.start).startOf("day");
            const end = dayjs(boundProject.end).endOf("day");
            if (value[0].isBefore(start) || value[1].isAfter(end)) {
              return Promise.reject(
                new Error(
                  intl.formatMessage(
                    { id: "projects.taskForm.rangeOutOfProject" },
                    {
                      start: start.format("YYYY-MM-DD"),
                      end: end.format("YYYY-MM-DD"),
                    }
                  )
                )
              );
            }
            return Promise.resolve();
          },
        },
      ];

  return (
    <Drawer
      className="pm-task-drawer"
      title={
        task
          ? t("projects.taskForm.title.edit")
          : parentName
          ? intl.formatMessage(
              { id: "projects.taskForm.title.child" },
              { name: parentName }
            )
          : t("projects.taskForm.title.add")
      }
      open={open}
      onClose={onCancel}
      placement="right"
      width={task ? 1180 : 720}
      // 编辑态为左右双栏、内部各自滚动 → drawer body 不滚动、由内部列滚动；
      // 新建态为单栏表单 → body 默认滚动，底部给出 Cancel/Save 底栏（Drawer 无内置 OK 按钮）。
      styles={
        task
          ? {
              body: {
                display: "flex",
                flexDirection: "column",
                padding: "16px 24px",
                overflow: "hidden",
              },
            }
          : undefined
      }
      footer={
        task ? null : (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={onCancel}>{t("common.cancel")}</Button>
            <Button type="primary" onClick={submit}>
              {t("common.save")}
            </Button>
          </div>
        )
      }
      destroyOnHidden
    >
      <div className={task ? "pm-task-modal-body" : undefined}>
        <div className={task ? "pm-task-modal-left" : undefined}>
          <Form
            form={form}
            layout="vertical"
            className={task ? "pm-task-modal-form" : undefined}
            style={{ marginTop: 12 }}
          >
            <Form.Item
              name="name"
              label={t("projects.taskForm.name")}
              rules={[
                {
                  required: true,
                  message: t("projects.taskForm.nameRequired"),
                },
              ]}
            >
              <Input placeholder={t("projects.taskForm.namePlaceholder")} />
            </Form.Item>
            <Form.Item name="type" label={t("projects.taskForm.type")}>
              <Segmented
                options={[
                  { value: "task", label: t("projects.taskForm.type.task") },
                  {
                    value: "summary",
                    label: t("projects.taskForm.type.summary"),
                  },
                  {
                    value: "milestone",
                    label: t("projects.taskForm.type.milestone"),
                  },
                ]}
              />
            </Form.Item>
            {task && (
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="projectId"
                    label={t("projects.taskForm.project")}
                    tooltip={t("projects.taskForm.projectHint")}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder={t("projects.taskForm.projectPlaceholder")}
                      options={projectOptions}
                      onChange={() => form.setFieldValue("parentId", null)}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="parentId"
                    label={t("projects.taskForm.parent")}
                    tooltip={t("projects.taskForm.parentHint")}
                  >
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder={t("projects.taskForm.parentRoot")}
                      options={parentOptions}
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
            {isMilestone ? (
              <Form.Item
                name="range"
                label={t("projects.taskForm.milestoneDate")}
                rules={rangeRules}
                // milestone：表单值为单个 Dayjs（DatePicker），归一为 [v, v] 供 onSubmit
                getValueProps={(value: [Dayjs, Dayjs] | undefined) => ({
                  value: value?.[0] ?? null,
                })}
                normalize={(value: Dayjs | null) =>
                  value ? ([value, value] as [Dayjs, Dayjs]) : value
                }
              >
                <DatePicker
                  style={{ width: "100%" }}
                  format="YYYY-MM-DD"
                  disabledDate={disabledDate}
                />
              </Form.Item>
            ) : (
              <>
                {/* 期間：予定（左）／実績（右）を 2 列に並べ、対称関係を視認しやすく */}
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      name="range"
                      label={t("projects.taskForm.planRange")}
                      tooltip={
                        isDerived
                          ? t("projects.taskForm.derivedHint")
                          : isSummary
                          ? t("projects.taskForm.summaryRangeOptionalHint")
                          : undefined
                      }
                      extra={
                        isDerived
                          ? t("projects.taskForm.derivedHint")
                          : isSummary
                          ? t("projects.taskForm.summaryRangeOptionalHint")
                          : undefined
                      }
                      rules={rangeRules}
                    >
                      <DatePicker.RangePicker
                        style={{ width: "100%" }}
                        disabled={isDerived}
                        format="YYYY-MM-DD"
                        allowEmpty={isSummary ? [true, true] : undefined}
                        disabledDate={disabledDate}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      name="actualRange"
                      label={t("projects.taskForm.actualRange")}
                      tooltip={
                        isDerived
                          ? t("projects.taskForm.derivedHint")
                          : undefined
                      }
                      // 実績：開始日のみ＝着手中（進行中）は許容。ただし
                      // 終了だけ入力（開始なし）は無効、終了＜開始も無効。
                      rules={[
                        {
                          validator: (
                            _: unknown,
                            value: [Dayjs | null, Dayjs | null] | null
                          ) => {
                            const s = value?.[0] ?? null;
                            const e = value?.[1] ?? null;
                            if (!s && e) {
                              return Promise.reject(
                                new Error(
                                  t("projects.taskForm.actualStartRequired")
                                )
                              );
                            }
                            if (s && e && e.isBefore(s, "day")) {
                              return Promise.reject(
                                new Error(
                                  t("projects.taskForm.actualEndBeforeStart")
                                )
                              );
                            }
                            return Promise.resolve();
                          },
                        },
                      ]}
                    >
                      <DatePicker.RangePicker
                        style={{ width: "100%" }}
                        format="YYYY-MM-DD"
                        allowEmpty={[true, true]}
                        disabled={isDerived}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                {!isSummary && (
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        label={t("projects.taskForm.effortPlan")}
                        tooltip={t("projects.taskForm.effortTip")}
                        extra={renderEffortExtra("planned", plannedPreview)}
                      >
                        <Space.Compact>
                          <Form.Item name="plannedEffortDays" noStyle>
                            <InputNumber
                              min={0}
                              max={3650}
                              step={1}
                              precision={0}
                              style={{ width: 110 }}
                              placeholder="0"
                              addonAfter={t(
                                "projects.taskForm.effortDaysSuffix"
                              )}
                            />
                          </Form.Item>
                          <Form.Item name="plannedEffortHours" noStyle>
                            <InputNumber
                              min={0}
                              max={23.75}
                              step={0.25}
                              precision={2}
                              style={{ width: 120 }}
                              placeholder="0"
                              addonAfter={t("projects.taskForm.effortSuffix")}
                            />
                          </Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        label={t("projects.taskForm.effortActual")}
                        tooltip={t("projects.taskForm.effortTip")}
                        extra={renderEffortExtra("actual", actualPreview)}
                      >
                        <Space.Compact>
                          <Form.Item name="actualEffortDays" noStyle>
                            <InputNumber
                              min={0}
                              max={3650}
                              step={1}
                              precision={0}
                              style={{ width: 110 }}
                              placeholder="0"
                              addonAfter={t(
                                "projects.taskForm.effortDaysSuffix"
                              )}
                            />
                          </Form.Item>
                          <Form.Item name="actualEffortHours" noStyle>
                            <InputNumber
                              min={0}
                              max={23.75}
                              step={0.25}
                              precision={2}
                              style={{ width: 120 }}
                              placeholder="0"
                              addonAfter={t("projects.taskForm.effortSuffix")}
                            />
                          </Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                  </Row>
                )}
              </>
            )}
            {!isMilestone && (
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="progress"
                    label={t("projects.taskForm.progress")}
                    tooltip={
                      isDerived ? t("projects.taskForm.derivedHint") : undefined
                    }
                  >
                    <Slider min={0} max={100} step={5} disabled={isDerived} />
                  </Form.Item>
                </Col>
                {!isSummary && (
                  <Col span={12}>
                    <Form.Item
                      name="status"
                      label={t("projects.taskForm.status")}
                    >
                      <Select options={statusOptions} />
                    </Form.Item>
                  </Col>
                )}
              </Row>
            )}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="levels" label={t("projects.taskForm.levels")}>
                  <Select
                    mode="tags"
                    allowClear
                    placeholder={t("projects.taskForm.levelsPlaceholder")}
                    tokenSeparators={[",", "，", " "]}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="assigneeIds"
                  label={t("projects.taskForm.assignee")}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder={t("projects.taskForm.assigneePlaceholder")}
                    optionFilterProp="label"
                    options={members.map((m) => ({
                      value: m.id,
                      label: m.name,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="description"
              label={t("projects.taskForm.description")}
            >
              <RichTextEditor
                placeholder={t("projects.taskForm.descriptionPlaceholder")}
              />
            </Form.Item>

            <Collapse
              ghost
              size="small"
              style={{ marginBottom: 8 }}
              items={[
                {
                  key: "roadmap",
                  label: t("projects.taskForm.roadmap.panel"),
                  children: (
                    <>
                      <Form.Item
                        name="roadmapVisible"
                        label={t("projects.taskForm.roadmap.visible")}
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        name="roadmapLane"
                        label={t("projects.taskForm.roadmap.lane")}
                      >
                        <Select
                          allowClear
                          placeholder={t(
                            "projects.taskForm.roadmap.lanePlaceholder"
                          )}
                          options={laneOptions}
                        />
                      </Form.Item>
                      {isMilestone && (
                        <Form.Item
                          name="milestoneColor"
                          label={t("projects.taskForm.roadmap.milestoneColor")}
                        >
                          <Select
                            allowClear
                            placeholder={t(
                              "projects.taskForm.roadmap.milestoneColorPlaceholder"
                            )}
                            options={msColorOptions}
                          />
                        </Form.Item>
                      )}
                    </>
                  ),
                },
              ]}
            />
          </Form>
          {/* 编辑态：任务表单的操作按钮钉在左栏底部（不随表单滚动） */}
          {task && (
            <div className="pm-task-modal-footer">
              <Button onClick={onCancel}>{t("common.cancel")}</Button>
              <Button type="primary" onClick={submit}>
                {t("common.save")}
              </Button>
            </div>
          )}
        </div>
        {/* 右栏：仅编辑既有任务时展示。コメント / 設計(关联链接) / 資料(外部ドライブ) 等页签，均为独立于表单保存的即时 CRUD */}
        {task && (
          <div className="pm-task-modal-comments">
            <Tabs
              className="pm-task-modal-tabs"
              defaultActiveKey="comments"
              items={[
                {
                  key: "comments",
                  label: t("projects.comments.title"),
                  children: <TaskComments taskId={task.id} members={members} />,
                },
                {
                  key: "links",
                  label: t("projects.links.title"),
                  children: <TaskLinks taskId={task.id} />,
                },
                {
                  key: "mockups",
                  label: t("mockup.tab"),
                  children: <MockupPanel taskId={task.id} />,
                },
                {
                  key: "designs",
                  label: t("design.tab"),
                  children: (
                    <DesignTaskPanel
                      taskId={task.id}
                      projectId={task.projectId}
                    />
                  ),
                },
                ...(showDocs
                  ? [
                      {
                        key: "docs",
                        label: t("docs.title"),
                        children: (
                          <TaskDocs
                            taskId={task.id}
                            projectId={task.projectId}
                            tasks={
                              activeProject?.id === task.projectId
                                ? currentProjectTasks
                                : undefined
                            }
                          />
                        ),
                      },
                    ]
                  : []),
                {
                  key: "testcases",
                  label: t("quality.tab.cases"),
                  children: (
                    <TaskTestCases
                      taskId={task.id}
                      customerId={
                        projects?.find((p) => p.id === task.projectId)
                          ?.customerId
                      }
                    />
                  ),
                },
                {
                  key: "bugs",
                  label: t("quality.tab.bugs"),
                  children: (
                    <TaskBugs
                      taskId={task.id}
                      customerId={
                        projects?.find((p) => p.id === task.projectId)
                          ?.customerId
                      }
                    />
                  ),
                },
                {
                  key: "activity",
                  label: t("projects.activity.title"),
                  children: <TaskActivity taskId={task.id} members={members} />,
                },
              ]}
            />
          </div>
        )}
      </div>
    </Drawer>
  );
}

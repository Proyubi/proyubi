// ===== Proyubi 领域模型 =====
// 层级：Customer(客户/产品) → Project(版本/项目) → Task(WBS 任务树) → 指派给 Member
// 任务之间通过 Dependency 形成依赖（首版仅 FS：前序完成→后续开始）

export type ProjectStatus = "planned" | "active" | "done" | "paused";

export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  { label: string; i18nKey: string; color: string }
> = {
  planned: {
    label: "未开始",
    i18nKey: "projects.status.planned",
    color: "default",
  },
  active: {
    label: "进行中",
    i18nKey: "projects.status.active",
    color: "processing",
  },
  done: { label: "已交付", i18nKey: "projects.status.done", color: "success" },
  paused: {
    label: "已暂停",
    i18nKey: "projects.status.paused",
    color: "warning",
  },
};

// ===== 看板（Board）业务状态 =====
// progress（进度）之外的独立「业务状态」，供看板视图按列分组 + 拖拽流转。
export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "testing"
  | "done"
  | "cancelled";

/** 看板列顺序（从左到右） */
export const TASK_STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "testing",
  "done",
  "cancelled",
];

/** 各状态的展示元数据：i18n key + 圆点色（hex） */
export const TASK_STATUS_META: Record<
  TaskStatus,
  { i18nKey: string; color: string }
> = {
  backlog: { i18nKey: "projects.board.status.backlog", color: "#9ca3af" },
  todo: { i18nKey: "projects.board.status.todo", color: "#6b7280" },
  in_progress: {
    i18nKey: "projects.board.status.inProgress",
    color: "#f59e0b",
  },
  testing: { i18nKey: "projects.board.status.testing", color: "#8b5cf6" },
  done: { i18nKey: "projects.board.status.done", color: "#52c41a" },
  cancelled: { i18nKey: "projects.board.status.cancelled", color: "#d1d5db" },
};

export interface Member {
  id: string;
  name: string;
  /** 头像底色，同时用于甘特图按人着色 */
  color: string;
  role?: string;
}

/** 团队（租户内子团队 / platform_team）。FREE 单团队 / TRIAL·PRO 多团队 */
export interface Team {
  id: string;
  name: string;
  color?: string;
  isDefault: boolean;
  sortOrder: number;
  memberCount: number;
  /** 当前套餐是否允许继续新建团队（PRO/TRIAL=true，FREE=false） */
  canCreateMore: boolean;
}

export interface Customer {
  id: string;
  /** 例：東邦銀行 */
  name: string;
  shortName?: string;
  /** 有效/无效（无效=归档；默认 true） */
  active?: boolean;
  /** 归属团队（多团队隔离的根维度；项目从客户继承） */
  teamId?: string;
  /** 创建时间（后端 ISO 字符串） */
  createdAt?: string;
}

/**
 * 项目种别。
 * - `project` 通常项目：范围固定，进度＝任务工期加权汇总，列表显示进度条
 * - `ops` 运维・保守：范围滚动（任务随时追加），终了日可为空＝継続中。
 *   进度率对这种项目是锯齿波（分母一直在长），故列表改显示「今月 N/M 件完了 / 未完了 M件」
 */
export type ProjectKind = "project" | "ops";

export const PROJECT_KIND_META: Record<
  ProjectKind,
  { i18nKey: string; descKey: string }
> = {
  project: {
    i18nKey: "projects.kind.project",
    descKey: "projects.kind.projectDesc",
  },
  ops: { i18nKey: "projects.kind.ops", descKey: "projects.kind.opsDesc" },
};

export interface Project {
  id: string;
  customerId: string;
  /** 例：v1.4.0 */
  name: string;
  description?: string;
  status: ProjectStatus;
  /** 种别（既存データは未設定＝通常项目扱い） */
  kind?: ProjectKind;
  /** ISO date: YYYY-MM-DD */
  start: string;
  /** ISO date: YYYY-MM-DD；null=終了日未定（継続中）。kind='ops' のみ null になりうる */
  end: string | null;
  /** 0-100，列表展示用（由任务汇总，存一份避免每次重算） */
  progress: number;
  /** 総工期・予定合計（分）：後端が全タスクから集計して返す。甘特 footer 表示用（前端で再計算しない）。 */
  plannedTotalMinutes?: number | null;
  /** 総工期・実績合計（分）：後端集計。着手中(開始のみ)の手動工期も含む。 */
  actualTotalMinutes?: number | null;
  /** 同客户内手动拖动排序序号（升序，越小越靠前） */
  sortOrder?: number;
  /** 归属团队（从所属客户继承） */
  teamId?: string;
  // ===== 以下は kind='ops' のときだけ後端が詰める運用指標（非永続・レスポンス時集計） =====
  /** 未完了の葉タスク件数（全期間）＝滞留件数 */
  openTaskCount?: number | null;
  /** 予定終了日が当月の葉タスク件数 */
  monthTotalCount?: number | null;
  /** うち完了済み件数 */
  monthDoneCount?: number | null;
  /** 今月の消化工数・実績（分）。件数と同じ母集団＝予定終了日が当月の葉タスク */
  monthActualMinutes?: number | null;
  /** 今月の予定工数（分）。実績が未入力の間の見込みとして併記する */
  monthPlannedMinutes?: number | null;
  /**
   * 月次工数枠（分）。保守契約の「月◯人日まで」。null=枠なし。
   * これだけは永続（他の運用指標はレスポンス時集計）。
   */
  monthlyQuotaMinutes?: number | null;
}

export type TaskType = "task" | "summary" | "milestone";

export interface Task {
  id: string;
  projectId: string;
  /** 根任务为 null，构成树 */
  parentId: string | null;
  name: string;
  /** 计划开始（ISO date: YYYY-MM-DD；milestone 时 start === end） */
  start: string;
  /** 计划结束（ISO date: YYYY-MM-DD，闭区间含尾日） */
  end: string;
  /** 实际开始（ISO date: YYYY-MM-DD；可空，未填为 null） */
  actualStart?: string | null;
  /** 实际结束（ISO date: YYYY-MM-DD；可空） */
  actualEnd?: string | null;
  /**
   * 予定工期·小时（手填，0–23.75，可小数 0.25 步进）。与同套 plannedEffortDays 组成手动 d/h：
   * days 非空 **或** 本字段 > 0 即「该套手动」→ 工期 = days×1営業日の時間数 + hours*60min（见 `isManualEffort`/`effortFor`）。
   * 仅当 days 空且本字段空/0 时才回退按予定期间派生（effortMinutes，D×1営業日の時間数）。仅叶子有意义；summary/milestone 不用。
   */
  plannedEffortHours?: number | null;
  /**
   * 実績工期·小时（手填，0–23.75，可小数 0.25 步进）。与同套 actualEffortDays 组成手动 d/h，口径同 plannedEffortHours；
   * 仅当实绩两端齐全时参与工期计算。
   */
  actualEffortHours?: number | null;
  /**
   * 予定工期·日数（手动，1営業日=租户设置の時間数，既定8h）。与同套 plannedEffortHours 组成手动 d/h；
   * days 非空或 hours>0 即手动优先（见 `isManualEffort`），否则回退按予定期间派生（effortMinutes）。
   * 工期 = days×1営業日の時間数 + plannedEffortHours*60min。仅叶子有意义；summary/milestone 不用。
   */
  plannedEffortDays?: number | null;
  /**
   * 実績工期·日数（手动，1営業日=租户设置の時間数，既定8h）。与同套 actualEffortHours 组成手动 d/h；
   * days 非空或 hours>0 即手动优先，否则回退按实绩期间派生。両端齐全才参与。
   */
  actualEffortDays?: number | null;
  /**
   * 仅 summary 汇总用：阶段已开始但尚未全部完成（部分子叶未着手/未完成）。
   * 此时 actualEnd 不确定，实际条画到「今天」并以未闭合（虚线）样式呈现。
   */
  actualOngoing?: boolean;
  /** 0-100：叶子为权威值；summary 由子节点按工期加权汇总 */
  progress: number;
  /** 指派成员（首版"一天一项目"，指派直接挂叶子任务上） */
  assigneeIds: string[];
  /** レベル：自由标签（一个任务可多个） */
  levels: string[];
  /** 任务描述（富文本 HTML，可含 img 贴图） */
  description?: string;
  type: TaskType;
  /** 是否折叠子节点（仅 summary 有意义） */
  collapsed?: boolean;
  /** 同级排序 */
  order: number;
  // ===== 路线图（導入スケジュール）设置 =====
  /** 是否在路线图视图展示该任务 */
  roadmapVisible?: boolean;
  /** 路线图泳道 option_key（空=默认泳道；可自定义，见 RoadmapOption） */
  roadmapLane?: string | null;
  /** 里程碑颜色 option_key（仅 milestone 有意义；可自定义） */
  milestoneColor?: string | null;
  /** 看板业务状态（独立于 progress；缺省 'todo'） */
  status?: TaskStatus;
}

// ===== 路线图（導入スケジュール）领域模型 =====

/** 路线图可自定义字典的用途 */
export type RoadmapOptionKind = "lane" | "ms_color";

/**
 * 路线图可自定义字典项（管理实体，对应后端 pm_roadmap_option）。
 * 泳道(lane)/里程碑色(ms_color)由租户自定义，取代写死枚举。
 * 「作業区分(貴社/弊社)」已废弃：颜色并入泳道。
 */
export interface RoadmapOption {
  id: string;
  kind: RoadmapOptionKind;
  /** 稳定 key，pm_task.roadmapLane / milestoneColor 引用此值 */
  optionKey: string;
  label: string;
  /** #RRGGBB：泳道阶段条 / 里程碑菱形颜色（milestone 泳道可空） */
  color?: string | null;
  /** 升序，越小越靠前 */
  sortOrder: number;
  /** 系统内置项（不可删，可改色/名/排序） */
  isSystem: boolean;
}

/**
 * 节假日（红日子 / 祝日）。租户级、跨项目共享；工期按工作日计算时排除「周末 + 这些日期」。
 * 对应后端 pm_holiday。national/振替/国民の休日 由 holidays-jp 同步，亦可手动增删改。
 */
export interface Holiday {
  id: string;
  /** 节假日日期（ISO YYYY-MM-DD） */
  holidayDate: string;
  /** 名称（祝日名） */
  name: string;
  /** 区域：首版仅 JP */
  region: string;
  /** 来源：holidays_jp / cabinet / manual */
  source: string;
  /** true=人工维护，定时同步不覆盖 */
  isManual: boolean;
}

/** 路线图渲染用字典定义（getRoadmap 返回，已按 sortOrder 排序） */
export interface RoadmapOptionDef {
  key: string;
  label: string;
  color?: string | null;
  sortOrder: number;
}

/** 路线图条目（后端 rollup 汇总后的只读视图） */
export interface RoadmapItem {
  id: string;
  name: string;
  /** summary=阶段箭头色块；milestone=▼ 标记 */
  type: "summary" | "milestone";
  /** ISO date：YYYY-MM-DD（milestone 时 start === end） */
  start: string;
  end: string;
  /** 0-100 */
  progress: number;
  /** 泳道 option_key（null=默认泳道；着色取该泳道的 color） */
  roadmapLane?: string | null;
  /** 里程碑颜色 option_key */
  milestoneColor?: string | null;
}

/** GET /app/pm/projects/{id}/roadmap 响应 */
export interface PmRoadmapVO {
  projectId: string;
  /** 项目周期：YYYY-MM-DD */
  projectStart: string;
  projectEnd: string;
  items: RoadmapItem[];
  /** 租户级泳道/里程碑色字典（顺序+颜色+标签），供数据驱动渲染 */
  options?: {
    lanes: RoadmapOptionDef[];
    msColors: RoadmapOptionDef[];
  };
}

// ===== 成员视图 / 资源视图（リソース）领域模型 =====

/**
 * 工时条目（GET /app/pm/workload 响应项）。
 * 后端返回所有「有指派」的任务（含 summary / milestone），前端按需过滤：
 * 叶子 type==='task' 画甘特条，milestone 作为点标记，summary 一般忽略。
 */
export interface WorkloadItem {
  taskId: string;
  name: string;
  type: TaskType;
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  /** 指派成员（pm_member id 字符串） */
  assigneeIds: string[];
  /** 计划起止：YYYY-MM-DD（可能为 null） */
  start: string | null;
  end: string | null;
  /** 0-100 */
  progress: number;
  /** 实际起止：YYYY-MM-DD（可能为 null） */
  actualStart: string | null;
  actualEnd: string | null;
  /** 予定工期（分）：后端按予定套算出（milestone=0），与甘特 footer 同口径。工時実績サマリー集计用 */
  plannedMinutes?: number | null;
  /** 実績工期（分）：后端按实绩套算出（未着手=0，含着手中手动工期）。工時実績サマリー集计用 */
  actualMinutes?: number | null;
}

// ===== 俯瞰页（Overview）领域模型 =====

/** 风险种别（与后端 PmOverviewService / utils/risk.ts 对齐） */
export type RiskKind =
  | "overdue"
  | "behind"
  | "blocked"
  | "due-soon"
  | "unassigned";

export interface OverviewKpis {
  activeProjects: number;
  delayedProjects: number;
  delayedTasks: number;
  dueSoon: number;
  unassigned: number;
  blocked: number;
  /** 进行中任务数（叶子任务：已着手且未完成） */
  inProgressTasks: number;
  /** 本周任务总数（期日落在本周内的叶子任务） */
  weekTaskTotal: number;
  /** 本周已完成任务数 */
  weekTaskDone: number;
}

/** 风险一览的一行 */
export interface OverviewRiskItem {
  taskId: string;
  name: string;
  type: TaskType;
  projectId: string | null;
  projectName: string | null;
  customerId: string | null;
  customerName: string | null;
  assigneeIds: string[];
  /** ISO date: YYYY-MM-DD（风险判定后端按天） */
  start: string | null;
  end: string | null;
  progress: number;
  risks: RiskKind[];
  primary: RiskKind;
  overdueDays: number;
  daysUntilDue: number | null;
}

/** 项目健康 */
export interface OverviewProjectHealth {
  projectId: string;
  name: string;
  customerName: string | null;
  status: ProjectStatus;
  start: string | null;
  end: string | null;
  progress: number;
  delay: number;
  overdue: boolean;
}

/** 近期里程碑 */
export interface OverviewMilestone {
  taskId: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  end: string;
  /** 距今天数：>=0 未到，<0 已超期 */
  diff: number;
  progress: number;
}

/** マイタスクの期日グループ（サーバ側で判定） */
export type MyTaskBucket = "overdue" | "today" | "week" | "later";

/** マイタスクの一行（scope=me のみ） */
export interface OverviewMyTask {
  taskId: string;
  name: string;
  type: TaskType;
  projectId: string | null;
  projectName: string | null;
  customerName: string | null;
  start: string | null;
  end: string | null;
  progress: number;
  bucket: MyTaskBucket;
  /** 期日までの日数：<0 超過、null=期日なし */
  daysToDue: number | null;
  risks: RiskKind[];
}

/** マイバグの一行（scope=me のみ、未完了のみ） */
export interface OverviewMyBug {
  id: string;
  customerId: string;
  customerName: string;
  seq: number | null;
  bugNo: string | null;
  title: string;
  severity: QcPriority;
  status: BugStatus;
  /** 起票日 YYYY-MM-DD */
  reportedOn: string | null;
}

/** 担当者别任务计数（全社·已分配叶子任务） */
export interface OverviewAssigneeCount {
  memberId: string;
  taskCount: number;
}

/** GET /app/pm/overview 响应 */
export interface PmOverviewVO {
  /** 当前登录用户对应的成员 id（未绑定为 null） */
  meMemberId: string | null;
  kpis: OverviewKpis;
  riskItems: OverviewRiskItem[];
  projectHealth: OverviewProjectHealth[];
  milestones: OverviewMilestone[];
  /** 担当者别任务分布（已分配，按成员计数）；饼图用 */
  assigneeDistribution: OverviewAssigneeCount[];
  /** 未分配叶子任务总数（与 assigneeDistribution 同口径）；饼图「未割当」片用 */
  unassignedTaskCount: number;
  /** 本人担当の未完了タスク（scope=me のみ、all は空） */
  myTasks: OverviewMyTask[];
  /** 本人担当の未完了バグ（scope=me のみ、all は空） */
  myBugs: OverviewMyBug[];
}

// ===== 日历页（Calendar）领域模型 =====

/** 日历上的一条已排期叶子任务（GET /app/pm/calendar 响应项） */
export interface CalendarTask {
  taskId: string;
  name: string;
  /** ISO date: YYYY-MM-DD */
  start: string;
  end: string;
  /** 0-100 */
  progress: number;
  projectId: string;
  projectName: string;
  /** 指派成员（pm_member id 字符串） */
  assigneeIds: string[];
  /** 命中风险种别（服务端给，按优先级排序，可空）；前端只取色不重算 */
  riskKinds: RiskKind[];
}

/** GET /app/pm/calendar 响应 */
export interface PmCalendarVO {
  /** 当前登录用户对应的成员 id（未绑定为 null） */
  meMemberId: string | null;
  tasks: CalendarTask[];
}

// ===== 事件 / 会议日程（Event；嵌入 /calendar，独立于 pm_task） =====

/** 事件种别（5 种）：会议 / 评审 / 里程碑 / 截止 / 其他 */
export type PmEventType =
  | "meeting"
  | "review"
  | "milestone"
  | "deadline"
  | "other";

/** 事件（对应后端 pm_event）。VO 形状与本接口一致，前端直接用本接口接响应。 */
export interface PmEvent {
  id: string;
  title: string;
  type: PmEventType;
  /** ISO datetime: YYYY-MM-DDTHH:mm（all_day=true 时取当天 00:00） */
  startAt: string;
  /** ISO datetime；可空（单点事件） */
  endAt: string | null;
  allDay: boolean;
  /** 可挂项目（团队可见性维度）；null=全局事件 */
  projectId: string | null;
  projectName: string | null;
  /** 可选关联任务（仅跳转线索） */
  taskId: string | null;
  /** 参加者 pm_member id 字符串数组 */
  attendeeIds: string[];
  location: string | null;
  note: string | null;
}

/** 新建 / 更新事件入参（POST/PUT /app/pm/events） */
export interface EventReq {
  title: string;
  type: PmEventType;
  /** ISO datetime */
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  projectId?: string | null;
  taskId?: string | null;
  attendeeIds?: string[];
  location?: string | null;
  note?: string | null;
}

/**
 * 任务评论（对应后端 pm_comment）。挂在某个 Task 上，构成留言/讨论流。
 * mine 由服务端按发帖人判定，前端据此决定是否显示「编辑/删除」入口。
 */
export interface TaskComment {
  id: string;
  taskId: string;
  /** 发帖人租户用户 id（鉴权权威字段） */
  authorUserId: string;
  /** 发帖人 PM 成员 id（头像底色用）；未绑定成员为 null */
  authorMemberId: string | null;
  /** 发帖人显示名快照 */
  authorName: string;
  /** 正文（纯文本，保留换行） */
  content: string;
  /** ISO datetime */
  createdAt: string;
  updatedAt: string;
  /** 是否当前登录用户本人发的 */
  mine: boolean;
}

/**
 * 任务关联链接（对应后端 pm_task_link）。挂在某个 Task 上，指向外部资料。
 * 首版主打 Figma 设计稿：kind==='figma' 时前端用 iframe 内联预览，其余渲染为可点链接卡片。
 * kind 由后端按 url 域名判定（前端不可信）；链接是任务共享上下文，任意成员可删除。
 */
export interface TaskLink {
  id: string;
  taskId: string;
  /** figma | link | image（后端判定） */
  kind: "figma" | "link" | "image" | string;
  url: string;
  /** 用户备注名（可空；空则前端显示域名） */
  title?: string | null;
  /** 添加人租户用户 id（审计用） */
  createdBy: string;
  /** ISO datetime */
  createdAt: string;
}

/**
 * 资料（对应后端 pm_doc）。文件本体在外部网盘（Google ドライブ / SharePoint / Box…），
 * PM 只存链接 + 对应关系（顧客 / 案件 / タスク）。provider / kind / previewUrl 由后端按 URL 判定，前端不可信。
 * 设计：doc/design/pm-drive-docs.md
 */
export type DocProvider = "google" | "microsoft" | "box" | "other";
export type DocKind =
  | "gdoc"
  | "gsheet"
  | "gslide"
  | "gfile"
  | "gfolder"
  | "ms"
  | "box"
  | "link";

export interface PmDocTaskRef {
  taskId: string;
  taskName: string;
}

export interface PmDoc {
  id: string;
  customerId: string;
  /** null = 顧客共通 */
  projectId: string | null;
  projectName: string | null;
  url: string;
  provider: DocProvider | string;
  kind: DocKind | string;
  externalId: string | null;
  /** 官方嵌入 URL（iframe 用）；null = 不可预览，只显示链接卡片 */
  previewUrl: string | null;
  /** 显示名（可空；空则前端从 URL 推断） */
  title: string | null;
  /** 根文件夹（顧客ルート / 案件フォルダ） */
  isRoot: boolean;
  /** Google Picker で選んだ時の mimeType（URL 貼り付けは null）。種類アイコンはこれを優先 */
  mimeType: string | null;
  tasks: PmDocTaskRef[];
  createdBy: string;
  createdByName: string | null;
  /** ISO datetime */
  createdAt: string;
}

export interface CreateDocReq {
  customerId?: string;
  /** 优先于 customerId（customerId 由后端从案件取） */
  projectId?: string;
  url: string;
  title?: string;
  /** 需要 projectId；每个任务须属于该案件 */
  taskIds?: string[];
  isRoot?: boolean;
  /** Google Picker の mimeType（任意） */
  mimeType?: string;
}

/** POST /docs/batch の 1 件（Google Picker で選んだファイル）。 */
export interface BatchDocItem {
  url: string;
  title?: string;
  mimeType?: string;
}

/** POST /docs/batch：scope / taskIds の規則は CreateDocReq と同じ（isRoot は不可）。items は 1..50 件 */
export interface BatchCreateDocReq {
  customerId?: string;
  projectId?: string;
  taskIds?: string[];
  items: BatchDocItem[];
}

/** GET /docs/picker-config。clientId / apiKey / appId のどれかが空なら enabled=false で他は null */
export interface DocPickerConfig {
  enabled: boolean;
  clientId: string | null;
  apiKey: string | null;
  appId: string | null;
}

export interface UpdateDocReq {
  title?: string;
  /** 非 null 时整体替换任务对应关系 */
  taskIds?: string[];
}

/**
 * タスク操作履歴 1 件（对应后端 pm_task_activity）。
 * 1 回の保存＝1 件で、同時に変わったフィールドは changes に畳み込まれている
 * （「保存を押した回数」＝履歴の件数）。追記専用なので編集/削除は無い。
 */
export interface TaskActivity {
  id: string;
  taskId: string;
  /** 操作者の PM 成员 id（头像底色用）；未绑定为 null */
  actorMemberId: string | null;
  /** 操作者显示名快照（成员改名/删除后仍正确） */
  actorName: string;
  action: TaskActivityAction;
  /** 操作元：web=画面 / mcp=内部 API・自動連携（web は無印表示） */
  source: "web" | "mcp" | string;
  /** ISO datetime */
  createdAt: string;
  changes: TaskActivityChange[];
}

export type TaskActivityAction =
  | "created"
  | "updated"
  | "child_added"
  | "child_removed"
  | "dep_added"
  | "dep_removed";

/**
 * 差分 1 行。単値フィールドは from/to、集合フィールド
 * （担当者・ラベル・サブタスク・依存）は added/removed を使う。
 * 値は表示用スナップショット文字列 or コード（status/type 等はフロントでラベル化）。
 */
export interface TaskActivityChange {
  field: TaskActivityField | string;
  /** 変更前（単値フィールドのみ；空文字＝未設定） */
  from?: string | null;
  /** 変更後（単値フィールドのみ；空文字＝クリア） */
  to?: string | null;
  /** 追加された要素（集合フィールドのみ） */
  added?: string[] | null;
  /** 削除された要素（集合フィールドのみ） */
  removed?: string[] | null;
}

/** 差分に現れるフィールドキー（後端 PmTaskActivityService.diff と対で保守する） */
export type TaskActivityField =
  | "name"
  | "type"
  | "status"
  | "progress"
  | "planRange"
  | "actualRange"
  | "plannedEffort"
  | "actualEffort"
  | "assignees"
  | "levels"
  | "description"
  | "parent"
  | "project"
  | "roadmapVisible"
  | "roadmapLane"
  | "ownerParty"
  | "milestoneColor"
  | "subtask"
  | "predecessor"
  | "successor";

/** 操作履歴のフィルタ分類。フィールドキー → グループ（画面の絞り込みと集計に使う） */
export const TASK_ACTIVITY_GROUP: Record<string, TaskActivityGroup> = {
  status: "progress",
  progress: "progress",
  planRange: "schedule",
  actualRange: "schedule",
  plannedEffort: "schedule",
  actualEffort: "schedule",
  assignees: "people",
  levels: "people",
};

export type TaskActivityGroup = "progress" | "schedule" | "people" | "other";

export interface Dependency {
  id: string;
  projectId: string;
  /** 前序任务 */
  predecessorId: string;
  /** 后续任务 */
  successorId: string;
  /** 首版仅 Finish-to-Start */
  type: "FS";
  /** 延迟天数，可选 */
  lag?: number;
}

// ===== 思维导图（Mind Map）领域模型 =====
// 独立文档（对标 ProcessOn 思维导图）：一张导图 = 节点树，整棵存后端 jsonb。
// v1 不做实时协同：保存采用 version 乐观锁。

/** 思维导图节点（递归树；children 顺序即展示顺序） */
export interface MindNode {
  /** 单图内唯一（前端生成短 id；根固定 'root'） */
  id: string;
  text: string;
  /** 备注（可空） */
  note?: string;
  /** 节点强调色 #RRGGBB（空=用主题默认） */
  color?: string | null;
  /** 是否折叠子树（有 children 时有意义） */
  collapsed?: boolean;
  children: MindNode[];
}

/** 内置主题 key */
export type MindMapTheme = "classic" | "dark" | "forest" | "sunset";

export const MIND_MAP_THEMES: MindMapTheme[] = [
  "classic",
  "dark",
  "forest",
  "sunset",
];

/** 列表项摘要（不含 content） */
export interface MindMapSummary {
  id: string;
  name: string;
  /** 关联项目（可空） */
  projectId: string | null;
  theme: MindMapTheme;
  version: number;
  /** ISO datetime */
  updatedAt: string;
  createdAt: string;
}

/** 单图完整内容（含节点树 + 乐观锁版本） */
export interface MindMap extends MindMapSummary {
  root: MindNode;
}

// ===== 品質管理（Quality Management）领域模型 =====
// 层级：Project(版本) → TestSuite(スイート/= Excel シート) → TestCase(ケース/= 行)
// Bug は失敗ケース起票 or 単独起票。TestCase / Bug ともに Task へ紐付け可能（単一 task_id）。

/** 区分：正常系 / 異常系 / 境界値 */
export type TestCategory = "normal" | "abnormal" | "boundary";
/** 実施結果：null=未実施 / OK / NG / 対象外 */
export type TestResult = "pass" | "fail" | "na";
/** 優先度・影響度（テストケース / バグ共通の3段） */
export type QcPriority = "high" | "medium" | "low";
/** バグ状態 */
export type BugStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "verifying"
  | "closed"
  | "wontfix";

export const TEST_CATEGORY_META: Record<
  TestCategory,
  { i18nKey: string; color: string }
> = {
  normal: { i18nKey: "quality.category.normal", color: "blue" },
  abnormal: { i18nKey: "quality.category.abnormal", color: "orange" },
  boundary: { i18nKey: "quality.category.boundary", color: "purple" },
};

/** 実施結果メタ（null=未実施は key 'untested' で参照） */
export const TEST_RESULT_META: Record<
  TestResult | "untested",
  { i18nKey: string; color: string }
> = {
  pass: { i18nKey: "quality.result.pass", color: "#52c41a" },
  fail: { i18nKey: "quality.result.fail", color: "#f5222d" },
  na: { i18nKey: "quality.result.na", color: "#9ca3af" },
  untested: { i18nKey: "quality.result.untested", color: "#d1d5db" },
};

export const QC_PRIORITY_META: Record<
  QcPriority,
  { i18nKey: string; color: string }
> = {
  high: { i18nKey: "quality.priority.high", color: "#f5222d" },
  medium: { i18nKey: "quality.priority.medium", color: "#faad14" },
  low: { i18nKey: "quality.priority.low", color: "#9ca3af" },
};

/** 影響度メタ（優先度と同じ3段だがラベルは「影響度」系） */
export const BUG_SEVERITY_META: Record<
  QcPriority,
  { i18nKey: string; color: string }
> = {
  high: { i18nKey: "quality.severity.high", color: "#f5222d" },
  medium: { i18nKey: "quality.severity.medium", color: "#faad14" },
  low: { i18nKey: "quality.severity.low", color: "#9ca3af" },
};

export const BUG_STATUS_META: Record<
  BugStatus,
  { i18nKey: string; color: string }
> = {
  // 未対応＝一番目立たせたい状態なので青、完了系は灰で沈める。
  // 一覧では文字色＋12% 背景のピルに使うため、白地で読める濃さにしてある。
  open: { i18nKey: "quality.bugStatus.open", color: "#1677ff" },
  in_progress: { i18nKey: "quality.bugStatus.inProgress", color: "#d97706" },
  resolved: { i18nKey: "quality.bugStatus.resolved", color: "#389e0d" },
  verifying: { i18nKey: "quality.bugStatus.verifying", color: "#7c3aed" },
  closed: { i18nKey: "quality.bugStatus.closed", color: "#8c8c8c" },
  wontfix: { i18nKey: "quality.bugStatus.wontfix", color: "#a3a3a3" },
};

export const BUG_STATUS_ORDER: BugStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "verifying",
  "closed",
  "wontfix",
];

/** テストスイート（= Excel の1シート） */
export interface TestSuite {
  id: string;
  customerId: string;
  /** 紐付けタスク（pm_task.id；null=未紐付け）。スイート⇄タスクの任意関連 */
  taskId?: string | null;
  /** 採番接頭辞（例 STU）；case_no = prefix + '-' + 連番 */
  casePrefix?: string | null;
  name: string;
  description?: string | null;
  sortOrder: number;
}

/** テストケース（= Excel の1行；最新実施結果を保持） */
export interface TestCase {
  id: string;
  customerId: string;
  suiteId: string;
  seq: number;
  caseNo: string;
  featureMajor?: string | null;
  featureMinor?: string | null;
  /** テスト観点/項目 */
  title: string;
  category: TestCategory;
  priority: QcPriority;
  precondition?: string | null;
  steps?: string | null;
  testData?: string | null;
  expected?: string | null;
  /** null=未実施 */
  result: TestResult | null;
  /** ISO datetime */
  executedAt?: string | null;
  executedBy?: string | null;
  executedByName?: string | null;
  remark?: string | null;
  sortOrder: number;
}

/** バグ票 */
export interface Bug {
  id: string;
  customerId: string;
  seq: number;
  bugNo: string;
  title: string;
  description?: string | null;
  severity: QcPriority;
  priority: QcPriority;
  status: BugStatus;
  reopenCount: number;
  /** 環境の表示スナップショット（マスタ選択時は合成ラベル、旧・自由入力も保持） */
  environment?: string | null;
  /** 環境マスタ参照（pm_environment.id；null=未選択 or 旧・自由入力） */
  environmentId?: string | null;
  /** 担当 pm_member.id */
  assigneeMemberId?: string | null;
  assigneeName?: string | null;
  reporterUserId: string;
  reporterName?: string | null;
  /** 任意紐付けプロジェクト/版本（pm_project.id；null=製品全体） */
  projectId?: string | null;
  /** 紐付けタスク（pm_task.id） */
  taskId?: string | null;
  /** 発生元ケース（pm_test_case.id；単独起票時 null） */
  testCaseId?: string | null;
  /** 起票日（業務上の起票日、日付のみ "YYYY-MM-DD"）。createdAt とは独立 */
  reportedOn?: string | null;
  /** 完了日時（resolved/closed 遷移時にスタンプ） */
  resolvedAt?: string | null;
  /** システム作成時刻（表示・編集はしない） */
  createdAt?: string | null;
}

/** 環境マスタ（品質管理）。バグ票の動作環境；製品(顧客)ごと。 */
export interface Environment {
  id: string;
  customerId: string;
  /** 区分ラベル（例：dev / staging / prod） */
  name: string;
  /** 端末/ブラウザ（例：Chrome / iOS Safari） */
  browser?: string | null;
  /** 対象URL（例：https://dev.example.com） */
  url?: string | null;
  /** 表示ラベル（name [/ browser] [(url)]；バックエンド合成） */
  label?: string | null;
  sortOrder: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** 環境の表示ラベルを合成：name [/ browser] [(url)]。バックエンドの composeLabel と一致。 */
export function environmentLabel(e: Environment): string {
  let s = e.name ?? "";
  if (e.browser?.trim()) s += ` / ${e.browser.trim()}`;
  if (e.url?.trim()) s += ` (${e.url.trim()})`;
  return s;
}

/** スイート単位（total は suiteId=null）の集計 */
export interface QualitySuiteStat {
  suiteId: string | null;
  suiteName: string | null;
  total: number;
  pass: number;
  fail: number;
  na: number;
  untested: number;
  executed: number;
  /** 消化率 %（0-100） */
  executionRate: number;
  /** 成功率 %（0-100） */
  passRate: number;
}

/** GET /app/pm/customers/{id}/quality-summary 响应 */
export interface QualitySummary {
  customerId: string;
  suites: QualitySuiteStat[];
  total: QualitySuiteStat;
}

// ===== 横断検索（コマンドパレット ⌘K / GET /app/pm/search） =====
// 案件配下でしか引けない既存 API では「どの案件にあるか分からないタスク」を探せないため、
// パレット専用に横断検索を用意した。ヒット理由がグループで分かるよう、
// マッチ対象は種別ごとに固定（task=タスク名 / project=案件名・顧客名 / bug=タイトル・番号）。

/** 検索対象の種別。パレットのチップと 1:1。 */
export type SearchKind = "task" | "project" | "bug";

/** タスクのヒット 1 件。パレットの行がそのまま描ける情報を持つ。 */
export interface SearchTaskHit {
  id: string;
  name: string;
  /** "milestone" ならパレットでも菱形表示 */
  type?: TaskType | null;
  projectId?: string | null;
  projectName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  assigneeIds: string[];
  /** YYYY-MM-DD */
  start?: string | null;
  /** YYYY-MM-DD */
  end?: string | null;
  progress: number;
  /** 期限超過日数（0 なら遅延なし） */
  overdueDays: number;
}

/** 案件のヒット 1 件。 */
export interface SearchProjectHit {
  id: string;
  name: string;
  customerId?: string | null;
  customerName?: string | null;
  status?: ProjectStatus | null;
  start?: string | null;
  end?: string | null;
  progress: number;
  openTaskCount: number;
}

/** バグ票のヒット 1 件。 */
export interface SearchBugHit {
  id: string;
  bugNo?: string | null;
  title: string;
  status?: string | null;
  severity?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  assigneeName?: string | null;
  reportedOn?: string | null;
}

/** GET /app/pm/search 响应 */
export interface PmSearchVO {
  tasks: SearchTaskHit[];
  projects: SearchProjectHit[];
  bugs: SearchBugHit[];
}

/** 空結果（キーワード未入力時の初期値） */
export const EMPTY_SEARCH: PmSearchVO = { tasks: [], projects: [], bugs: [] };

// ===================== Mockups（モックアップ共有：単一 HTML の効果図） =====================
// 設計：doc/design/pm-mockup.md。内容は PG に版ごと保存、原文は別ドメイン（mock.*）から署名 URL で配信。

/** 共有設定（未発行なら token=null・enabled=false） */
export interface MockupShare {
  enabled: boolean;
  token: string | null;
  /** ISO datetime；null = 無期限 */
  expiresAt: string | null;
  /** null = 常に最新版 */
  pinnedVersion: number | null;
  viewCount: number;
  lastViewedAt: string | null;
}

export interface MockupVersion {
  version: number;
  note: string | null;
  sizeBytes: number;
  /** ファイル数（単一 HTML = 1、zip は入口 HTML を含む） */
  fileCount: number;
  /** web | mcp */
  via: string;
  createdByName: string | null;
  createdAt: string;
}

export interface Mockup {
  id: string;
  customerId: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskName: string | null;
  bugId: string | null;
  bugNo: string | null;
  bugTitle: string | null;
  title: string;
  currentVersion: number;
  /** 現行版のサイズ（zip は全ファイル合計） */
  sizeBytes: number;
  /** 現行版のファイル数 */
  fileCount: number;
  /** 現行版の公開日時 / 公開者 / 経路 */
  updatedAt: string;
  updatedByName: string | null;
  lastVia: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  share: MockupShare;
  /** 詳細取得時のみ（新 → 旧） */
  versions?: MockupVersion[];
}

/** 公開・新版発行（.html / .zip のファイルで送る）。mockupId 指定時は新しい版（紐付け系は無視される） */
export interface UploadMockupReq {
  file: File;
  title?: string;
  projectId?: string;
  taskId?: string;
  bugId?: string;
  mockupId?: string;
  note?: string;
}

export interface UpdateMockupReq {
  title?: string;
  taskId?: string;
  bugId?: string;
  clearTask?: boolean;
  clearBug?: boolean;
}

export interface MockupShareReq {
  enabled: boolean;
  /** null = 無期限 */
  expiresInDays: number | null;
  /** null = 常に最新 */
  pinnedVersion: number | null;
}

/** 公開共有ページ用（ログイン不要） */
export interface PublicMockupShare {
  title: string;
  customerName: string | null;
  projectName: string | null;
  version: number;
  updatedAt: string;
  expiresAt: string | null;
  viewUrl: string;
}

/** 単一 HTML の上限（後端 proyubi.pm.mockup.max-bytes と揃える） */
export const MOCKUP_MAX_BYTES = 5 * 1024 * 1024;
/** zip 本体の上限（後端 proyubi.pm.mockup.max-zip-bytes と揃える。展開後 100MB は後端で見る） */
export const MOCKUP_ZIP_MAX_BYTES = 50 * 1024 * 1024;

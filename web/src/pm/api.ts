// PM 业务 service 层：对接 pm-api 后端 /app/pm/**。
// 复用 pm-web 自身的 @umijs/max request：
//  - responseInterceptor 已自动解包 R<T> → data，故这里直接返回 T；
//  - requestInterceptor 自动注入 satoken（pullcord_token）/X-Lang/X-App-Code；
//  - 业务码非 0 / 401 由 requestErrorConfig 统一 toast + 跳登录。
import { request } from "@umijs/max";
import dayjs, { ISO } from "./utils/date";
import type {
  BatchCreateDocReq,
  CreateDocReq,
  Customer,
  Dependency,
  DocPickerConfig,
  Holiday,
  Member,
  MindMap,
  MindMapSummary,
  MindMapTheme,
  MindNode,
  Mockup,
  MockupShare,
  MockupShareReq,
  MockupVersion,
  EventReq,
  PmCalendarVO,
  PmEvent,
  PmOverviewVO,
  PmRoadmapVO,
  PmDoc,
  PmDocTaskRef,
  Project,
  PublicMockupShare,
  ProjectKind,
  ProjectStatus,
  RoadmapOption,
  RoadmapOptionKind,
  Task,
  TaskActivity,
  TaskActivityChange,
  TaskComment,
  TaskLink,
  TaskStatus,
  TaskType,
  Team,
  UpdateDocReq,
  UpdateMockupReq,
  UploadMockupReq,
  WorkloadItem,
} from "./types";

const PM = "/app/pm";

// ===================== Teams（团队 / 子团队，复用 /app/team） =====================

/** 当前租户团队列表（含成员数、是否默认、canCreateMore）。供 PM 端筛选/建客户选团队。 */
export function listTeams() {
  return request<Team[]>("/app/team/teams", { method: "GET" });
}

/**
 * list 接口结果兜底为数组。
 * 后端 list 正常返回 JSON 数组；但 requestErrorConfig 的响应拦截器会把
 * MyBatis-Flex 的 Page 对象转成 { list, total }，历史/分页实现也可能返回
 * { records } 或未解包的 { data }。这里统一兜底，避免拿到非数组时
 * 直接 `.map` 抛 "map is not a function"。
 */
function asArray<T = unknown>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["list", "records", "data"]) {
      if (Array.isArray(o[key])) return o[key] as T[];
    }
  }
  return [];
}

// ===================== Customers =====================

export function listCustomers() {
  return request<Customer[]>(`${PM}/customers`, { method: "GET" });
}

export function createCustomer(
  name: string,
  shortName?: string,
  teamId?: string,
  active?: boolean
) {
  return request<Customer>(`${PM}/customers`, {
    method: "POST",
    data: { name, shortName, teamId, active },
  });
}

export function updateCustomer(
  id: string,
  name: string,
  shortName?: string,
  active?: boolean
) {
  return request<Customer>(`${PM}/customers/${id}`, {
    method: "PUT",
    data: { name, shortName, active },
  });
}

export function deleteCustomer(id: string) {
  return request<void>(`${PM}/customers/${id}`, { method: "DELETE" });
}

// ===================== Members =====================

/** 当前租户中尚未加入 PM 的用户（供"拉人进来"选择） */
export interface TenantUser {
  id: string;
  displayName: string;
  role: string;
  enabled: boolean;
}

export function listMembers() {
  return request<Member[]>(`${PM}/members`, { method: "GET" });
}

export function listAvailableUsers() {
  return request<TenantUser[]>(`${PM}/members/available`, { method: "GET" });
}

export function createMember(body: {
  userId: string;
  name?: string;
  color?: string;
  role?: string;
}) {
  return request<Member>(`${PM}/members`, { method: "POST", data: body });
}

export function updateMember(
  id: string,
  body: { name?: string; color?: string; role?: string }
) {
  return request<Member>(`${PM}/members/${id}`, { method: "PUT", data: body });
}

export function deleteMember(id: string) {
  return request<void>(`${PM}/members/${id}`, { method: "DELETE" });
}

// ===================== Projects =====================

export interface CreateProjectPayload {
  customerId: string;
  name: string;
  description?: string;
  status?: ProjectStatus;
  /** 省略時は 'project'（通常项目） */
  kind?: ProjectKind;
  start: string; // YYYY-MM-DD
  /** kind='ops' のときのみ省略可（＝終了日未定・継続中） */
  end?: string | null;
  /** 月次工数枠（分）。0 以下を送ると「枠なし」に戻る */
  monthlyQuotaMinutes?: number | null;
}
export type UpdateProjectPayload = Partial<CreateProjectPayload> & {
  /**
   * true=終了日を明示的にクリアして「継続中」へ戻す。
   * PATCH セマンティクスでは end:null は「未変更」と区別できないため専用フラグが要る。
   */
  clearEnd?: boolean;
};

export function listProjects(params?: {
  customerId?: string;
  status?: string;
  /** 按团队精确筛选（owner 可选；member 自动限定其团队） */
  teamId?: string;
}) {
  return request<Project[]>(`${PM}/projects`, { method: "GET", params });
}

export function getProject(id: string) {
  return request<Project>(`${PM}/projects/${id}`, { method: "GET" });
}

export function createProject(body: CreateProjectPayload) {
  return request<Project>(`${PM}/projects`, { method: "POST", data: body });
}

export function updateProject(id: string, body: UpdateProjectPayload) {
  return request<Project>(`${PM}/projects/${id}`, {
    method: "PUT",
    data: body,
  });
}

export function deleteProject(id: string) {
  return request<void>(`${PM}/projects/${id}`, { method: "DELETE" });
}

/** 拖动排序：按给定顺序持久化同一客户下项目的排序（orderedIds 为该客户全部项目 id） */
export function reorderProjects(customerId: string, orderedIds: string[]) {
  return request<void>(`${PM}/projects/reorder`, {
    method: "PUT",
    data: { customerId, orderedIds },
  });
}

// ===================== Tasks =====================

export interface CreateTaskPayload {
  projectId: string;
  parentId: string | null;
  name: string;
  start: string; // YYYY-MM-DD（计划开始）
  end: string; // 计划结束（闭区间含尾日）
  actualStart?: string | null;
  actualEnd?: string | null;
  /** 予定工期·小时（手填 0–23.75，可小数 0.25 步进）。与 plannedEffortDays 组手动 d/h；days空且本字段空/0 才回退期间派生 */
  plannedEffortHours?: number | null;
  /** 実績工期·小时（手填 0–23.75，可小数 0.25 步进）。与 actualEffortDays 组手动 d/h；days空且本字段空/0 才回退期间派生 */
  actualEffortHours?: number | null;
  /** 予定工期·日数（手动，1d=24h）。与 plannedEffortHours 组手动 d/h；days非空或 hours>0 即手动优先，否则期间派生 */
  plannedEffortDays?: number | null;
  /** 実績工期·日数（手动，1d=24h）。与 actualEffortHours 组手动 d/h；days非空或 hours>0 即手动优先，否则期间派生 */
  actualEffortDays?: number | null;
  progress?: number;
  assigneeIds?: string[];
  levels?: string[];
  description?: string;
  type?: TaskType;
  /** 看板业务状态 */
  status?: TaskStatus;
  collapsed?: boolean;
  order?: number;
  // 路线图设置
  roadmapVisible?: boolean;
  roadmapLane?: string | null;
  milestoneColor?: string | null;
}
export type UpdateTaskPayload = Partial<CreateTaskPayload> & {
  /** 目标项目（与当前不同则整棵子树跨项目移动） */
  projectId?: string;
  /** true=parentId 为权威值（含 null=移到根级）；否则后端按「null=不变」处理 */
  reparent?: boolean;
  /** true=显式清空实际起止时间（两端） */
  clearActual?: boolean;
  /** true=仅清空实际结束日、保留开始日（着手中/进行中；与 clearActual 排他） */
  clearActualEnd?: boolean;
  /** true=显式把予定/実績手动工期日数清回 null（回退期间派生）。仿 clearActual：因 update 走 null=不变，
   * 「清空两框=回自动」无法用 days:null 表达，需此开关让后端把 planned/actual_effort_days 置 NULL */
  clearEffort?: boolean;
};

// 后端期间字段（LocalDate）序列化为 'YYYY-MM-DD'；统一用 dayjs 归一到 ISO（补零、字典序==时间序）。
const toDt = (v: unknown) =>
  v == null || v === "" ? "" : dayjs(String(v)).format(ISO);
const toDtOrNull = (v: unknown) =>
  v == null || v === "" ? null : dayjs(String(v)).format(ISO);

/** 后端 PmTask 含额外字段（tenantId/时间戳），统一规整为前端 Task */
export function normalizeTask(raw: Record<string, unknown>): Task {
  return {
    id: String(raw.id),
    projectId: String(raw.projectId),
    parentId: raw.parentId != null ? String(raw.parentId) : null,
    name: String(raw.name ?? ""),
    start: toDt(raw.start),
    end: toDt(raw.end),
    actualStart: toDtOrNull(raw.actualStart),
    actualEnd: toDtOrNull(raw.actualEnd),
    plannedEffortHours:
      typeof raw.plannedEffortHours === "number"
        ? raw.plannedEffortHours
        : null,
    actualEffortHours:
      typeof raw.actualEffortHours === "number" ? raw.actualEffortHours : null,
    plannedEffortDays:
      typeof raw.plannedEffortDays === "number" ? raw.plannedEffortDays : null,
    actualEffortDays:
      typeof raw.actualEffortDays === "number" ? raw.actualEffortDays : null,
    progress: typeof raw.progress === "number" ? raw.progress : 0,
    assigneeIds: Array.isArray(raw.assigneeIds)
      ? (raw.assigneeIds as string[])
      : [],
    levels: Array.isArray(raw.levels) ? (raw.levels as string[]) : [],
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    type: (raw.type as TaskType) ?? "task",
    status: (raw.status as TaskStatus) ?? "todo",
    collapsed: Boolean(raw.collapsed),
    order: typeof raw.order === "number" ? raw.order : 0,
    roadmapVisible: Boolean(raw.roadmapVisible),
    roadmapLane: raw.roadmapLane != null ? String(raw.roadmapLane) : null,
    milestoneColor:
      raw.milestoneColor != null ? String(raw.milestoneColor) : null,
  };
}

export async function listTasks(projectId: string): Promise<Task[]> {
  const raw = await request<unknown>(`${PM}/projects/${projectId}/tasks`, {
    method: "GET",
  });
  return asArray<Record<string, unknown>>(raw).map(normalizeTask);
}

export async function createTask(body: CreateTaskPayload): Promise<Task> {
  const raw = await request<Record<string, unknown>>(`${PM}/tasks`, {
    method: "POST",
    data: body,
  });
  return normalizeTask(raw);
}

export async function updateTask(
  id: string,
  body: UpdateTaskPayload
): Promise<Task> {
  const raw = await request<Record<string, unknown>>(`${PM}/tasks/${id}`, {
    method: "PUT",
    data: body,
  });
  return normalizeTask(raw);
}

export function deleteTask(id: string) {
  return request<void>(`${PM}/tasks/${id}`, { method: "DELETE" });
}

export async function toggleCollapse(id: string): Promise<Task> {
  const raw = await request<Record<string, unknown>>(
    `${PM}/tasks/${id}/collapse`,
    { method: "PUT" }
  );
  return normalizeTask(raw);
}

export function setCollapsedAll(projectId: string, collapsed: boolean) {
  return request<void>(`${PM}/projects/${projectId}/tasks/collapse-all`, {
    method: "PUT",
    params: { collapsed },
  });
}

// ===================== Comments（任务评论） =====================

function normalizeComment(raw: Record<string, unknown>): TaskComment {
  return {
    id: String(raw.id),
    taskId: String(raw.taskId),
    authorUserId: raw.authorUserId != null ? String(raw.authorUserId) : "",
    authorMemberId:
      raw.authorMemberId != null ? String(raw.authorMemberId) : null,
    authorName: String(raw.authorName ?? "—"),
    content: String(raw.content ?? ""),
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    mine: Boolean(raw.mine),
  };
}

/** 列出某任务的评论（按发帖时间升序）。 */
export async function listComments(taskId: string): Promise<TaskComment[]> {
  const raw = await request<unknown>(`${PM}/tasks/${taskId}/comments`, {
    method: "GET",
  });
  return asArray<Record<string, unknown>>(raw).map(normalizeComment);
}

export async function createComment(
  taskId: string,
  content: string
): Promise<TaskComment> {
  const raw = await request<Record<string, unknown>>(
    `${PM}/tasks/${taskId}/comments`,
    { method: "POST", data: { content } }
  );
  return normalizeComment(raw);
}

export async function updateComment(
  id: string,
  content: string
): Promise<TaskComment> {
  const raw = await request<Record<string, unknown>>(`${PM}/comments/${id}`, {
    method: "PUT",
    data: { content },
  });
  return normalizeComment(raw);
}

export function deleteComment(id: string) {
  return request<void>(`${PM}/comments/${id}`, { method: "DELETE" });
}

// ===================== Task Links（任务关联链接 / 设计稿） =====================

function normalizeTaskLink(raw: Record<string, unknown>): TaskLink {
  return {
    id: String(raw.id),
    taskId: String(raw.taskId),
    kind: typeof raw.kind === "string" ? raw.kind : "link",
    url: String(raw.url ?? ""),
    title:
      raw.title != null && String(raw.title).length > 0
        ? String(raw.title)
        : null,
    createdBy: raw.createdBy != null ? String(raw.createdBy) : "",
    createdAt: String(raw.createdAt ?? ""),
  };
}

/** 列出某任务的关联链接（按添加时间升序）。 */
export async function listTaskLinks(taskId: string): Promise<TaskLink[]> {
  const raw = await request<unknown>(`${PM}/tasks/${taskId}/links`, {
    method: "GET",
  });
  return asArray<Record<string, unknown>>(raw).map(normalizeTaskLink);
}

/** 新增关联链接（kind 由后端按 url 域名判定）。 */
export async function createTaskLink(
  taskId: string,
  url: string,
  title?: string
): Promise<TaskLink> {
  const raw = await request<Record<string, unknown>>(
    `${PM}/tasks/${taskId}/links`,
    { method: "POST", data: { url, title } }
  );
  return normalizeTaskLink(raw);
}

export function deleteTaskLink(id: string) {
  return request<void>(`${PM}/links/${id}`, { method: "DELETE" });
}

// ===================== Docs（顧客 / 案件 / タスクの資料＝外部ドライブのリンク） =====================

function strOrNull(v: unknown): string | null {
  return v != null && String(v).length > 0 ? String(v) : null;
}

function normalizeDoc(raw: Record<string, unknown>): PmDoc {
  return {
    id: String(raw.id),
    customerId: String(raw.customerId ?? ""),
    projectId: strOrNull(raw.projectId),
    projectName: strOrNull(raw.projectName),
    url: String(raw.url ?? ""),
    provider: typeof raw.provider === "string" ? raw.provider : "other",
    kind: typeof raw.kind === "string" ? raw.kind : "link",
    externalId: strOrNull(raw.externalId),
    previewUrl: strOrNull(raw.previewUrl),
    title: strOrNull(raw.title),
    isRoot: raw.isRoot === true || raw.root === true,
    mimeType: strOrNull(raw.mimeType),
    tasks: asArray<Record<string, unknown>>(raw.tasks).map(
      (t): PmDocTaskRef => ({
        taskId: String(t.taskId),
        taskName: String(t.taskName ?? ""),
      })
    ),
    createdBy: raw.createdBy != null ? String(raw.createdBy) : "",
    createdByName: strOrNull(raw.createdByName),
    createdAt: String(raw.createdAt ?? ""),
  };
}

async function listDocs(path: string): Promise<PmDoc[]> {
  const raw = await request<unknown>(path, { method: "GET" });
  return asArray<Record<string, unknown>>(raw).map(normalizeDoc);
}

/** 案件の資料（案件フォルダ＝root を含む）。 */
export function listProjectDocs(projectId: string) {
  return listDocs(`${PM}/projects/${projectId}/docs`);
}

/** タスクに紐付いた資料。 */
export function listTaskDocs(taskId: string) {
  return listDocs(`${PM}/tasks/${taskId}/docs`);
}

/** 資料を登録（provider / kind は後端が URL から判定）。isRoot=true は同スコープの旧ルートを置き換える。 */
export async function createDoc(body: CreateDocReq): Promise<PmDoc> {
  const raw = await request<Record<string, unknown>>(`${PM}/docs`, {
    method: "POST",
    data: body,
  });
  return normalizeDoc(raw);
}

/**
 * Google Picker で選んだ複数ファイルを 1 トランザクションで登録（items 1..50）。
 * 後端に渡すのは url / 表示名 / mimeType だけで、OAuth トークンは送らない。
 */
export async function createDocsBatch(
  body: BatchCreateDocReq
): Promise<PmDoc[]> {
  const raw = await request<unknown>(`${PM}/docs/batch`, {
    method: "POST",
    data: body,
  });
  return asArray<Record<string, unknown>>(raw).map(normalizeDoc);
}

/** Google Picker の設定（clientId / API キー / appId）。未設定なら enabled=false。 */
export async function getDocPickerConfig(): Promise<DocPickerConfig> {
  const raw = await request<Record<string, unknown> | null>(
    `${PM}/docs/picker-config`,
    { method: "GET" }
  );
  const clientId = strOrNull(raw?.clientId);
  const apiKey = strOrNull(raw?.apiKey);
  const appId = strOrNull(raw?.appId);
  const enabled = raw?.enabled === true && !!clientId && !!apiKey && !!appId;
  return enabled
    ? { enabled, clientId, apiKey, appId }
    : { enabled: false, clientId: null, apiKey: null, appId: null };
}

/** 表示名／タスク紐付けを更新。taskIds を渡すと紐付けを丸ごと置き換える。 */
export async function updateDoc(
  id: string,
  body: UpdateDocReq
): Promise<PmDoc> {
  const raw = await request<Record<string, unknown>>(`${PM}/docs/${id}`, {
    method: "PATCH",
    data: body,
  });
  return normalizeDoc(raw);
}

export function deleteDoc(id: string) {
  return request<void>(`${PM}/docs/${id}`, { method: "DELETE" });
}

// ===================== Task activity（操作履歴） =====================

function normalizeActivity(raw: Record<string, unknown>): TaskActivity {
  const changes = asArray<Record<string, unknown>>(raw.changes).map(
    (c): TaskActivityChange => ({
      field: String(c.field ?? ""),
      from: c.from != null ? String(c.from) : null,
      to: c.to != null ? String(c.to) : null,
      added: Array.isArray(c.added) ? c.added.map(String) : null,
      removed: Array.isArray(c.removed) ? c.removed.map(String) : null,
    })
  );
  return {
    id: String(raw.id ?? ""),
    taskId: String(raw.taskId ?? ""),
    actorMemberId: raw.actorMemberId != null ? String(raw.actorMemberId) : null,
    actorName: String(raw.actorName ?? "—"),
    action: String(raw.action ?? "updated") as TaskActivity["action"],
    source: String(raw.source ?? "web"),
    createdAt: String(raw.createdAt ?? ""),
    changes,
  };
}

/** 某タスクの操作履歴（新しい順）。読み取り専用・追記専用なので更新系 API は無い。 */
export async function listTaskActivities(
  taskId: string,
  limit?: number
): Promise<TaskActivity[]> {
  const raw = await request<unknown>(`${PM}/tasks/${taskId}/activities`, {
    method: "GET",
    params: limit ? { limit } : undefined,
  });
  return asArray<Record<string, unknown>>(raw).map(normalizeActivity);
}

// ===================== Dependencies =====================

export async function listDependencies(
  projectId: string
): Promise<Dependency[]> {
  const raw = await request<unknown>(
    `${PM}/projects/${projectId}/dependencies`,
    { method: "GET" }
  );
  return asArray<Dependency>(raw);
}

export function createDependency(body: {
  projectId: string;
  predecessorId: string;
  successorId: string;
  type?: "FS";
  lag?: number;
}) {
  return request<Dependency>(`${PM}/dependencies`, {
    method: "POST",
    data: body,
  });
}

export function deleteDependency(id: string) {
  return request<void>(`${PM}/dependencies/${id}`, { method: "DELETE" });
}

// ===================== Roadmap（導入スケジュール） =====================

/** 拉取项目路线图（后端已 rollup 汇总，只读视图）。 */
export function getRoadmap(projectId: string) {
  return request<PmRoadmapVO>(`${PM}/projects/${projectId}/roadmap`, {
    method: "GET",
  });
}

// ============== Roadmap Options（泳道/里程碑色 自定义字典） ==============

/** 列出当前租户路线图字典项（可选按 kind 过滤），已按 sortOrder 排序。 */
export function listRoadmapOptions(kind?: RoadmapOptionKind) {
  return request<RoadmapOption[]>(`${PM}/roadmap-options`, {
    method: "GET",
    params: kind ? { kind } : undefined,
  });
}

export function createRoadmapOption(body: {
  kind: RoadmapOptionKind;
  label: string;
  color?: string | null;
  sortOrder?: number;
}) {
  return request<RoadmapOption>(`${PM}/roadmap-options`, {
    method: "POST",
    data: body,
  });
}

export function updateRoadmapOption(
  id: string,
  body: { label?: string; color?: string | null; sortOrder?: number }
) {
  return request<RoadmapOption>(`${PM}/roadmap-options/${id}`, {
    method: "PUT",
    data: body,
  });
}

export function deleteRoadmapOption(id: string) {
  return request<void>(`${PM}/roadmap-options/${id}`, { method: "DELETE" });
}

/** 拖动排序：按给定顺序持久化同一 kind 下字典项 */
export function reorderRoadmapOptions(
  kind: RoadmapOptionKind,
  orderedIds: string[]
) {
  return request<void>(`${PM}/roadmap-options/reorder`, {
    method: "PUT",
    data: { kind, orderedIds },
  });
}

// ===================== Workload（成员视图 / リソース） =====================

/**
 * 拉取工时（成员甘特/资源视图）。
 * - 不传 memberId：返回全部「有指派」的任务（全员模式）。
 * - 传 memberId：仅该成员的跨项目任务（单人模式）。memberId = pm_member 的 id。
 * 返回所有 type（task/summary/milestone），由前端按需过滤。
 */
export function getWorkload(memberId?: string) {
  return request<WorkloadItem[]>(`${PM}/workload`, {
    method: "GET",
    params: memberId ? { memberId } : undefined,
  });
}

// ===================== Overview（俯瞰页聚合） =====================

/**
 * 拉取俯瞰页聚合数据（服务端算好 KPI / 风险 / 项目健康 / 里程碑）。
 * @param scope "all"=全社俯瞰（默认）；"me"=仅本人担当
 */
export function getOverview(scope: "all" | "me" = "all") {
  return request<PmOverviewVO>(`${PM}/overview`, {
    method: "GET",
    params: { scope },
  });
}

// ===================== Calendar（日历视图区间任务） =====================

/**
 * 拉取日历区间内全部叶子任务（服务端给风险种别 + scope=me 解析）。
 * @param from 区间起 YYYY-MM-DD
 * @param to   区间止 YYYY-MM-DD
 * @param scope "all"=全社（默认）；"me"=仅本人担当
 */
export function getCalendar(
  from: string,
  to: string,
  scope: "all" | "me" = "all"
) {
  return request<PmCalendarVO>(`${PM}/calendar`, {
    method: "GET",
    params: { from, to, scope },
  });
}

// ===================== Events（事件 / 会议日程，嵌入 /calendar） =====================

/**
 * 拉取区间内事件（start_at/end_at 与 [from,to] 相交）。
 * @param from  区间起 YYYY-MM-DD
 * @param to    区间止 YYYY-MM-DD
 * @param scope "all"=全员（默认）；"me"=仅本人参加
 */
export function getEvents(
  from: string,
  to: string,
  scope: "all" | "me" = "all"
) {
  return request<PmEvent[]>(`${PM}/events`, {
    method: "GET",
    params: { from, to, scope },
  });
}

/** 新建事件 */
export function createEvent(body: EventReq) {
  return request<PmEvent>(`${PM}/events`, { method: "POST", data: body });
}

/** 更新事件 */
export function updateEvent(id: string, body: EventReq) {
  return request<PmEvent>(`${PM}/events/${id}`, { method: "PUT", data: body });
}

/** 软删除事件 */
export function deleteEvent(id: string) {
  return request<void>(`${PM}/events/${id}`, { method: "DELETE" });
}

// ===================== 富文本贴图上传 =====================

/** 上传 PM 任务描述里的图片 → 返回公网 URL。后端 pm 分类放宽到 5MB。 */
export function uploadPmImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<string>("/app/upload/image/pm", {
    method: "POST",
    data: formData,
    requestType: "form",
  });
}

// ===================== 思维导图（Mind Map） =====================
// 后端 PmMindmap.content 是 jsonb，序列化后是「JSON 字符串」；前端整读整写。

const DEFAULT_ROOT: MindNode = {
  id: "root",
  text: "中心主题",
  children: [],
};

/** 把后端 jsonb 字符串安全解析为 root 节点，异常时回退到默认根。 */
function parseRoot(content: unknown): MindNode {
  if (content == null) return { ...DEFAULT_ROOT };
  try {
    const obj =
      typeof content === "string"
        ? JSON.parse(content)
        : (content as Record<string, unknown>);
    const root = (obj as { root?: MindNode })?.root;
    if (root && typeof root === "object" && typeof root.id === "string") {
      return root;
    }
  } catch {
    /* 落坏数据时回退默认根，避免编辑器崩溃 */
  }
  return { ...DEFAULT_ROOT };
}

function normalizeSummary(raw: Record<string, unknown>): MindMapSummary {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    projectId: raw.projectId != null ? String(raw.projectId) : null,
    theme: (raw.theme as MindMapTheme) ?? "classic",
    version: typeof raw.version === "number" ? raw.version : 1,
    updatedAt: String(raw.updatedAt ?? ""),
    createdAt: String(raw.createdAt ?? ""),
  };
}

function normalizeMindMap(raw: Record<string, unknown>): MindMap {
  return {
    ...normalizeSummary(raw),
    root: parseRoot(raw.content),
  };
}

export async function listMindMaps(): Promise<MindMapSummary[]> {
  const raw = await request<unknown>(`${PM}/mindmaps`, { method: "GET" });
  return asArray<Record<string, unknown>>(raw).map(normalizeSummary);
}

export async function getMindMap(id: string): Promise<MindMap> {
  const raw = await request<Record<string, unknown>>(`${PM}/mindmaps/${id}`, {
    method: "GET",
  });
  return normalizeMindMap(raw);
}

export async function createMindMap(body: {
  name: string;
  projectId?: string | null;
  theme?: MindMapTheme;
  root?: MindNode;
}): Promise<MindMap> {
  const raw = await request<Record<string, unknown>>(`${PM}/mindmaps`, {
    method: "POST",
    data: {
      name: body.name,
      projectId: body.projectId ?? undefined,
      theme: body.theme,
      content: body.root ? JSON.stringify({ root: body.root }) : undefined,
    },
  });
  return normalizeMindMap(raw);
}

/**
 * 更新导图。
 * - 改内容：传 root + version（乐观锁）；服务端版本不一致返回 409。
 * - 改名/换主题/换关联：传对应字段即可，不必带 root。
 * - clearProject=true 显式解除关联项目。
 */
export async function updateMindMap(
  id: string,
  body: {
    name?: string;
    projectId?: string | null;
    clearProject?: boolean;
    theme?: MindMapTheme;
    root?: MindNode;
    version?: number;
  }
): Promise<MindMap> {
  const raw = await request<Record<string, unknown>>(`${PM}/mindmaps/${id}`, {
    method: "PUT",
    data: {
      name: body.name,
      projectId: body.projectId ?? undefined,
      clearProject: body.clearProject,
      theme: body.theme,
      content: body.root ? JSON.stringify({ root: body.root }) : undefined,
      version: body.version,
    },
  });
  return normalizeMindMap(raw);
}

export function deleteMindMap(id: string) {
  return request<void>(`${PM}/mindmaps/${id}`, { method: "DELETE" });
}

// ============== Holidays（节假日 / 红日子，租户级） ==============

/** 列出当前租户节假日（可选 from/to ISO 日期过滤），按日期升序。 */
export function listHolidays(params?: { from?: string; to?: string }) {
  return request<Holiday[]>(`${PM}/holidays`, { method: "GET", params });
}

/** 手动新增一个红日子。 */
export function createHoliday(body: { date: string; name: string }) {
  return request<Holiday>(`${PM}/holidays`, { method: "POST", data: body });
}

/** 编辑红日子（日期 / 名称）；编辑后转为人工维护。 */
export function updateHoliday(
  id: string,
  body: { date: string; name: string }
) {
  return request<Holiday>(`${PM}/holidays/${id}`, {
    method: "PUT",
    data: body,
  });
}

export function deleteHoliday(id: string) {
  return request<void>(`${PM}/holidays/${id}`, { method: "DELETE" });
}

/** 批量导入（手动）：返回新增条数（已存在日期自动跳过）。 */
export function importHolidays(rows: { date: string; name: string }[]) {
  return request<number>(`${PM}/holidays/import`, {
    method: "POST",
    data: { rows },
  });
}

/** 立即从 holidays-jp 同步当前租户祝日，返回 {added,updated,removed}。 */
export function syncHolidays() {
  return request<{ added: number; updated: number; removed: number }>(
    `${PM}/holidays/sync`,
    { method: "POST" }
  );
}

// ============== Settings（工数设定：1営業日=何時間，租户级） ==============

/** 当前租户的「1営業日=何時間」（工期↔時間の換算単位）。未设定=默认 8。 */
export function getWorkdaySetting() {
  return request<{ hoursPerWorkday: number }>(`${PM}/settings`, {
    method: "GET",
  });
}

/** 更新「1営業日=何時間」（owner 限定；范围 [1,24]，小数可如 7.5）。返回生效值。 */
export function updateWorkdaySetting(hoursPerWorkday: number) {
  return request<{ hoursPerWorkday: number }>(`${PM}/settings`, {
    method: "PUT",
    data: { hoursPerWorkday },
  });
}

// ============== 品質管理（Quality：テストスイート / ケース / バグ） ==============

/** URLSearchParams 兜底：非空値のみ付与。 */
function qcQuery(params: Record<string, string | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ---- テストスイート ----

export function listTestSuites(customerId: string) {
  return request<import("./types").TestSuite[]>(
    `${PM}/customers/${customerId}/test-suites`,
    { method: "GET" }
  );
}

export function createTestSuite(
  customerId: string,
  body: {
    name: string;
    casePrefix?: string;
    description?: string;
    taskId?: string | null;
  }
) {
  return request<import("./types").TestSuite>(
    `${PM}/customers/${customerId}/test-suites`,
    { method: "POST", data: body }
  );
}

export function updateTestSuite(
  id: string,
  body: {
    name?: string;
    casePrefix?: string;
    description?: string;
    sortOrder?: number;
    taskId?: string | null;
    unlinkTask?: boolean;
  }
) {
  return request<import("./types").TestSuite>(`${PM}/test-suites/${id}`, {
    method: "PATCH",
    data: body,
  });
}

export function deleteTestSuite(id: string) {
  return request<void>(`${PM}/test-suites/${id}`, { method: "DELETE" });
}

// ---- 環境マスタ ----

export function listEnvironments(customerId: string) {
  return request<import("./types").Environment[]>(
    `${PM}/customers/${customerId}/environments`,
    { method: "GET" }
  );
}

export function createEnvironment(
  customerId: string,
  body: { name: string; browser?: string | null; url?: string | null }
) {
  return request<import("./types").Environment>(
    `${PM}/customers/${customerId}/environments`,
    { method: "POST", data: body }
  );
}

export function updateEnvironment(
  id: string,
  body: {
    name?: string;
    browser?: string | null;
    url?: string | null;
    sortOrder?: number;
  }
) {
  return request<import("./types").Environment>(`${PM}/environments/${id}`, {
    method: "PATCH",
    data: body,
  });
}

export function deleteEnvironment(id: string) {
  return request<void>(`${PM}/environments/${id}`, { method: "DELETE" });
}

export function getQualitySummary(customerId: string) {
  return request<import("./types").QualitySummary>(
    `${PM}/customers/${customerId}/quality-summary`,
    { method: "GET" }
  );
}

// ---- テストケース ----

export function listCasesBySuite(suiteId: string) {
  return request<import("./types").TestCase[]>(
    `${PM}/test-suites/${suiteId}/test-cases`,
    { method: "GET" }
  );
}

export function listCasesByCustomer(
  customerId: string,
  filters?: {
    suiteId?: string;
    result?: string;
    category?: string;
    priority?: string;
    keyword?: string;
  }
) {
  return request<import("./types").TestCase[]>(
    `${PM}/customers/${customerId}/test-cases${qcQuery(filters ?? {})}`,
    { method: "GET" }
  );
}

/** ケース作成/更新の入力（部分更新可）。 */
export interface CaseBody {
  featureMajor?: string;
  featureMinor?: string;
  title?: string;
  category?: string;
  priority?: string;
  precondition?: string;
  steps?: string;
  testData?: string;
  expected?: string;
  remark?: string;
  result?: string;
  caseNo?: string;
}

export function createCase(suiteId: string, body: CaseBody) {
  return request<import("./types").TestCase>(
    `${PM}/test-suites/${suiteId}/test-cases`,
    { method: "POST", data: body }
  );
}

export function batchCreateCases(suiteId: string, rows: CaseBody[]) {
  return request<number>(`${PM}/test-suites/${suiteId}/test-cases/batch`, {
    method: "POST",
    data: rows,
  });
}

export function updateCase(id: string, body: CaseBody) {
  return request<import("./types").TestCase>(`${PM}/test-cases/${id}`, {
    method: "PATCH",
    data: body,
  });
}

export function deleteCase(id: string) {
  return request<void>(`${PM}/test-cases/${id}`, { method: "DELETE" });
}

/** 実施結果クイック更新1件（result 空/'untested' で未実施に戻す）。 */
export function updateCaseResult(id: string, result: string | null) {
  return request<import("./types").TestCase>(`${PM}/test-cases/${id}/result`, {
    method: "PATCH",
    data: { result: result ?? "untested" },
  });
}

/** 実施結果一括記録。更新件数を返す。 */
export function batchCaseResult(caseIds: string[], result: string | null) {
  return request<number>(`${PM}/test-cases/results/batch`, {
    method: "PATCH",
    data: { caseIds, result: result ?? "untested" },
  });
}

export function listCasesByTask(taskId: string) {
  return request<import("./types").TestCase[]>(
    `${PM}/tasks/${taskId}/test-cases`,
    { method: "GET" }
  );
}

// ---- バグ票 ----

export function listBugsByCustomer(
  customerId: string,
  filters?: {
    status?: string;
    severity?: string;
    priority?: string;
    assigneeId?: string;
    keyword?: string;
  }
) {
  return request<import("./types").Bug[]>(
    `${PM}/customers/${customerId}/bugs${qcQuery(filters ?? {})}`,
    { method: "GET" }
  );
}

/** バグ作成/更新の入力。 */
export interface BugBody {
  title?: string;
  description?: string;
  severity?: string;
  priority?: string;
  status?: string;
  /** 自由入力の環境（旧・MCP 起票用；マスタ選択時は environmentId を使う） */
  environment?: string;
  /** 環境マスタ参照（pm_environment.id）。選択時はサーバ側で合成ラベルを environment にスナップショット */
  environmentId?: string | null;
  assigneeMemberId?: string | null;
  /** 移動先製品（update 時のみ；別製品へ移すと再採番される） */
  customerId?: string | null;
  projectId?: string | null;
  /** 起票日の手動上書き（日付のみ "YYYY-MM-DD"） */
  reportedOn?: string;
  /** 完了日時の手動上書き（"YYYY-MM-DDTHH:mm:ss"） */
  resolvedAt?: string;
  unlinkProject?: boolean;
  unlinkTask?: boolean;
  clearAssignee?: boolean;
  clearResolvedAt?: boolean;
  /** 環境マスタ紐付けの解除（environmentId=null 選択時に送る） */
  unlinkEnvironment?: boolean;
}

export function createBug(customerId: string, body: BugBody) {
  return request<import("./types").Bug>(`${PM}/customers/${customerId}/bugs`, {
    method: "POST",
    data: body,
  });
}

/** 失敗ケースからバグ起票（task_id/test_case_id 継承、title/description 事前充填）。 */
export function createBugFromCase(caseId: string, body: BugBody) {
  return request<import("./types").Bug>(`${PM}/test-cases/${caseId}/bugs`, {
    method: "POST",
    data: body,
  });
}

export function getBug(id: string) {
  return request<import("./types").Bug>(`${PM}/bugs/${id}`, { method: "GET" });
}

export function updateBug(id: string, body: BugBody) {
  return request<import("./types").Bug>(`${PM}/bugs/${id}`, {
    method: "PATCH",
    data: body,
  });
}

export function updateBugStatus(id: string, status: string) {
  return request<import("./types").Bug>(`${PM}/bugs/${id}/status`, {
    method: "PATCH",
    data: { status },
  });
}

export function deleteBug(id: string) {
  return request<void>(`${PM}/bugs/${id}`, { method: "DELETE" });
}

export function listBugsByTask(taskId: string) {
  return request<import("./types").Bug[]>(`${PM}/tasks/${taskId}/bugs`, {
    method: "GET",
  });
}

/** バグ→タスクの一括紐付け／解除。ids のバグをまとめて taskId に紐付ける（unlinkTask=true で一括解除）。返り値=更新件数。 */
export function batchLinkBugTask(
  ids: string[],
  taskId?: string,
  unlinkTask?: boolean
) {
  return request<number>(`${PM}/bugs/batch-task`, {
    method: "PATCH",
    data: { ids, taskId, unlinkTask },
  });
}

// ===================== 横断検索（コマンドパレット ⌘K） =====================

/**
 * タスク / 案件 / バグ票を案件横断で検索。
 * keyword 空のときはサーバも空結果を返すので、デバウンス前でも安全に呼べる。
 *
 * @param keyword 検索語
 * @param kinds   絞る種別。未指定なら全種別
 * @param limit   種別ごとの最大件数（既定 20、サーバ側上限 50）
 */
export function searchAll(
  keyword: string,
  kinds?: import("./types").SearchKind[],
  limit = 20
) {
  return request<import("./types").PmSearchVO>(
    `${PM}/search${qcQuery({
      keyword,
      types: kinds?.length ? kinds.join(",") : undefined,
      limit: String(limit),
    })}`,
    { method: "GET" }
  );
}

// ===================== Mockups（モックアップ共有） =====================
// 契約：doc/design/pm-mockup.md §3

function numOr(v: unknown, d: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}

function normalizeMockupShare(raw: unknown): MockupShare {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    token: strOrNull(r.token),
    expiresAt: strOrNull(r.expiresAt),
    pinnedVersion: r.pinnedVersion == null ? null : numOr(r.pinnedVersion, 0),
    viewCount: numOr(r.viewCount, 0),
    lastViewedAt: strOrNull(r.lastViewedAt),
  };
}

function normalizeMockupVersion(raw: Record<string, unknown>): MockupVersion {
  return {
    version: numOr(raw.version, 0),
    note: strOrNull(raw.note),
    sizeBytes: numOr(raw.sizeBytes, 0),
    fileCount: numOr(raw.fileCount, 1),
    via: typeof raw.via === "string" ? raw.via : "web",
    createdByName: strOrNull(raw.createdByName),
    createdAt: String(raw.createdAt ?? ""),
  };
}

function normalizeMockup(raw: Record<string, unknown>): Mockup {
  return {
    id: String(raw.id),
    customerId: String(raw.customerId ?? ""),
    projectId: strOrNull(raw.projectId),
    projectName: strOrNull(raw.projectName),
    taskId: strOrNull(raw.taskId),
    taskName: strOrNull(raw.taskName),
    bugId: strOrNull(raw.bugId),
    bugNo: strOrNull(raw.bugNo),
    bugTitle: strOrNull(raw.bugTitle),
    title: String(raw.title ?? ""),
    currentVersion: numOr(raw.currentVersion, 0),
    sizeBytes: numOr(raw.sizeBytes, 0),
    fileCount: numOr(raw.fileCount, 1),
    updatedAt: String(raw.updatedAt ?? ""),
    updatedByName: strOrNull(raw.updatedByName),
    lastVia: strOrNull(raw.lastVia),
    createdBy: String(raw.createdBy ?? ""),
    createdByName: strOrNull(raw.createdByName),
    createdAt: String(raw.createdAt ?? ""),
    share: normalizeMockupShare(raw.share),
    versions: Array.isArray(raw.versions)
      ? (raw.versions as Record<string, unknown>[]).map(normalizeMockupVersion)
      : undefined,
  };
}

/** 一覧：projectId / taskId / bugId のいずれか 1 つ */
export async function listMockups(scope: {
  projectId?: string;
  taskId?: string;
  bugId?: string;
}): Promise<Mockup[]> {
  const raw = await request<unknown>(`${PM}/mockups`, {
    method: "GET",
    params: scope,
  });
  return asArray<Record<string, unknown>>(raw).map(normalizeMockup);
}

/** 詳細（versions 付き、新 → 旧） */
export async function getMockup(id: string): Promise<Mockup> {
  const raw = await request<Record<string, unknown>>(`${PM}/mockups/${id}`, {
    method: "GET",
  });
  return normalizeMockup(raw);
}

/** 公開 / 新しい版を発行（mockupId 指定時）。.html はそのまま、.zip はサーバで展開 */
export async function uploadMockup(req: UploadMockupReq): Promise<Mockup> {
  const formData = new FormData();
  Object.entries(req).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") formData.append(k, v);
  });
  const raw = await request<Record<string, unknown>>(`${PM}/mockups/upload`, {
    method: "POST",
    data: formData,
    requestType: "form",
  });
  return normalizeMockup(raw);
}

export async function updateMockup(
  id: string,
  req: UpdateMockupReq
): Promise<Mockup> {
  const raw = await request<Record<string, unknown>>(`${PM}/mockups/${id}`, {
    method: "PUT",
    data: req,
  });
  return normalizeMockup(raw);
}

export function deleteMockup(id: string) {
  return request<void>(`${PM}/mockups/${id}`, { method: "DELETE" });
}

export function deleteMockupVersion(id: string, version: number) {
  return request<void>(`${PM}/mockups/${id}/versions/${version}`, {
    method: "DELETE",
  });
}

/** 短期署名付きの原文 URL（別ドメイン）。version 省略 = 現行版 */
export function getMockupViewUrl(id: string, version?: number) {
  return request<{ url: string; expiresAt: string }>(
    `${PM}/mockups/${id}/view-url`,
    { method: "GET", params: version ? { version } : undefined }
  );
}

export async function updateMockupShare(
  id: string,
  req: MockupShareReq
): Promise<Mockup> {
  const raw = await request<Record<string, unknown>>(
    `${PM}/mockups/${id}/share`,
    { method: "PUT", data: req }
  );
  return normalizeMockup(raw);
}

export async function regenerateMockupShare(id: string): Promise<Mockup> {
  const raw = await request<Record<string, unknown>>(
    `${PM}/mockups/${id}/share/regenerate`,
    { method: "POST" }
  );
  return normalizeMockup(raw);
}

/**
 * 公開共有ページ用（ログイン不要）。無効リンクは 404 になるため、共通エラートースト／
 * ログイン遷移を出さないよう skipErrorHandler で呼び、呼び出し側で「無効」表示にする。
 */
export function getPublicMockupShare(token: string) {
  return request<PublicMockupShare>(
    `/app/public/pm/mockups/share/${encodeURIComponent(token)}`,
    { method: "GET", skipErrorHandler: true }
  );
}

/** 共有ページの URL（pm-web は複数ドメインで動くため自分の origin で組み立てる） */
export function mockupShareUrl(token: string) {
  return `${window.location.origin}/share/m/${token}`;
}

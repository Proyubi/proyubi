/**
 * pm-mcp core — shared between the stdio entry (index.ts, for local Claude Code
 * dev) and the HTTP entry (http.ts, for the public remote deployment).
 *
 * Holds: the pm-api HTTP client, the R<T> envelope unwrap, and buildServer()
 * which registers all pm_* tools onto a fresh McpServer. Nothing here touches
 * a transport — the entry points wire that up.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerDesignTools } from "./design.js";

// ===== pm-api connection (shared by every tenant) =====

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

// ===== Minimal domain types (mirrors pm-web/src/pm/types.ts, kept local) =====

export interface PmProject {
  id: string;
  name: string;
  customerId?: string;
  customerName?: string;
}

export interface PmCustomer {
  id: string;
  name: string;
  shortName?: string | null;
  active?: boolean;
}

export interface PmMember {
  id: string;
  name: string;
  role?: string | null;
}

export interface PmBug {
  id: string;
  bugNo: string;
  customerId: string;
  title: string;
  severity: string;
  priority: string;
  status: string;
  [key: string]: unknown;
}

type PmTaskType = "task" | "summary" | "milestone";

export interface PmTask {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  start: string;
  end: string;
  type: PmTaskType;
  progress: number;
  assigneeIds: string[];
  levels: string[];
  order: number;
  [key: string]: unknown;
}

/** /internal/pm/mockups の応答（PmMockupInternalController.McpMockup）。 */
interface McpMockup {
  mockup: {
    id: string;
    title: string;
    currentVersion: number;
    sizeBytes?: number;
    fileCount?: number;
    projectName?: string;
    taskName?: string;
    bugNo?: string;
    versions?: { version: number; note?: string; createdAt: string }[];
    [key: string]: unknown;
  };
  appUrl: string;
  shareUrl: string | null;
}

/** /internal/pm/designs の応答（PmDesignInternalController.McpDesign）。 */
export interface McpDesign {
  design: {
    id: string;
    projectId: string;
    projectName?: string;
    taskId?: string;
    taskName?: string;
    title: string;
    format: "excalidraw" | "pen";
    currentRevision: number;
    source?: {
      repo?: string;
      ref?: string;
      path?: string;
      commitSha?: string;
      hash?: string;
    };
    updatedByName?: string;
    updatedAt?: string;
    revision?: {
      revision: number;
      encoding: "json" | "base64";
      sizeBytes: number;
      sha256: string;
      fileName?: string;
      via?: string;
    };
    content?: string;
    revisions?: { revision: number; [key: string]: unknown }[];
    [key: string]: unknown;
  };
  appUrl: string;
}

interface CreateTaskTreeResult {
  idMap: Record<string, string>;
}

// ===== HTTP client =====

class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public method: string,
    public path: string,
  ) {
    super(`pm-api ${method} ${path} -> HTTP ${status}: ${body}`);
    this.name = "HttpError";
  }
}

/** pm-api business error: HTTP 200 but R envelope code != 0. */
class BizError extends Error {
  constructor(
    public code: number,
    msg: string,
  ) {
    super(`pm-api business error (code ${code}): ${msg}`);
    this.name = "BizError";
  }
}

/**
 * One client instance is bound to a single tenant. In HTTP mode we build a
 * fresh client per request from the caller's token; in stdio mode there is one
 * client for the whole process. The api key is shared; the tenant id varies.
 *
 * `userId` (optional) is the human behind the token — pm-api uses it as the
 * 起票者 (reporter) when filing a bug, which is a NOT NULL column. Everything
 * else works without it.
 */
export class PmApiClient {
  constructor(
    private readonly cfg: ApiConfig,
    private readonly tenantId: string,
    private readonly userId?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Api-Key": this.cfg.apiKey,
      "X-Tenant-Id": this.tenantId,
    };
    if (this.userId) h["X-User-Id"] = this.userId;
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown } = {},
  ): Promise<T> {
    const url = `${this.cfg.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, text, method, path);
    }

    if (!text) return undefined as T;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HttpError(
        res.status,
        `non-JSON response body: ${text}`,
        method,
        path,
      );
    }
    // pm-api wraps payloads as R<T> = { code, data, msg }. Unwrap when present.
    return unwrap<T>(parsed);
  }

  listCustomers(query?: string): Promise<PmCustomer[]> {
    const q = query?.trim();
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return this.request<PmCustomer[]>("GET", `/internal/pm/customers${qs}`);
  }

  listMembers(): Promise<PmMember[]> {
    return this.request<PmMember[]>("GET", "/internal/pm/members");
  }

  listBugs(params: Record<string, string | undefined>): Promise<PmBug[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const t = v?.trim();
      if (t) qs.set(k, t);
    }
    return this.request<PmBug[]>("GET", `/internal/pm/bugs?${qs.toString()}`);
  }

  createBug(body: Record<string, unknown>): Promise<PmBug> {
    return this.request<PmBug>("POST", "/internal/pm/bugs", { body });
  }

  listProjects(query?: string): Promise<PmProject[]> {
    const q = query?.trim();
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return this.request<PmProject[]>("GET", `/internal/pm/projects${qs}`);
  }

  getProjectTasks(projectId: string): Promise<PmTask[]> {
    return this.request<PmTask[]>(
      "GET",
      `/internal/pm/projects/${encodeURIComponent(projectId)}/tasks`,
    );
  }

  createTask(body: Record<string, unknown>): Promise<PmTask> {
    return this.request<PmTask>("POST", "/internal/pm/tasks", { body });
  }

  updateTask(id: string, body: Record<string, unknown>): Promise<PmTask> {
    return this.request<PmTask>(
      "PUT",
      `/internal/pm/tasks/${encodeURIComponent(id)}`,
      { body },
    );
  }

  createTaskTree(body: Record<string, unknown>): Promise<CreateTaskTreeResult> {
    return this.request<CreateTaskTreeResult>(
      "POST",
      "/internal/pm/tasks/tree",
      { body },
    );
  }

  publishMockup(body: Record<string, unknown>): Promise<McpMockup> {
    return this.request<McpMockup>("POST", "/internal/pm/mockups", { body });
  }

  listMockups(
    params: Record<string, string | undefined>,
  ): Promise<McpMockup[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const t = v?.trim();
      if (t) qs.set(k, t);
    }
    return this.request<McpMockup[]>(
      "GET",
      `/internal/pm/mockups?${qs.toString()}`,
    );
  }

  // ----- Design Studio（/internal/pm/designs、PmDesignInternalController）。読み書きとも X-User-Id 必須 -----

  /** MCP セッションに人（X-User-Id）が紐付いているか。デザイン系は無人の租户キーでは呼ばない */
  hasUser(): boolean {
    return !!this.userId;
  }

  listDesigns(params: {
    projectId?: string;
    taskId?: string;
  }): Promise<McpDesign[]> {
    const qs = new URLSearchParams();
    if (params.projectId) qs.set("projectId", params.projectId);
    if (params.taskId) qs.set("taskId", params.taskId);
    return this.request<McpDesign[]>(
      "GET",
      `/internal/pm/designs?${qs.toString()}`,
    );
  }

  getDesign(id: string, revision?: number): Promise<McpDesign> {
    const qs = revision ? `?revision=${revision}` : "";
    return this.request<McpDesign>(
      "GET",
      `/internal/pm/designs/${encodeURIComponent(id)}${qs}`,
    );
  }

  createDesign(body: Record<string, unknown>): Promise<McpDesign> {
    return this.request<McpDesign>("POST", "/internal/pm/designs", { body });
  }

  saveDesign(id: string, body: Record<string, unknown>): Promise<McpDesign> {
    return this.request<McpDesign>(
      "PUT",
      `/internal/pm/designs/${encodeURIComponent(id)}/content`,
      { body },
    );
  }

  listDesignComments(id: string, revision?: number): Promise<unknown[]> {
    const qs = revision ? `?revision=${revision}` : "";
    return this.request<unknown[]>(
      "GET",
      `/internal/pm/designs/${encodeURIComponent(id)}/comments${qs}`,
    );
  }

  addDesignComment(
    id: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/internal/pm/designs/${encodeURIComponent(id)}/comments`,
      { body },
    );
  }

  listDesignFrames(id: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      "GET",
      `/internal/pm/designs/${encodeURIComponent(id)}/frames`,
    );
  }

  setDesignFrameStatus(id: string, nodeId: string, status: string): Promise<unknown> {
    return this.request<unknown>(
      "PUT",
      `/internal/pm/designs/${encodeURIComponent(id)}/frames/${encodeURIComponent(nodeId)}/status`,
      { body: { status } },
    );
  }

  linkDesignFrameTask(id: string, nodeId: string, taskId: string): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/internal/pm/designs/${encodeURIComponent(id)}/frames/${encodeURIComponent(nodeId)}/tasks`,
      { body: { taskId } },
    );
  }

  unlinkDesignFrameTask(id: string, nodeId: string, taskId: string): Promise<unknown> {
    return this.request<unknown>(
      "DELETE",
      `/internal/pm/designs/${encodeURIComponent(id)}/frames/${encodeURIComponent(nodeId)}/tasks/${encodeURIComponent(taskId)}`,
    );
  }

  getOverview(): Promise<unknown> {
    return this.request<unknown>("GET", "/internal/pm/overview");
  }

  getWorkload(memberId?: string): Promise<unknown> {
    const m = memberId?.trim();
    const qs = m ? `?memberId=${encodeURIComponent(m)}` : "";
    return this.request<unknown>("GET", `/internal/pm/workload${qs}`);
  }
}

/**
 * Unwrap pm-api's R<T> envelope ({ code, data, msg }) if present.
 * pm-api returns HTTP 200 even for business errors (BizException), encoding the
 * real outcome in `code` (0 = success, non-zero = failure). Treat a non-zero
 * code as an error so failed writes never look like successes.
 */
function unwrap<T>(parsed: unknown): T {
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    ("code" in parsed || "msg" in parsed)
  ) {
    const env = parsed as { code?: unknown; msg?: unknown; data?: T };
    if (typeof env.code === "number" && env.code !== 0) {
      const msg = typeof env.msg === "string" ? env.msg : "unknown error";
      throw new BizError(env.code, msg);
    }
    if ("data" in parsed) {
      return env.data as T;
    }
  }
  return parsed as T;
}

// ===== Tool input schemas (zod raw shapes) =====

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateString = z
  .string()
  .regex(DATE_RE, "must be a YYYY-MM-DD date string");

const taskTypeField = z
  .enum(["task", "summary", "milestone"])
  .optional()
  .describe("Task type. Default 'task'.");

const ownerPartyField = z
  .string()
  .optional()
  .describe("Owner party, e.g. 'client' (貴社) or 'vendor' (弊社).");

const statusField = z
  .enum(["backlog", "todo", "in_progress", "testing", "done", "cancelled"])
  .optional()
  .describe("Board status. Default 'todo'.");

// 工数（工期）フィールド。予定/実績それぞれ「日数 + 最終日の作業時間」。
// pm-api の CreateTaskReq / UpdateTaskReq / TreeNode がそのまま受け取る。
//   *Days  : 手動の工期日数（1d = 24h、整数）。省略時は start/end から派生。
//   *Hours : 最終日の作業時間（0–23.75、0.25 刻みの小数。0/省略 = 最終日も終日扱い）。
const effortShape = {
  plannedEffortDays: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "予定工期・日数 (planned duration in days; 1d = 24h). Omit to derive from start/end.",
    ),
  plannedEffortHours: z
    .number()
    .min(0)
    .max(23.75)
    .optional()
    .describe(
      "予定工期・最終日の作業時間 (planned last-day work hours, 0–23.75 in 0.25 steps; 0/omit = full day).",
    ),
  actualEffortDays: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "実績工期・日数 (actual duration in days; 1d = 24h). Omit to derive from actual dates.",
    ),
  actualEffortHours: z
    .number()
    .min(0)
    .max(23.75)
    .optional()
    .describe(
      "実績工期・最終日の作業時間 (actual last-day work hours, 0–23.75 in 0.25 steps; 0/omit = full day).",
    ),
};

// Shared scalar task fields used by both create and tree-node schemas.
const sharedTaskShape = {
  name: z.string().min(1).describe("Task name."),
  start: dateString.describe("Planned start date (YYYY-MM-DD)."),
  end: dateString.describe(
    "Planned end date (YYYY-MM-DD; milestone: == start).",
  ),
  actualStart: dateString
    .optional()
    .describe(
      "実績開始日 (actual start, YYYY-MM-DD). Omit = 未着手 (not started).",
    ),
  actualEnd: dateString
    .optional()
    .describe(
      "実績終了日 (actual end, YYYY-MM-DD). start only = 着手中 (in progress).",
    ),
  ...effortShape,
  type: taskTypeField,
  ownerParty: ownerPartyField,
  assigneeIds: z.array(z.string()).optional().describe("Assigned member ids."),
  levels: z.array(z.string()).optional().describe("Free-form level labels."),
  description: z
    .string()
    .optional()
    .describe("Task description (rich text / HTML allowed)."),
  status: statusField,
  progress: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Progress 0-100 (authoritative on leaves)."),
  order: z.number().int().optional().describe("Sibling sort order."),
  roadmapVisible: z
    .boolean()
    .optional()
    .describe("Show this task on the roadmap view."),
  roadmapLane: z.string().optional().describe("Roadmap lane option_key."),
  milestoneColor: z
    .string()
    .optional()
    .describe("Milestone color option_key (milestone only)."),
};

const listProjectsShape = {
  query: z
    .string()
    .optional()
    .describe("Fuzzy filter on project name (optional)."),
};

const getProjectTasksShape = {
  projectId: z.string().describe("Project id (uuid)."),
};

const createTaskShape = {
  projectId: z.string().describe("Target project id (uuid)."),
  parentId: z
    .string()
    .nullable()
    .optional()
    .describe("Parent task id (uuid). Omit/null for a root task."),
  ...sharedTaskShape,
};

// Partial-update shape: every field optional; null/omitted = leave unchanged.
const updateTaskShape = {
  id: z.string().describe("Task id to update (uuid)."),
  projectId: z
    .string()
    .optional()
    .describe(
      "Move the whole subtree to this project (uuid). Omit to keep the current project.",
    ),
  name: z.string().min(1).optional().describe("New task name."),
  start: dateString.optional().describe("Planned start date (YYYY-MM-DD)."),
  end: dateString.optional().describe("Planned end date (YYYY-MM-DD)."),
  actualStart: dateString
    .optional()
    .describe(
      "実績開始日 (actual start, YYYY-MM-DD). Use clearActual to unset.",
    ),
  actualEnd: dateString
    .optional()
    .describe(
      "実績終了日 (actual end, YYYY-MM-DD). Use clearActualEnd to unset.",
    ),
  ...effortShape,
  type: taskTypeField,
  ownerParty: ownerPartyField,
  assigneeIds: z
    .array(z.string())
    .optional()
    .describe("Assigned member ids (replaces the list)."),
  levels: z.array(z.string()).optional().describe("Free-form level labels."),
  description: z
    .string()
    .optional()
    .describe("Task description (rich text / HTML allowed)."),
  status: statusField,
  progress: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Progress 0-100 (authoritative on leaves)."),
  order: z.number().int().optional().describe("Sibling sort order."),
  parentId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "New parent task id. Only applied when reparent=true (null with reparent=true moves to root).",
    ),
  reparent: z
    .boolean()
    .optional()
    .describe(
      "Set true to treat parentId as authoritative (enables reparenting).",
    ),
  roadmapVisible: z
    .boolean()
    .optional()
    .describe("Show this task on the roadmap view."),
  roadmapLane: z.string().optional().describe("Roadmap lane option_key."),
  milestoneColor: z
    .string()
    .optional()
    .describe("Milestone color option_key (milestone only)."),
  clearActual: z
    .boolean()
    .optional()
    .describe(
      "true = 実績開始日をクリア（未着手に戻す。実績終了日も外れる）。",
    ),
  clearActualEnd: z
    .boolean()
    .optional()
    .describe("true = 実績終了日のみクリア（着手中に戻す）。"),
  clearEffort: z
    .boolean()
    .optional()
    .describe(
      "true = 予定/実績の工期（日数・時間）をクリアし、期間からの自動算出に戻す。",
    ),
};

const treeNodeSchema = z.object({
  tempId: z
    .string()
    .describe("Caller-assigned temporary id, unique within this request."),
  parentTempId: z
    .string()
    .nullable()
    .optional()
    .describe("tempId of the parent node; omit/null for a top-level node."),
  ...sharedTaskShape,
});

const createTaskTreeShape = {
  projectId: z.string().describe("Target project id (uuid)."),
  parentId: z
    .string()
    .nullable()
    .optional()
    .describe("Existing task to graft the whole tree under (uuid). Optional."),
  nodes: z
    .array(treeNodeSchema)
    .min(1)
    .describe("Nodes in any order; linkage is by tempId/parentTempId."),
};

const listCustomersShape = {
  query: z
    .string()
    .optional()
    .describe(
      "Fuzzy filter on customer/product name or short name (optional).",
    ),
};

const listMembersShape = {};

// ===== Bug (品質管理 / バグ票) =====

const bugLevelField = z
  .enum(["high", "medium", "low"])
  .optional()
  .describe("high / medium / low. Default 'medium'.");

const bugStatusField = z
  .enum(["open", "in_progress", "resolved", "verifying", "closed", "wontfix"])
  .optional()
  .describe("Bug status. Default 'open'.");

const createBugShape = {
  customerId: z
    .string()
    .describe(
      "製品/顧客 id (uuid) the bug is filed under. BUG-xxx numbering is per product. Resolve it with pm_list_customers (or the customerId on pm_list_projects).",
    ),
  title: z.string().min(1).describe("タイトル — bug title (required)."),
  description: z
    .string()
    .optional()
    .describe(
      "内容 — reproduction steps / expected / actual. Plain text or HTML.",
    ),
  severity: bugLevelField.describe(
    "影響度 (severity): high/medium/low. Default 'medium'.",
  ),
  priority: bugLevelField.describe(
    "優先度 (priority): high/medium/low. Default 'medium'.",
  ),
  status: bugStatusField,
  environment: z
    .string()
    .optional()
    .describe("環境 — free text, e.g. 'Chrome / dev'."),
  assigneeMemberId: z
    .string()
    .optional()
    .describe("担当者 member id (uuid) from pm_list_members. Omit = 未割当."),
  projectId: z
    .string()
    .optional()
    .describe(
      "紐付けプロジェクト/版本 id (uuid). Must belong to customerId. Omit = 製品全体.",
    ),
  taskId: z
    .string()
    .optional()
    .describe("紐付けタスク id (uuid) from pm_get_project_tasks. Optional."),
  reportedOn: dateString
    .optional()
    .describe("起票日 (YYYY-MM-DD). Omit = today."),
};

const listBugsShape = {
  customerId: z.string().describe("製品/顧客 id (uuid) to list bugs for."),
  status: bugStatusField,
  severity: bugLevelField,
  priority: bugLevelField,
  assigneeId: z
    .string()
    .optional()
    .describe("Filter by 担当 member id (uuid)."),
  keyword: z
    .string()
    .optional()
    .describe("Fuzzy match on bug no / title / description."),
};

const publishMockupShape = {
  filePath: z
    .string()
    .optional()
    .describe(
      "Absolute path to a local mockup (stdio mode only): a single .html file, a .zip (e.g. a Claude Design export with index.html + img/), or a folder containing index.html and its assets. Preferred: the server reads the files itself, so you do NOT need to echo the HTML. Exactly one of filePath / html.",
    ),
  html: z
    .string()
    .optional()
    .describe(
      "The full HTML text (≤ 1MB). Only when filePath is unavailable (remote/HTTP mode). Exactly one of filePath / html.",
    ),
  title: z
    .string()
    .optional()
    .describe(
      "Display title. Omit to use the HTML <title>. When adding a new version, a given title renames the mockup.",
    ),
  projectId: z.string().optional().describe("Attach to a project (uuid)."),
  taskId: z
    .string()
    .optional()
    .describe("Attach to a task (uuid). Its project is derived automatically."),
  bugId: z.string().optional().describe("Attach to a bug (uuid)."),
  mockupId: z
    .string()
    .optional()
    .describe(
      "Existing mockup id → publish as a NEW VERSION of it (same link; projectId/taskId/bugId are ignored). Find it with pm_list_mockups.",
    ),
  note: z
    .string()
    .optional()
    .describe("What changed in this version (shown in the version list)."),
  share: z
    .boolean()
    .optional()
    .describe(
      "true = also turn on the external share link (30 days) if it is not on yet, and return shareUrl. Only when the user asks for a share link.",
    ),
};

const listMockupsShape = {
  projectId: z.string().optional().describe("List mockups of a project."),
  taskId: z.string().optional().describe("List mockups attached to a task."),
  bugId: z.string().optional().describe("List mockups attached to a bug."),
};

const getRisksShape = {};

const getWorkloadShape = {
  memberId: z
    .string()
    .optional()
    .describe("Filter to one member id (uuid). Omit for all members."),
};

// ===== Helpers =====

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const text = err instanceof Error ? err.message : String(err);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Drop undefined/null-valued keys so we don't send noise to the API.
 * Callers may pass `parentId: null` / `parentTempId: null` to mean "root /
 * top-level"; the pm-api treats an absent key the same way, so stripping null
 * keeps the payload clean and avoids any null-vs-absent ambiguity downstream.
 */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** pm-api の上限（proyubi.pm.mockup.max-bytes / max-zip-bytes / max-total-bytes / max-files）と同じ */
const MOCKUP_MAX_BYTES = 5 * 1024 * 1024;
const MOCKUP_ZIP_MAX_BYTES = 50 * 1024 * 1024;
const MOCKUP_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
const MOCKUP_MAX_FILES = 500;
/** html 直渡しの上限（モデルが全文を出力するコストと JSON 経由の転送を考えて小さめ） */
const MOCKUP_INLINE_MAX_BYTES = 1024 * 1024;
/** フォルダ公開で送る拡張子（pm-api の PmMockupBundle のホワイトリストと同じ。それ以外はサーバでも捨てる） */
const MOCKUP_ASSET_EXTS = new Set(
  "html htm css js mjs json map txt md csv xml svg png jpg jpeg gif webp avif ico bmp woff woff2 ttf otf mp4 webm mp3 wav ogg pdf wasm glb gltf".split(
    " ",
  ),
);
/** フォルダ公開で潜らないディレクトリ */
const MOCKUP_SKIP_DIRS = new Set(["node_modules", ".git", "__MACOSX"]);

type MockupSource =
  | { html: string }
  | { zipBase64: string }
  | { files: { path: string; base64: string }[] };

/** ローカルの .html / .zip / フォルダを読む（stdio モード専用）。入口・パスの検査はサーバ側。 */
async function readMockupSource(filePath: string): Promise<MockupSource> {
  const abs = resolve(filePath);
  const st = await stat(abs);
  if (st.isDirectory()) {
    return { files: await readMockupDir(abs) };
  }
  const ext = extname(abs).toLowerCase();
  if (ext === ".zip") {
    if (st.size > MOCKUP_ZIP_MAX_BYTES) {
      throw new Error(
        `Zip is ${(st.size / 1024 / 1024).toFixed(1)}MB; the limit is 50MB.`,
      );
    }
    return { zipBase64: (await readFile(abs)).toString("base64") };
  }
  if (ext !== ".html" && ext !== ".htm") {
    throw new Error(`Not an .html / .zip file or a folder: ${abs}`);
  }
  if (st.size > MOCKUP_MAX_BYTES) {
    throw new Error(
      `File is ${(st.size / 1024 / 1024).toFixed(1)}MB; the limit is 5MB. Move images etc. out into files next to it and publish the folder (or a .zip) instead.`,
    );
  }
  return { html: await readFile(abs, "utf8") };
}

/** フォルダ配下を再帰的に読む（パスはフォルダからの相対・/ 区切り）。 */
async function readMockupDir(
  root: string,
): Promise<{ path: string; base64: string }[]> {
  const out: { path: string; base64: string }[] = [];
  let total = 0;
  const walk = async (dir: string) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!MOCKUP_SKIP_DIRS.has(ent.name)) await walk(full);
        continue;
      }
      if (
        !ent.isFile() ||
        !MOCKUP_ASSET_EXTS.has(extname(ent.name).slice(1).toLowerCase())
      ) {
        continue;
      }
      const data = await readFile(full);
      total += data.length;
      if (out.length >= MOCKUP_MAX_FILES) {
        throw new Error(`Folder has more than ${MOCKUP_MAX_FILES} files.`);
      }
      if (total > MOCKUP_TOTAL_MAX_BYTES) {
        throw new Error("Folder is over 100MB in total.");
      }
      out.push({
        path: relative(root, full).split(sep).join("/"),
        base64: data.toString("base64"),
      });
    }
  };
  await walk(root);
  if (out.length === 0) {
    throw new Error(`No publishable files (html / images / css / js) in ${root}`);
  }
  return out;
}

/** モデルに返す要約（全版・全フィールドは返さない）。 */
function summarizeMockup(m: McpMockup) {
  return compact({
    mockupId: m.mockup.id,
    title: m.mockup.title,
    version: m.mockup.currentVersion,
    sizeBytes: m.mockup.sizeBytes,
    fileCount: m.mockup.fileCount,
    project: m.mockup.projectName,
    task: m.mockup.taskName,
    bug: m.mockup.bugNo,
    appUrl: m.appUrl,
    shareUrl: m.shareUrl,
  });
}

// ===== Server wiring =====

/**
 * Build a fresh McpServer with all pm_* tools bound to the given (already
 * tenant-scoped) client. Callers connect it to whatever transport they use.
 */
export interface BuildServerOptions {
  /** stdio（ローカル）だけ true：pm_publish_mockup の filePath でローカルファイルを読める */
  allowLocalFiles?: boolean;
  /** stdio のデザイン取り込み / 書き出しを許すディレクトリ（PM_DESIGN_ROOT）。未設定ならデザインのファイル操作不可 */
  designRoot?: string;
}

export function buildServer(
  client: PmApiClient,
  opts: BuildServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: "proyubi-mcp",
    version: "0.3.0",
  });

  server.registerTool(
    "pm_list_customers",
    {
      title: "List PM customers/products",
      description:
        "List 顧客/製品 (pm_customer) — the top level above projects. Use it to resolve a product name to its id, which bug filing (pm_create_bug) requires.",
      inputSchema: listCustomersShape,
    },
    async ({ query }) => {
      try {
        return jsonResult(await client.listCustomers(query));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_list_members",
    {
      title: "List PM members",
      description:
        "List the tenant's PM members (id, name, role). Use it to resolve a person's name to the member id needed by assigneeIds (tasks) or assigneeMemberId (bugs).",
      inputSchema: listMembersShape,
    },
    async () => {
      try {
        return jsonResult(await client.listMembers());
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_list_projects",
    {
      title: "List PM projects",
      description:
        "List projects from the PM system, optionally filtered by a fuzzy name query. Use it to resolve a project name to its id.",
      inputSchema: listProjectsShape,
    },
    async ({ query }) => {
      try {
        return jsonResult(await client.listProjects(query));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_get_project_tasks",
    {
      title: "Get project tasks",
      description:
        "Fetch the task list/tree for a project. Use it to find a parent task id or inspect ordering before inserting.",
      inputSchema: getProjectTasksShape,
    },
    async ({ projectId }) => {
      try {
        return jsonResult(await client.getProjectTasks(projectId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_create_task",
    {
      title: "Create a PM task",
      description:
        "Create a single task in a project. Dates are YYYY-MM-DD. Rollup/progress are recomputed by pm-api.",
      inputSchema: createTaskShape,
    },
    async (args) => {
      try {
        const body = compact(args as Record<string, unknown>);
        return jsonResult(await client.createTask(body));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_update_task",
    {
      title: "Update a PM task",
      description:
        "Partially update an existing task (null/omitted fields stay unchanged). Pass id + only the fields to change — e.g. { id, name } to rename. Rollup/progress/cascade are recomputed by pm-api.",
      inputSchema: updateTaskShape,
    },
    async ({ id, ...rest }) => {
      try {
        const body = compact(rest as Record<string, unknown>);
        return jsonResult(await client.updateTask(id, body));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_create_task_tree",
    {
      title: "Create a PM task tree",
      description:
        "Bulk-create a WBS task tree in one transaction. Nodes link via tempId/parentTempId; returns { idMap } mapping each tempId to its created task id.",
      inputSchema: createTaskTreeShape,
    },
    async ({ projectId, parentId, nodes }) => {
      try {
        const body = compact({
          projectId,
          parentId,
          nodes: nodes.map((n) => compact(n as Record<string, unknown>)),
        });
        return jsonResult(await client.createTaskTree(body));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_create_bug",
    {
      title: "File a PM bug (バグ起票)",
      description:
        "File a bug ticket (バグ票) under a product/customer — the same thing the 品質管理 → バグ起票 form does. Required: customerId + title. Optional: description (再現手順/期待/実際), severity/priority (high|medium|low), environment, assigneeMemberId, projectId (版本; omit = 製品全体), taskId, reportedOn. pm-api assigns the BUG-xxx number (per product) and records the token's user as 起票者. Resolve ids first with pm_list_customers / pm_list_projects / pm_list_members / pm_get_project_tasks.",
      inputSchema: createBugShape,
    },
    async (args) => {
      try {
        const body = compact(args as Record<string, unknown>);
        return jsonResult(await client.createBug(body));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_list_bugs",
    {
      title: "List PM bugs",
      description:
        "List bug tickets for a product/customer, newest number first, with optional status/severity/priority/assignee/keyword filters. Use it to check for a duplicate before filing, or to confirm what was just filed.",
      inputSchema: listBugsShape,
    },
    async (args) => {
      try {
        const { customerId, ...rest } = args;
        return jsonResult(
          await client.listBugs({
            customerId,
            ...(rest as Record<string, string | undefined>),
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_publish_mockup",
    {
      title: "Publish an HTML mockup to PM (モックアップ公開)",
      description:
        "Publish an interactive HTML mockup (e.g. one you just generated) to PM and attach it to a project / task / bug, so clients and sales can view it on our own domain instead of a claude.ai link. " +
        (opts.allowLocalFiles
          ? "Pass filePath — a local .html, a .zip, or a folder with index.html + assets (relative paths like img/a.png work) — do not paste the HTML. "
          : "This server is remote: pass the HTML text in `html` (≤ 1MB, self-contained); filePath is not available. ") +
        "New mockup: give taskId (preferred), bugId or projectId; resolve ids with pm_list_projects / pm_get_project_tasks / pm_list_bugs. " +
        "Revised mockup: pass mockupId (from pm_list_mockups or a previous publish) to add a new version under the same link. " +
        "Limits: entry HTML ≤ 5MB; zip ≤ 50MB; all files ≤ 100MB / 500 files. The entry page is index.html (or the only .html at the root). CDN scripts are fine; Claude-artifact-only runtime APIs (window.claude.*) will not work. " +
        "Returns appUrl (open inside PM) and, when share=true or sharing is already on, shareUrl (no login needed).",
      inputSchema: publishMockupShape,
    },
    async ({ filePath, html, share, ...rest }) => {
      try {
        if ((filePath ? 1 : 0) + (html ? 1 : 0) !== 1) {
          throw new Error("Pass exactly one of filePath / html.");
        }
        let source: MockupSource;
        if (filePath) {
          if (!opts.allowLocalFiles) {
            throw new Error(
              "filePath is only available when pm-mcp runs locally (stdio). Pass the HTML text in `html` instead.",
            );
          }
          source = await readMockupSource(filePath);
        } else {
          const content = html as string;
          if (Buffer.byteLength(content, "utf8") > MOCKUP_INLINE_MAX_BYTES) {
            throw new Error(
              "html is over 1MB. Use the local (stdio) pm-mcp with filePath, or upload the file from the PM screen.",
            );
          }
          source = { html: content };
        }
        const body = compact({
          ...(rest as Record<string, unknown>),
          ...source,
          share,
        });
        return jsonResult(summarizeMockup(await client.publishMockup(body)));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_list_mockups",
    {
      title: "List PM mockups",
      description:
        "List HTML mockups attached to a task, bug or project (pass exactly one), newest update first. Use it to find the mockupId before publishing a revised version.",
      inputSchema: listMockupsShape,
    },
    async (args) => {
      try {
        const list = await client.listMockups(
          args as Record<string, string | undefined>,
        );
        return jsonResult(list.map(summarizeMockup));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_get_risks",
    {
      title: "Get PM risk overview",
      description:
        "Server-computed risk overview across all projects (scope=all). Returns KPIs plus a riskItems list, each task flagged with one or more risks — overdue (期限切れ), behind (進捗遅れ vs. expected), blocked (FS-dependency predecessor not done), due-soon (期限間近), unassigned (担当未割当) — ordered by priority, with overdueDays/daysUntilDue. Also returns projectHealth and upcoming milestones. Use this to judge whether the schedule is reasonable and to explain delays/blockers; the rules are computed by pm-api, not guessed.",
      inputSchema: getRisksShape,
    },
    async () => {
      try {
        return jsonResult(await client.getOverview());
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_get_workload",
    {
      title: "Get member workload",
      description:
        "Cross-project member workload: every assigned task (task id, name, project/customer, start/end, progress, actual dates) flattened so you can aggregate per member. Use it to spot over-allocation or time overlaps for the same assignee (e.g. one person with multiple concurrent tasks). Optionally filter to a single memberId.",
      inputSchema: getWorkloadShape,
    },
    async ({ memberId }) => {
      try {
        return jsonResult(await client.getWorkload(memberId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // デザインボード（業務フロー白板 / 画面デザイン .pen）：pm_list_designs / pm_get_design / pm_save_design / 審査コメント / 画框
  registerDesignTools(server, client, {
    allowLocalFiles: opts.allowLocalFiles,
    designRoot: opts.designRoot,
  });

  return server;
}

/**
 * 起動時の `PM_DEFAULT_USER_ID` 健全性チェック。
 *
 * この値は `X-User-Id` としてそのまま pm-api に渡り、サーバ側の
 * `PmTeamScopeService#visibleTeamIds()` が `platform_tenant_user.id` として解決する。
 * ところが `pm_list_members` が返す ID は **PM 成員表の id** で、両者は別の ID 空間。
 * 成員 ID を誤って設定すると `findRole()` が null を返し、owner であっても
 * 「所属チーム 0 件の member」に静かに降格して、以後あらゆる project 系呼び出しが
 * `404 无权访问该团队的数据` になる（tenant 系の `pm_list_members` だけは通るため
 * 「接続できているのに何も見えない」という紛らわしい状態になる）。
 *
 * 判定は挙動ベース。`X-User-Id` 有り／無しで projects 一覧を引き比べる:
 * userId 無し = 純機械コンテキスト = 可視域無制限（サーバ実装より）。
 *
 *   無しで見える && 有りで 0 件  →  ID が別空間＝設定ミス。即座に落とす。
 *
 * ネットワーク不調で誤検知して起動不能になるのを避けるため、
 * 例外時は警告だけ出して通す（判定できないので落とさない）。
 */
export async function verifyUserScope(
  api: ApiConfig,
  tenantId: string,
  userId: string,
): Promise<void> {
  const asUser = new PmApiClient(api, tenantId, userId);
  const asMachine = new PmApiClient(api, tenantId);

  let seenAsUser: number;
  let seenAsMachine: number;
  try {
    const [u, m] = await Promise.all([
      asUser.listProjects(),
      asMachine.listProjects(),
    ]);
    seenAsUser = u.length;
    seenAsMachine = m.length;
  } catch (err) {
    console.error(
      "[pm-mcp] PM_DEFAULT_USER_ID の検証をスキップしました（pm-api に到達できません）:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  if (seenAsUser > 0 || seenAsMachine === 0) {
    return; // 正常、または判定材料なし（テナントにプロジェクトが 1 件も無い）
  }

  console.error(
    [
      "",
      "[pm-mcp] 設定エラー: PM_DEFAULT_USER_ID がチーム可視域を解決できていません。",
      "",
      `  PM_DEFAULT_USER_ID = ${userId}`,
      `  PM_DEFAULT_TENANT_ID = ${tenantId}`,
      `  projects: X-User-Id 無し ${seenAsMachine} 件 / 有り ${seenAsUser} 件`,
      "",
      "  この ID は platform_tenant_user.id である必要があります。",
      "  pm_list_members が返す ID は PM 成員表の id（assigneeIds 用）で、別物です。",
      "  正しい値は PM 画面にログインした状態で GET /api/app/auth/me の",
      "  availableTeams[].tenantUserId から取得できます。",
      "",
      "  このまま起動すると project 系の全呼び出しが 404「无权访问该团队的数据」になるため、",
      "  静かに降格させず停止します。",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

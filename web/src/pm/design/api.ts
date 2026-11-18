// Design Studio の service 層：webapi /app/pm/designs（PmDesignController）。
// 保存（content）は skipErrorHandler で呼び、409 / 400 を画面側で扱う（共通 toast で草稿を失わせない）。
import { request } from '@umijs/max';

const BASE = '/app/pm/designs';

export type DesignFormat = 'excalidraw' | 'pen';

export interface DesignSource {
  repo?: string | null;
  ref?: string | null;
  path?: string | null;
  commitSha?: string | null;
  hash?: string | null;
}

export interface DesignRevision {
  revision: number;
  encoding: 'json' | 'base64';
  sizeBytes: number;
  sha256: string;
  fileName?: string | null;
  note?: string | null;
  via?: 'web' | 'mcp' | null;
  createdByName?: string | null;
  createdAt?: string | null;
}

export interface Design {
  id: string;
  projectId: string;
  projectName?: string | null;
  taskId?: string | null;
  taskName?: string | null;
  title: string;
  format: DesignFormat;
  currentRevision: number;
  source?: DesignSource | null;
  createdByName?: string | null;
  createdAt?: string | null;
  updatedByName?: string | null;
  updatedAt?: string | null;
  /** 詳細のみ：表示中の修訂と原文（excalidraw = JSON、pen = base64） */
  revision?: DesignRevision;
  content?: string;
  revisions?: DesignRevision[];
}

export interface DesignComment {
  id: string;
  designId: string;
  revision: number;
  /** .pen は画框の node_id（null = 版全体） */
  elementId?: string | null;
  body: string;
  resolved: boolean;
  resolvedByName?: string | null;
  resolvedAt?: string | null;
  authorName?: string | null;
  via?: string | null;
  mine: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface SourceInput {
  repo?: string;
  ref?: string;
  path?: string;
  commitSha?: string;
}

export interface CreateDesignReq {
  projectId: string;
  taskId?: string;
  title?: string;
  format: DesignFormat;
  content?: string;
  contentBase64?: string;
  fileName?: string;
  note?: string;
  source?: SourceInput;
}

export interface SaveDesignReq {
  expectedRevision: number;
  content?: string;
  contentBase64?: string;
  fileName?: string;
  note?: string;
  source?: SourceInput;
  baseSourceHash?: string;
}

/** 業務エラー（R.code）。409 = 他の保存が先行、400 = 内容不正 */
export class DesignApiError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = 'DesignApiError';
  }
}

/** requestErrorConfig が投げる BizError / HTTP エラーを code 付きの DesignApiError に */
export function toDesignError(e: unknown): DesignApiError {
  if (e instanceof DesignApiError) return e;
  const err = e as {
    name?: string;
    message?: string;
    info?: { code?: number; msg?: string };
    response?: { status?: number };
  };
  if (err?.info && typeof err.info.code === 'number') {
    return new DesignApiError(err.info.code, err.info.msg || err.message || '');
  }
  const status = err?.response?.status;
  if (typeof status === 'number') {
    return new DesignApiError(status, err.message || `HTTP ${status}`);
  }
  return new DesignApiError(0, err?.message || 'network');
}

export function listDesigns(scope: { projectId?: string; taskId?: string }) {
  return request<Design[]>(BASE, { method: 'GET', params: scope }).then((r) =>
    Array.isArray(r) ? r : [],
  );
}

/** 詳細。読み込み失敗は画面で明示するため skipErrorHandler */
export async function getDesign(
  id: string,
  revision?: number,
  opts?: { content?: boolean },
): Promise<Design> {
  try {
    return await request<Design>(`${BASE}/${id}`, {
      method: 'GET',
      params: {
        ...(revision ? { revision } : {}),
        ...(opts?.content === false ? { content: false } : {}),
      },
      skipErrorHandler: true,
    });
  } catch (e) {
    throw toDesignError(e);
  }
}

export async function createDesign(req: CreateDesignReq): Promise<Design> {
  try {
    return await request<Design>(BASE, {
      method: 'POST',
      data: req,
      skipErrorHandler: true,
    });
  } catch (e) {
    throw toDesignError(e);
  }
}

/** 新修訂の保存。expectedRevision が古ければ DesignApiError(409) */
export async function saveDesign(
  id: string,
  req: SaveDesignReq,
): Promise<Design> {
  try {
    return await request<Design>(`${BASE}/${id}/content`, {
      method: 'PUT',
      data: req,
      skipErrorHandler: true,
    });
  } catch (e) {
    throw toDesignError(e);
  }
}

export function updateDesignMeta(
  id: string,
  req: { title?: string; taskId?: string; clearTask?: boolean },
) {
  return request<Design>(`${BASE}/${id}`, { method: 'PUT', data: req });
}

export function deleteDesign(id: string) {
  return request<void>(`${BASE}/${id}`, { method: 'DELETE' });
}

export function listDesignComments(id: string, revision?: number) {
  return request<DesignComment[]>(`${BASE}/${id}/comments`, {
    method: 'GET',
    params: revision ? { revision } : undefined,
  }).then((r) => (Array.isArray(r) ? r : []));
}

export function addDesignComment(
  id: string,
  revision: number,
  body: string,
  elementId?: string,
) {
  return request<DesignComment>(`${BASE}/${id}/comments`, {
    method: 'POST',
    data: { revision, body, elementId },
  });
}

export function editDesignComment(commentId: string, body: string) {
  return request<DesignComment>(`${BASE}/comments/${commentId}`, {
    method: 'PUT',
    data: { body },
  });
}

export function resolveDesignComment(commentId: string, resolved: boolean) {
  return request<DesignComment>(`${BASE}/comments/${commentId}/resolve`, {
    method: 'PUT',
    data: { resolved },
  });
}

export function deleteDesignComment(commentId: string) {
  return request<void>(`${BASE}/comments/${commentId}`, { method: 'DELETE' });
}

// ------------------------------------------------------------------ .pen 画框・原文

export type FrameStatus = 'draft' | 'review' | 'changes' | 'approved';

export const FRAME_STATUSES: FrameStatus[] = [
  'draft',
  'review',
  'changes',
  'approved',
];

export interface DesignFrameTask {
  taskId: string;
  name: string;
  status?: string | null;
}

export interface DesignFrame {
  designId: string;
  designTitle: string;
  nodeId: string;
  name: string;
  sortOrder: number;
  reviewStatus: FrameStatus;
  statusByName?: string | null;
  statusAt?: string | null;
  lastRevision: number;
  /** 最新修訂に存在しない（行は残っている） */
  removed: boolean;
  tasks: DesignFrameTask[];
  openComments: number;
}

export function listDesignFrames(id: string) {
  return request<DesignFrame[]>(`${BASE}/${id}/frames`, {
    method: 'GET',
  }).then((r) => (Array.isArray(r) ? r : []));
}

/** タスクに紐付いた画框（タスク詳細のデザイン欄） */
export function listFramesByTask(taskId: string) {
  return request<DesignFrame[]>(`${BASE}/frames`, {
    method: 'GET',
    params: { taskId },
  }).then((r) => (Array.isArray(r) ? r : []));
}

const frameUrl = (id: string, nodeId: string) =>
  `${BASE}/${id}/frames/${encodeURIComponent(nodeId)}`;

export function setFrameStatus(
  id: string,
  nodeId: string,
  status: FrameStatus,
) {
  return request<DesignFrame>(`${frameUrl(id, nodeId)}/status`, {
    method: 'PUT',
    data: { status },
  });
}

export function linkFrameTask(id: string, nodeId: string, taskId: string) {
  return request<DesignFrame>(`${frameUrl(id, nodeId)}/tasks`, {
    method: 'POST',
    data: { taskId },
  });
}

export function unlinkFrameTask(id: string, nodeId: string, taskId: string) {
  return request<DesignFrame>(`${frameUrl(id, nodeId)}/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

/** webapi を fetch で直接呼ぶときの認証ヘッダー（umi request の interceptor と同じ値） */
export function apiAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('pullcord_token');
  return {
    ...(token ? { satoken: token } : {}),
    'X-Lang': localStorage.getItem('umi_locale') || 'ja-JP',
    'X-App-Code': 'pm-web-jp',
  };
}

export const apiBase = () => process.env.API_BASE_URL || '';

/** .pen 原文（無改変バイト）。OpenPencil ビューアへ渡す。バイナリなので umi request ではなく fetch */
export async function fetchPenSource(
  id: string,
  revision?: number,
): Promise<ArrayBuffer> {
  return (await fetchPenSourceRev(id, revision)).data;
}

/** 原文と、その修訂番号（revision 省略時の「最新」が何版だったか） */
export async function fetchPenSourceRev(
  id: string,
  revision?: number,
): Promise<{ data: ArrayBuffer; revision: number }> {
  const q = revision ? `?revision=${revision}` : '';
  const res = await fetch(`${apiBase()}${BASE}/${id}/source${q}`, {
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new DesignApiError(res.status, `HTTP ${res.status}`);
  // 業務エラー（404 / 403 など）は HTTP 200 + R の JSON で返る
  if ((res.headers.get('Content-Type') || '').includes('json')) {
    const r = (await res.json()) as { code?: number; msg?: string };
    throw new DesignApiError(r.code ?? 500, r.msg || 'error');
  }
  return {
    data: await res.arrayBuffer(),
    revision: Number(res.headers.get('X-Design-Revision')) || revision || 0,
  };
}

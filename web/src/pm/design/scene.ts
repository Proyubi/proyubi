/**
 * Design Studio の場面・ファイル処理（純関数、Excalidraw 本体に依存しない）。
 * 保存前にサーバ（PmDesignContent）と同じ規則で検証し、利用者がその場で直せるエラーを返す。
 * 設計：work/design-studio/requirements.md §4.2 / §4.3
 */

/** 画像込みの場面 JSON 上限（UTF-8）。サーバ proyubi.pm.design.max-bytes と同じ */
export const DESIGN_MAX_BYTES = 10 * 1024 * 1024;
/** .pen 原文の上限（サーバ proyubi.pm.design.max-pen-bytes と同じ） */
export const PEN_MAX_BYTES = 32 * 1024 * 1024;
/** 画像 1 枚の上限（復号後） */
export const DESIGN_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DESIGN_MAX_ELEMENTS = 5000;

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** 保存する appState（表示設定のみ。協作者・選択・ダイアログなど瞬間状態は保存しない） */
const APP_STATE_KEYS = [
  'viewBackgroundColor',
  'gridSize',
  'gridStep',
  'gridModeEnabled',
  'theme',
  'zoom',
  'scrollX',
  'scrollY',
  'name',
  'objectsSnapModeEnabled',
];
/** 任意 URL / HTML を描画しうる要素型（保存不可） */
const FORBIDDEN_TYPES = ['embeddable', 'iframe'];

export type SceneErrorCode =
  | 'size'
  | 'elements'
  | 'embeddable'
  | 'image-missing'
  | 'image-type'
  | 'image-size';

export interface SceneData {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

type Element = { id?: unknown; type?: unknown; [k: string]: unknown };

/** UTF-8 バイト数（サーバ側上限と同じ基準。サロゲートペアは 4 バイト） */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Excalidraw の elements / appState / files を保存形 JSON にする。
 * 削除済み要素と未参照の画像は落とし、画像は data URL のまま含める（ID だけ残して再オープンで消える事態を防ぐ）。
 */
export function serializeScene(
  elements: readonly Element[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
):
  | { ok: true; json: string; bytes: number }
  | { ok: false; error: { code: SceneErrorCode; detail?: string } } {
  const live = elements.filter((e) => !e.isDeleted);
  if (live.length > DESIGN_MAX_ELEMENTS) {
    return { ok: false, error: { code: 'elements' } };
  }
  const forbidden = live.find((e) => FORBIDDEN_TYPES.includes(String(e.type)));
  if (forbidden) {
    return {
      ok: false,
      error: { code: 'embeddable', detail: String(forbidden.type) },
    };
  }

  const outFiles: Record<string, unknown> = {};
  const fileIds = [
    ...new Set(
      live
        .filter((e) => e.type === 'image' && typeof e.fileId === 'string')
        .map((e) => e.fileId as string),
    ),
  ].sort();
  for (const id of fileIds) {
    const f = files[id] as Record<string, unknown> | undefined;
    if (!f) return { ok: false, error: { code: 'image-missing', detail: id } };
    const mime = String(f.mimeType ?? '');
    const dataURL = String(f.dataURL ?? '');
    const prefix = `data:${mime};base64,`;
    if (!IMAGE_MIME.includes(mime) || !dataURL.startsWith(prefix)) {
      return { ok: false, error: { code: 'image-type', detail: mime || id } };
    }
    const b64 = dataURL.length - prefix.length;
    const decoded = Math.floor((b64 * 3) / 4);
    if (decoded > DESIGN_MAX_IMAGE_BYTES) {
      return { ok: false, error: { code: 'image-size', detail: id } };
    }
    outFiles[id] = {
      id,
      mimeType: mime,
      dataURL,
      created: typeof f.created === 'number' ? f.created : 0,
    };
  }

  const outApp: Record<string, unknown> = {};
  for (const key of APP_STATE_KEYS) {
    const v = appState[key];
    if (v === null || v === undefined) continue;
    if (key === 'zoom') {
      const value = (v as { value?: unknown }).value;
      outApp.zoom = { value: typeof value === 'number' ? value : 1 };
    } else if (['string', 'number', 'boolean'].includes(typeof v)) {
      outApp[key] = v;
    }
  }

  const json = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements: live,
    appState: outApp,
    files: outFiles,
  });
  const bytes = utf8Length(json);
  if (bytes > DESIGN_MAX_BYTES) return { ok: false, error: { code: 'size' } };
  return { ok: true, json, bytes };
}

/** サーバの場面 JSON を Excalidraw の initialData 形に。読めなければ ok:false（空白板で開いて上書きしない）。 */
export function parseScene(
  content: string,
): { ok: true; scene: SceneData } | { ok: false } {
  try {
    const root = JSON.parse(content);
    if (!root || typeof root !== 'object' || Array.isArray(root))
      return { ok: false };
    if (!Array.isArray(root.elements)) return { ok: false };
    return {
      ok: true,
      scene: {
        elements: root.elements,
        appState:
          root.appState && typeof root.appState === 'object'
            ? root.appState
            : {},
        files: root.files && typeof root.files === 'object' ? root.files : {},
      },
    };
  } catch {
    return { ok: false };
  }
}

/**
 * 未保存判定用の軽量な版数。要素の version 合計 + 個数 + 画像数。
 * 選択・スクロールだけの変化では変わらない（onChange は描画ごとに呼ばれるため安価にする）。
 */
export function sceneVersion(
  elements: readonly Element[],
  files: Record<string, unknown>,
): string {
  let sum = 0;
  for (const e of elements) {
    sum +=
      (typeof e.version === 'number' ? e.version : 0) + (e.isDeleted ? 0.5 : 0);
  }
  return `${elements.length}:${sum}:${Object.keys(files).length}`;
}

// ------------------------------------------------------------------ .pen 原文

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 取り込むファイルの形式判定（拡張子）と上限確認 */
export function detectDesignFile(
  name: string,
  size: number,
):
  | { ok: true; format: 'excalidraw' | 'pen' }
  | { ok: false; error: 'type' | 'size' } {
  const format = /\.pen$/i.test(name)
    ? 'pen'
    : /\.(excalidraw|json)$/i.test(name)
      ? 'excalidraw'
      : null;
  if (!format) return { ok: false, error: 'type' };
  if (size > (format === 'pen' ? PEN_MAX_BYTES : DESIGN_MAX_BYTES)) {
    return { ok: false, error: 'size' };
  }
  return { ok: true, format };
}

export type ReadFileError = 'type' | 'size' | 'parse' | SceneErrorCode;

/**
 * 取り込むファイルを読む。pen は原文バイトを base64 のまま（無改変）、
 * excalidraw は場面として読めることと保存規則を満たすことを確認して保存形 JSON にする。
 */
export async function readDesignFile(file: File): Promise<
  | {
      ok: true;
      format: 'pen';
      contentBase64: string;
      sha256: string;
      fileName: string;
    }
  | { ok: true; format: 'excalidraw'; content: string; fileName: string }
  | { ok: false; error: ReadFileError }
> {
  const kind = detectDesignFile(file.name, file.size);
  if (!kind.ok) return kind;
  if (kind.format === 'pen') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Pencil の .pen は平文 JSON（先頭が {）。それ以外はサーバでも 400 になるので先に止める
    const head = bytes.findIndex(
      (b) =>
        b !== 0x20 &&
        b !== 0x0a &&
        b !== 0x0d &&
        b !== 0x09 &&
        b !== 0xef &&
        b !== 0xbb &&
        b !== 0xbf,
    );
    if (head < 0 || bytes[head] !== 0x7b) return { ok: false, error: 'parse' };
    return {
      ok: true,
      format: 'pen',
      contentBase64: bytesToBase64(bytes),
      sha256: await sha256Hex(bytes),
      fileName: file.name,
    };
  }
  const parsed = parseScene(await file.text());
  if (!parsed.ok) return { ok: false, error: 'parse' };
  const out = serializeScene(
    parsed.scene.elements,
    parsed.scene.appState,
    parsed.scene.files,
  );
  if (!out.ok) return { ok: false, error: out.error.code };
  return {
    ok: true,
    format: 'excalidraw',
    content: out.json,
    fileName: file.name,
  };
}

// ------------------------------------------------------------------ 書き出し

interface ExportDesign {
  id: string;
  projectId: string;
  title: string;
  format: 'excalidraw' | 'pen';
  currentRevision: number;
  source?: {
    repo?: string | null;
    ref?: string | null;
    path?: string | null;
    commitSha?: string | null;
    hash?: string | null;
  } | null;
}

/** ダウンロード名。pen は元のファイル名を優先、白板は「タイトル.r版.excalidraw」 */
export function designFileName(
  design: ExportDesign,
  revision: number,
  originalName?: string | null,
): string {
  if (design.format === 'pen' && originalName) return originalName;
  const safe = design.title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'design';
  return `${safe}.r${revision}.${
    design.format === 'pen' ? 'pen' : 'excalidraw'
  }`;
}

/**
 * Git 手動同期用の付随メタ（*.design.json）。取り込み直し時の expectedRevision / baseSourceHash に使う。
 * 認証情報は含めない。
 */
export function buildManifest(
  design: ExportDesign,
  rev: { revision: number; sha256: string; sizeBytes: number },
) {
  return {
    kind: 'pullcord-design',
    designId: design.id,
    projectId: design.projectId,
    title: design.title,
    format: design.format,
    revision: rev.revision,
    sha256: rev.sha256,
    sizeBytes: rev.sizeBytes,
    source: design.source ?? null,
    exportedAt: new Date().toISOString(),
  };
}

/** ブラウザでファイルとして保存 */
export function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

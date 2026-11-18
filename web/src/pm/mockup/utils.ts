import { MOCKUP_MAX_BYTES, MOCKUP_ZIP_MAX_BYTES } from '../types';
import { fmt } from '../utils/date';

/** バイト数を KB / MB 表記に。 */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 一覧・版リストの日時表記（MM/DD HH:mm）。 */
export function formatWhen(iso: string | null | undefined): string {
  return iso ? fmt(iso, 'MM/DD HH:mm') : '—';
}

/** 公開者表記：「山田（MCP）」。MCP 経由は区別して見せる。 */
export function publisherLabel(
  name: string | null | undefined,
  via: string | null | undefined,
): string {
  const n = name || '—';
  return via === 'mcp' ? `${n}（MCP）` : n;
}

export type MockupFileError = 'type' | 'size' | 'zipSize' | 'empty';

/** アップロード欄の accept（.html / .zip） */
export const MOCKUP_ACCEPT = '.html,.htm,.zip,text/html,application/zip';

/**
 * 選択/ドロップされたファイルの事前チェック。
 * .html / .htm は 5MB・空でないこと、.zip は 50MB まで（中身の検査・展開後の上限はサーバ側）。
 */
export async function checkMockupFile(
  file: File,
): Promise<{ ok: true } | { ok: false; error: MockupFileError }> {
  if (/\.zip$/i.test(file.name)) {
    if (file.size > MOCKUP_ZIP_MAX_BYTES)
      return { ok: false, error: 'zipSize' };
    if (file.size === 0) return { ok: false, error: 'empty' };
    return { ok: true };
  }
  if (!/\.html?$/i.test(file.name)) return { ok: false, error: 'type' };
  if (file.size > MOCKUP_MAX_BYTES) return { ok: false, error: 'size' };
  if (!(await file.text()).trim()) return { ok: false, error: 'empty' };
  return { ok: true };
}

/** 表示幅プリセット（プレビューの PC / タブレット / スマホ切替）。 */
export const DEVICE_WIDTH = {
  desktop: '100%',
  tablet: '820px',
  phone: '390px',
} as const;
export type Device = keyof typeof DEVICE_WIDTH;

/**
 * 原文 iframe の sandbox。**allow-same-origin は絶対に付けない**：
 * 原文は PM と同一ドメイン（/mock/）から配信されるが、opaque origin にすることで
 * モックアップ内の任意 JS が PM のログイン情報（localStorage のトークン）に触れられないようにする。
 */
export const MOCKUP_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-modals allow-downloads';

// pm-web ⇄ OpenPencil ビューア（/pen-viewer/、別ビルドの Vue アプリを iframe で埋め込む）の postMessage 契約。
// 同一オリジンのみ。ビューアは読み取り専用（.pen の書き戻しは OpenPencil が未対応のため）。

export interface PenViewerInit {
  type: 'init';
  /** webapi のベース URL（prod は /api、dev は ''） */
  apiBase: string;
  /** 外部取得プロキシ（/app/pm/design-fonts。Web フォントと Iconify のアイコン）に付ける認証ヘッダー */
  headers: Record<string, string>;
}

export interface PenViewerLoad {
  type: 'load';
  /** .pen 原文（transfer される） */
  data: ArrayBuffer;
  fileName: string;
}

export interface PenViewerFocus {
  type: 'focus';
  nodeId: string;
}

export interface PenViewerExport {
  type: 'export';
  requestId: string;
  nodeIds: string[];
  /** 既定 1 */
  scale?: number;
}

export type PenViewerCommand =
  | PenViewerInit
  | PenViewerLoad
  | PenViewerFocus
  | PenViewerExport;

export interface PenViewerFrame {
  nodeId: string;
  name: string;
  width: number;
  height: number;
}

export interface PenViewerExportedImage {
  nodeId: string;
  /** PNG（transfer される）。描画できなかった画框は null */
  png: ArrayBuffer | null;
  width: number;
  height: number;
}

export type PenViewerEvent =
  | { type: 'ready' }
  | { type: 'loaded'; frames: PenViewerFrame[]; ms: number }
  /** フォントとアイコンの準備が終わった（宿主はこれを待って PNG を書き出す）。failed は取れなかったフォント */
  | { type: 'fonts'; failed: string[] }
  | { type: 'selection'; nodeId: string | null }
  /** ドラッグでパンしている間 true。宿主は iframe のカーソルを合わせる（ちらつき防止） */
  | { type: 'panning'; active: boolean }
  | { type: 'exported'; requestId: string; images: PenViewerExportedImage[] }
  | { type: 'error'; message: string; requestId?: string };

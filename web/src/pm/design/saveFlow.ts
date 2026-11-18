import type { Design, SaveDesignReq } from './api';
import { toDesignError } from './api';
import { type SceneErrorCode, serializeScene } from './scene';

type SaveFn = (id: string, req: SaveDesignReq) => Promise<Design>;

export type SaveResult =
  | { status: 'saved'; design: Design }
  /** 他の保存が先行（409）。draft = 保存しようとした場面 JSON（画面はこれを捨てない） */
  | { status: 'conflict'; draft: string; message: string }
  /** 送信前の検証で不可（サーバに送らない） */
  | { status: 'invalid'; code: SceneErrorCode; detail?: string }
  | { status: 'error'; code: number; message: string; draft: string };

/**
 * 白板の保存：場面を検証・整形し、読み込んだ修訂番号（expectedRevision）付きで送る。
 * 失敗しても編集中の内容には触れない（呼び出し側の Excalidraw はそのまま）。
 */
export async function saveSceneDraft(
  design: Pick<Design, 'id' | 'currentRevision'>,
  scene: {
    elements: readonly Record<string, unknown>[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  },
  save: SaveFn,
  note?: string,
): Promise<SaveResult> {
  const out = serializeScene(scene.elements, scene.appState, scene.files);
  if (!out.ok) {
    return {
      status: 'invalid',
      code: out.error.code,
      detail: out.error.detail,
    };
  }
  try {
    const saved = await save(design.id, {
      expectedRevision: design.currentRevision,
      content: out.json,
      ...(note ? { note } : {}),
    });
    return { status: 'saved', design: saved };
  } catch (e) {
    const err = toDesignError(e);
    if (err.code === 409) {
      return { status: 'conflict', draft: out.json, message: err.message };
    }
    return {
      status: 'error',
      code: err.code,
      message: err.message,
      draft: out.json,
    };
  }
}

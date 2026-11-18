// 業務フローボード（Excalidraw）に置く「画面」＝ .pen の画框の画像。
// 要素の customData.pm に参照元（設計・画框・版）を持たせ、審査ステータスとタスクは画框（サーバ）側を正とする。

/** 画像要素の customData.pm */
export interface FrameRef {
  kind: 'pen-frame';
  designId: string;
  designTitle: string;
  nodeId: string;
  name: string;
  /** 画像を書き出した .pen の版 */
  revision: number;
}

export interface RenderedFrame {
  nodeId: string;
  name: string;
  /** data:image/png;base64,… */
  dataURL: string;
  width: number;
  height: number;
}

/** 画面 1 枚の表示幅（キャンバス座標） */
export const SCREEN_WIDTH = 320;
const GAP = 100;
const LABEL_GAP = 10;

export function frameRefOf(el: unknown): FrameRef | null {
  const pm = (el as { customData?: { pm?: Partial<FrameRef> } } | null)
    ?.customData?.pm;
  if (
    !pm ||
    pm.kind !== 'pen-frame' ||
    typeof pm.designId !== 'string' ||
    typeof pm.nodeId !== 'string' ||
    typeof pm.revision !== 'number'
  ) {
    return null;
  }
  return {
    kind: 'pen-frame',
    designId: pm.designId,
    designTitle: String(pm.designTitle ?? ''),
    nodeId: pm.nodeId,
    name: String(pm.name ?? pm.nodeId),
    revision: pm.revision,
  };
}

/** Excalidraw の fileId（同じ画框・同じ版なら同じ画像を共有する） */
export function frameFileId(
  designId: string,
  nodeId: string,
  revision: number,
) {
  return `pen-${designId}-${nodeId.replace(/[^A-Za-z0-9_-]/g, '_')}-r${revision}`;
}

/** 画像の縦横比を保ったまま表示幅に合わせた高さ */
export function screenHeight(
  width: number,
  height: number,
  shownWidth: number,
) {
  return width > 0 ? Math.round((shownWidth * height) / width) : shownWidth;
}

export interface ScreenSkeleton {
  file: { id: string; dataURL: string; mimeType: 'image/png'; created: number };
  image: {
    type: 'image';
    fileId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    customData: { pm: FrameRef };
  };
  label: { type: 'text'; x: number; y: number; text: string; fontSize: number };
}

/**
 * 画面を横一列に並べる要素の骨組み（convertToExcalidrawElements に渡す形）。
 * (originX, originY) = 列の左上。ラベル（画框名）は画像の下。
 */
export function layoutScreens(
  design: { id: string; title: string },
  revision: number,
  frames: RenderedFrame[],
  originX: number,
  originY: number,
  now = Date.now(),
): ScreenSkeleton[] {
  let x = originX;
  return frames.map((f) => {
    const id = frameFileId(design.id, f.nodeId, revision);
    const h = screenHeight(f.width, f.height, SCREEN_WIDTH);
    const out: ScreenSkeleton = {
      file: { id, dataURL: f.dataURL, mimeType: 'image/png', created: now },
      image: {
        type: 'image',
        fileId: id,
        x,
        y: originY,
        width: SCREEN_WIDTH,
        height: h,
        customData: {
          pm: {
            kind: 'pen-frame',
            designId: design.id,
            designTitle: design.title,
            nodeId: f.nodeId,
            name: f.name,
            revision,
          },
        },
      },
      label: {
        type: 'text',
        x,
        y: originY + h + LABEL_GAP,
        text: f.name,
        fontSize: 16,
      },
    };
    x += SCREEN_WIDTH + GAP;
    return out;
  });
}

import { useCallback, useRef, useState } from 'react';
import { fetchPenSourceRev } from './api';
import type { RenderedFrame } from './flowScreens';
import PenViewerFrame, { type PenViewerHandle } from './PenViewerFrame';
import { bytesToBase64 } from './scene';

/** 書き出し画像の最大幅（px）。1920px の画面は 960px に縮める（白板の画像上限 5MB / 全体 10MB に収める） */
const MAX_EXPORT_WIDTH = 960;

interface Job {
  data: ArrayBuffer;
  nodeIds: string[];
  resolve: (r: { revision: number; frames: RenderedFrame[] }) => void;
  reject: (e: Error) => void;
  revision: number;
}

/**
 * .pen の画框を PNG に書き出す（画面に出さない OpenPencil ビューアを一時的に置く）。
 * サーバ側で .pen を描画しないので、書き出しは操作した人のブラウザで行う。
 * 使う側は `element` を描画ツリーのどこかに置く。
 */
export function usePenFrameRenderer() {
  const [job, setJob] = useState<Job | null>(null);
  const viewerRef = useRef<PenViewerHandle>(null);
  const framesRef = useRef<Map<string, { name: string; width: number }>>(
    new Map(),
  );

  const render = useCallback(
    async (designId: string, nodeIds: string[], revision?: number) => {
      const src = await fetchPenSourceRev(designId, revision);
      return new Promise<{ revision: number; frames: RenderedFrame[] }>(
        (resolve, reject) => {
          setJob({
            data: src.data,
            nodeIds,
            resolve,
            reject,
            revision: src.revision,
          });
        },
      );
    },
    [],
  );

  // フォントの読み込みが終わってから書き出す（先に書き出すと日本語が豆腐になる）
  const exportAll = async (j: Job) => {
    try {
      const out: RenderedFrame[] = [];
      for (const nodeId of j.nodeIds) {
        const meta = framesRef.current.get(nodeId);
        if (!meta) continue;
        const scale = Math.min(1, MAX_EXPORT_WIDTH / Math.max(1, meta.width));
        const [img] =
          (await viewerRef.current?.exportPng([nodeId], scale)) ?? [];
        if (!img?.png) continue;
        out.push({
          nodeId,
          name: meta.name,
          dataURL: `data:image/png;base64,${bytesToBase64(new Uint8Array(img.png))}`,
          width: img.width,
          height: img.height,
        });
      }
      j.resolve({ revision: j.revision, frames: out });
    } catch (e) {
      j.reject(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setJob(null);
    }
  };

  const element = job ? (
    <PenViewerFrame
      ref={viewerRef}
      className="pm-pen-offscreen"
      data={job.data}
      fileName="render.pen"
      onLoaded={(frames) => {
        framesRef.current = new Map(
          frames.map((f) => [f.nodeId, { name: f.name, width: f.width }]),
        );
      }}
      onFonts={() => exportAll(job)}
      onError={(m) => {
        job.reject(new Error(m));
        setJob(null);
      }}
    />
  ) : null;

  return { element, render, busy: job !== null };
}

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { apiAuthHeaders, apiBase } from './api';
import type {
  PenViewerCommand,
  PenViewerEvent,
  PenViewerExportedImage,
  PenViewerFrame as ViewerFrame,
} from './penViewerProtocol';

/** 別ビルドの OpenPencil ビューア（pen-viewer/ → public/pen-viewer/） */
export const PEN_VIEWER_URL = '/pen-viewer/index.html';

export interface PenViewerHandle {
  focus: (nodeId: string) => void;
  /** 画框を PNG に書き出す（読み込み完了後のみ） */
  exportPng: (
    nodeIds: string[],
    scale?: number,
  ) => Promise<PenViewerExportedImage[]>;
}

interface Props {
  /** .pen 原文。変わるたびに読み込み直す */
  data: ArrayBuffer | null;
  fileName: string;
  className?: string;
  title?: string;
  onLoaded?: (frames: ViewerFrame[], ms: number) => void;
  onSelection?: (nodeId: string | null) => void;
  onFonts?: (failed: string[]) => void;
  onError?: (message: string) => void;
}

/**
 * OpenPencil ビューア（読み取り専用）を iframe で埋め込み、postMessage で操作する。
 * pm-web 本体（React / mako）に CanvasKit と OpenPencil を入れないための分離。契約は penViewerProtocol.ts。
 */
const PenViewerFrame = forwardRef<PenViewerHandle, Props>(
  function PenViewerFrame(
    {
      data,
      fileName,
      className,
      title,
      onLoaded,
      onSelection,
      onFonts,
      onError,
    },
    ref,
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const readyRef = useRef(false);
    const pending = useRef(
      new Map<
        string,
        {
          resolve: (images: PenViewerExportedImage[]) => void;
          reject: (e: Error) => void;
        }
      >(),
    );
    // コールバックは最新を参照（message リスナーを張り直さない）
    const handlers = useRef({ onLoaded, onSelection, onFonts, onError });
    handlers.current = { onLoaded, onSelection, onFonts, onError };

    const send = useCallback(
      (cmd: PenViewerCommand, transfer: Transferable[] = []) => {
        iframeRef.current?.contentWindow?.postMessage(
          cmd,
          window.location.origin,
          transfer,
        );
      },
      [],
    );

    const sendData = useCallback(() => {
      if (!readyRef.current || !data) return;
      // transfer すると元の ArrayBuffer が使えなくなるので複製を渡す
      const copy = data.slice(0);
      send({ type: 'load', data: copy, fileName }, [copy]);
    }, [data, fileName, send]);

    useEffect(() => {
      const onMessage = (e: MessageEvent<PenViewerEvent>) => {
        if (
          e.origin !== window.location.origin ||
          e.source !== iframeRef.current?.contentWindow
        ) {
          return;
        }
        const ev = e.data;
        const h = handlers.current;
        switch (ev?.type) {
          case 'ready':
            readyRef.current = true;
            send({
              type: 'init',
              apiBase: apiBase(),
              headers: apiAuthHeaders(),
            });
            sendData();
            break;
          case 'loaded':
            h.onLoaded?.(ev.frames, ev.ms);
            break;
          case 'fonts':
            h.onFonts?.(ev.failed);
            break;
          case 'selection':
            h.onSelection?.(ev.nodeId);
            break;
          case 'panning':
            iframeRef.current?.classList.toggle('is-panning', ev.active);
            break;
          case 'exported':
            pending.current.get(ev.requestId)?.resolve(ev.images);
            pending.current.delete(ev.requestId);
            break;
          case 'error':
            if (ev.requestId) {
              pending.current.get(ev.requestId)?.reject(new Error(ev.message));
              pending.current.delete(ev.requestId);
            } else {
              h.onError?.(ev.message);
            }
            break;
        }
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    }, [send, sendData]);

    useEffect(sendData, [sendData]);

    useEffect(
      () => () => {
        for (const p of pending.current.values()) {
          p.reject(new Error('viewer closed'));
        }
        pending.current.clear();
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: (nodeId) => send({ type: 'focus', nodeId }),
        exportPng: (nodeIds, scale) =>
          new Promise((resolve, reject) => {
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            pending.current.set(requestId, { resolve, reject });
            send({ type: 'export', requestId, nodeIds, scale });
          }),
      }),
      [send],
    );

    return (
      <iframe
        ref={iframeRef}
        className={className}
        title={title ?? 'OpenPencil'}
        src={PEN_VIEWER_URL}
      />
    );
  },
);

export default PenViewerFrame;

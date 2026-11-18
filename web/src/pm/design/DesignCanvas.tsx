import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw-dist/index.css';
import type { ComponentProps } from 'react';

/**
 * Excalidraw 本体の境界。この部品は Design Studio の画面（/projects/:id/designs、umi のルート単位 chunk）
 * からだけ読まれるので、他の画面のバンドルには入らない。
 * フォントは固定版（package.json の @excalidraw/excalidraw）を /excalidraw-assets/ から自前配信する
 * （config.ts の copy）。取れない場合に限り Excalidraw 既定の esm.sh へフォールバックする（フォントのみ、業務データは送らない）。
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}
if (typeof window !== 'undefined' && !window.EXCALIDRAW_ASSET_PATH) {
  window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
}

export type ExcalidrawProps = ComponentProps<typeof Excalidraw>;
export type ExcalidrawAPI = Parameters<
  NonNullable<ExcalidrawProps['excalidrawAPI']>
>[0];

/** umi のロケール → Excalidraw の langCode */
export function excalidrawLang(locale: string): string {
  if (locale.startsWith('ja')) return 'ja-JP';
  if (locale === 'zh-TW') return 'zh-TW';
  if (locale.startsWith('zh')) return 'zh-CN';
  return 'en';
}

export default function DesignCanvas(props: ExcalidrawProps) {
  return (
    <Excalidraw
      {...props}
      // 任意 URL の埋め込みは作らせない（サーバ側でも embeddable / iframe は拒否）
      validateEmbeddable={() => false}
      UIOptions={{
        ...props.UIOptions,
        canvasActions: {
          // 読み込み・ローカル保存は server の取り込み / 書き出し経由に一本化（保存先を server にする）
          loadScene: false,
          saveToActiveFile: false,
          export: false,
          saveAsImage: true,
          ...props.UIOptions?.canvasActions,
        },
      }}
    />
  );
}

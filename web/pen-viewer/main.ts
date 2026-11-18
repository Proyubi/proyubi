// OpenPencil ビューア（読み取り専用）。pm-web の PenWorkspace から iframe で開かれ、postMessage で操作される。
// 契約は src/pm/design/penViewerProtocol.ts。編集入力（OpenPencil の useCanvasInput）は付けず、
// パン・ズーム・画框の選択だけを自前で扱う（.pen へ書き戻せないので、編集できる UI を見せない）。
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import {
  createDefaultEditorState,
  createEditor,
  type Editor,
} from '@open-pencil/core/editor';
import { penFormat, renderNodesToImage } from '@open-pencil/core/io';
import { fontManager } from '@open-pencil/core/text';
import { CanvasRoot, CanvasSurface, provideEditor } from '@open-pencil/vue';
import ckWasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import {
  createApp,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';
import type {
  PenViewerCommand,
  PenViewerEvent,
  PenViewerExportedImage,
  PenViewerFrame,
  PenViewerInit,
} from '../src/pm/design/penViewerProtocol';
import { penIconLayerName, placePenIcons, preparePen } from './icons';

// 同梱フォント（Inter）はハッシュ付きファイル名で配信する（nginx が .ttf を immutable キャッシュするため）
const bundledFonts = import.meta.glob(
  '../node_modules/@open-pencil/core/assets/Inter-*.ttf',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;
const bundledFontUrl = new Map(
  Object.entries(bundledFonts).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1),
    url,
  ]),
);
fontManager.setBundledFontLocator(
  (file: string) => bundledFontUrl.get(file) ?? `./${file}`,
);

// CanvasKit は単一インスタンス。先に WASM の場所を指定して初期化しておけば、CanvasRoot も同じものを使う
const canvasKitReady = getCanvasKit({ locateFile: () => ckWasmUrl });

// 画面上の背景はページ色の塗りつぶしではなく、iframe 側の CSS の点描（Pencil と同じ見た目）にする。
// OpenPencil は表示用の面（本体・シーンの保持面・タイル）を毎回ページ色で clear するので、その clear だけを
// 透明に置き換えて CSS を透かす。PNG の書き出しはページ色で clear しないので影響しない
let pageColor: { r: number; g: number; b: number } | null = null;
canvasKitReady.then((ck) => {
  // 型定義にないが、実行時は embind の Canvas クラスがある
  const proto = (
    Reflect.get(ck, 'Canvas') as
      | { prototype: { clear(color: Float32Array): void } }
      | undefined
  )?.prototype;
  if (!proto) return;
  const clear = proto.clear;
  proto.clear = function (color: Float32Array) {
    const isPage =
      pageColor !== null &&
      Math.abs(color[0] - pageColor.r) < 1e-3 &&
      Math.abs(color[1] - pageColor.g) < 1e-3 &&
      Math.abs(color[2] - pageColor.b) < 1e-3;
    return clear.call(this, isPage ? ck.TRANSPARENT : color);
  };
});

function post(event: PenViewerEvent, transfer: Transferable[] = []) {
  window.parent.postMessage(event, window.location.origin, transfer);
}

// フォントは webapi のプロキシ経由で取る（fonts.google.com のメタデータは CORS 不可）
let resolveInit: (init: PenViewerInit) => void = () => {};
const initReady = new Promise<PenViewerInit>((resolve) => {
  resolveInit = resolve;
});
const nativeFetch = globalThis.fetch.bind(globalThis);
/** webapi のプロキシ（/app/pm/design-fonts）経由の fetch。外部の Web フォントと Iconify のデータを取る */
async function proxyFetch(url: string, req?: RequestInit): Promise<Response> {
  const init = await initReady;
  // unifont は Google Fonts の CSS を UA で ttf / woff2 に出し分けさせるが、ブラウザの fetch は
  // User-Agent を送れない。そのままだとブラウザの UA で woff2 が返り CanvasKit が読めない
  // （CJK が豆腐・空白になる）ので、クエリでプロキシに渡す。応答はブラウザにキャッシュされるため、
  // ヘッダーではなく URL に含めて UA ごとに別のキャッシュキーにする
  const fontUa = new Headers(req?.headers).get('user-agent');
  const query = `url=${encodeURIComponent(url)}${
    fontUa ? `&ua=${encodeURIComponent(fontUa)}` : ''
  }`;
  const endpoint = `${init.apiBase}/app/pm/design-fonts`;
  // 文書の全文字を text= に詰めた Google Fonts の CSS は二重エンコードで 8KB を超え、
  // サーバー（Undertow / nginx）の要求行の上限で 400 になる。長いものだけ POST の本文で渡す
  // （その分ブラウザのキャッシュは効かないが、webapi 側のキャッシュは効く）
  if (query.length > MAX_PROXY_QUERY) {
    return nativeFetch(endpoint, {
      signal: req?.signal,
      method: 'POST',
      headers: { ...init.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ua: fontUa ?? undefined }),
    });
  }
  return nativeFetch(`${endpoint}?${query}`, {
    ...req,
    headers: { ...init.headers },
  });
}
/** GET で送るクエリの上限（要求行の 8KB 制限に余裕を持たせる） */
const MAX_PROXY_QUERY = 4000;
initReady.then(() => {
  fontManager.setOnlineFontProviders({
    google: true,
    fontsource: true,
    bunny: false,
  });
  // 同梱フォント（自オリジン）は直接、外部の Web フォントだけプロキシへ
  fontManager.setWebFontFetch((url: string, req?: RequestInit) =>
    new URL(url, window.location.href).origin === window.location.origin
      ? nativeFetch(url, req)
      : proxyFetch(url, req),
  );
});

interface Doc {
  editor: Editor;
  pageId: string;
  frames: PenViewerFrame[];
}

const doc = shallowRef<Doc | null>(null);
const status = ref('');

function topLevelOf(d: Doc, id: string): string | null {
  let node = d.editor.graph.getNode(id);
  while (node?.parentId && node.parentId !== d.pageId) {
    node = d.editor.graph.getNode(node.parentId);
  }
  return node && d.frames.some((f) => f.nodeId === node?.id) ? node.id : null;
}

async function load(data: ArrayBuffer, fileName: string, host: HTMLElement) {
  const t0 = performance.now();
  status.value = '';
  const read = penFormat.readDocument;
  if (!read) throw new Error('pen reader unavailable');
  // Pencil の旧形式・icon（ライブラリ参照）はリーダーが描けないので、読む前に直す（icons.ts / compat.ts）
  const stripped = preparePen(new Uint8Array(data));
  const { graph } = await read({
    data: stripped.data,
    fileName,
  } as Parameters<typeof read>[0]);
  const page = graph.getPages()[0];
  if (!page) throw new Error('empty document');
  const editor = createEditor({
    graph,
    state: reactive(createDefaultEditorState(page.id)),
    getViewportSize: () => ({
      width: host.clientWidth,
      height: host.clientHeight,
    }),
  });
  const frames: PenViewerFrame[] = [];
  for (const id of page.childIds) {
    const n = graph.getNode(id);
    if (n?.type === 'FRAME') {
      frames.push({
        nodeId: n.id,
        name: penIconLayerName(n.name, stripped.refs) || n.id,
        width: Math.round(n.width),
        height: Math.round(n.height),
      });
    }
  }
  await canvasKitReady;
  doc.value = { editor, pageId: page.id, frames };
  post({ type: 'loaded', frames, ms: Math.round(performance.now() - t0) });
  requestAnimationFrame(() => editor.zoomToFit());
  await initReady;
  const [failed] = await Promise.all([
    editor.loadFontsForNodes(page.childIds) as Promise<[string, string][]>,
    placePenIcons(graph, stripped.refs, (input, req) =>
      proxyFetch(String(input instanceof Request ? input.url : input), req),
    ).catch((err: unknown) => {
      console.warn('[pen-viewer] icons:', err);
      return 0;
    }),
  ]);
  // 画框名のラベルは CJK フォールバックで描かれるが、フォールバックが取る文字は本文からしか集めない。
  // 画框名にしかない文字（例「ビ」）が豆腐になるので、その文字もフォールバックに足す
  const labelChars = [...new Set(frames.map((f) => f.name).join(''))]
    .filter((c) => c.trim() && c.charCodeAt(0) > 0x7f)
    .join('');
  if (labelChars) {
    await fontManager
      .ensureFallbackPack(['cjk'], labelChars)
      .catch((err: unknown) => console.warn('[pen-viewer] label fonts:', err));
  }
  await loadSymbolFallbacks(graph);
  // 差し込んだアイコン・足した文字を描き直す（フォント側の invalidate より後に終わることがある）
  editor.renderer?.syncFontGeneration();
  editor.renderer?.invalidateAllPictures();
  editor.requestRender();
  post({ type: 'fonts', failed: failed.map(([f, s]) => `${f} ${s}`) });
}

/** 記号用のフォールバック（⌕ は Symbols、☑ ☷ は Symbols 2 にしかない。数学記号は Math） */
const SYMBOL_FALLBACKS = [
  'Noto Sans Symbols',
  'Noto Sans Symbols 2',
  'Noto Sans Math',
];

/**
 * OpenPencil は 1 文字でも描けない字を含む文字ノードを丸ごと描かない（フォールバックは CJK とアラビア文字だけ）。
 * Pencil は OS の記号フォントで描くので、文書中の記号を Noto の記号フォントで取ってフォールバックに足す。
 */
async function loadSymbolFallbacks(graph: Doc['editor']['graph']) {
  const chars = new Set<string>();
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'TEXT' || !node.text) continue;
    for (const c of node.text) {
      const code = c.codePointAt(0) ?? 0;
      // 一般句読点〜その他の記号・矢印（U+2000–2BFF）と絵文字面より上
      if ((code >= 0x2000 && code <= 0x2bff) || code >= 0x1f000) chars.add(c);
    }
  }
  if (chars.size === 0) return;
  const text = [...chars].join('');
  await Promise.all(
    SYMBOL_FALLBACKS.map(async (family) => {
      try {
        if (await fontManager.loadFont(family, 'Regular', text)) {
          fontManager.setCJKFallbackFamily(family);
        }
      } catch (err) {
        console.warn('[pen-viewer] symbol fonts:', family, err);
      }
    }),
  );
}

function focus(nodeId: string) {
  const d = doc.value;
  if (!d || !d.editor.graph.getNode(nodeId)) return;
  d.editor.select([nodeId]);
  d.editor.zoomToSelection();
}

async function exportPng(requestId: string, nodeIds: string[], scale = 1) {
  const d = doc.value;
  if (!d) {
    post({ type: 'error', message: 'not loaded', requestId });
    return;
  }
  const ck = await canvasKitReady;
  const renderer = d.editor.renderer;
  if (!renderer) {
    post({ type: 'error', message: 'renderer not ready', requestId });
    return;
  }
  const images: PenViewerExportedImage[] = [];
  const transfer: ArrayBuffer[] = [];
  for (const nodeId of nodeIds) {
    const n = d.editor.graph.getNode(nodeId);
    let png: ArrayBuffer | null = null;
    if (n) {
      const bytes = renderNodesToImage(
        ck,
        renderer,
        d.editor.graph,
        d.pageId,
        [nodeId],
        {
          scale,
          format: 'PNG',
        },
      );
      if (bytes) {
        png = bytes.slice().buffer;
        transfer.push(png);
      }
    }
    images.push({
      nodeId,
      png,
      width: Math.round((n?.width ?? 0) * scale),
      height: Math.round((n?.height ?? 0) * scale),
    });
  }
  d.editor.requestRender();
  post({ type: 'exported', requestId, images }, transfer);
}

/** 読み取り専用の入力：ホイール = パン（⌘/Ctrl + ホイール・ピンチ = ズーム）、ドラッグ = パン、クリック = 画框選択 */
function attachViewerInput(host: HTMLElement) {
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const onWheel = (e: WheelEvent) => {
    const d = doc.value;
    if (!d) return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      d.editor.applyZoom(
        e.deltaY * (e.ctrlKey ? 3 : 1),
        e.clientX - r.left,
        e.clientY - r.top,
      );
    } else {
      d.editor.state.panX -= e.deltaX;
      d.editor.state.panY -= e.deltaY;
      d.editor.requestRepaint();
    }
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    host.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const d = doc.value;
    if (!drag || !d) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    if (!host.classList.contains('is-panning'))
      post({ type: 'panning', active: true });
    host.classList.add('is-panning');
    d.editor.state.panX += dx;
    d.editor.state.panY += dy;
    drag.x = e.clientX;
    drag.y = e.clientY;
    d.editor.requestRepaint();
  };
  const onUp = (e: PointerEvent) => {
    const d = doc.value;
    if (host.classList.contains('is-panning'))
      post({ type: 'panning', active: false });
    host.classList.remove('is-panning');
    if (drag && !drag.moved && d) {
      const r = host.getBoundingClientRect();
      const p = d.editor.screenToCanvas(e.clientX - r.left, e.clientY - r.top);
      const hit = [...d.frames].reverse().find((f) => {
        const n = d.editor.graph.getNode(f.nodeId);
        return (
          n &&
          p.x >= n.x &&
          p.x <= n.x + n.width &&
          p.y >= n.y &&
          p.y <= n.y + n.height
        );
      });
      if (hit) d.editor.select([hit.nodeId]);
      else d.editor.clearSelection();
    }
    drag = null;
  };
  host.addEventListener('wheel', onWheel, { passive: false });
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  return () => {
    host.removeEventListener('wheel', onWheel);
    host.removeEventListener('pointerdown', onDown);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerup', onUp);
    host.removeEventListener('pointercancel', onUp);
  };
}

const Canvas = defineComponent({
  props: { doc: { type: Object, required: true } },
  setup(props) {
    const d = props.doc as Doc;
    provideEditor(d.editor);
    // 点描をパン・ズームに合わせる（間隔は 1 倍で 16px、詰まりすぎ・空きすぎは 2 倍単位で調整）
    watch(
      () =>
        [
          d.editor.state.panX,
          d.editor.state.panY,
          d.editor.state.zoom,
        ] as const,
      ([panX, panY, zoom]) => {
        let gap = 16 * zoom;
        while (gap < 10) gap *= 2;
        while (gap > 40) gap /= 2;
        const style = document.documentElement.style;
        style.setProperty('--opv-dot-gap', `${gap}px`);
        style.setProperty('--opv-dot-x', `${panX % gap}px`);
        style.setProperty('--opv-dot-y', `${panY % gap}px`);
      },
      { immediate: true },
    );
    watch(
      () => d.editor.state.pageColor,
      (c) => {
        pageColor = c ? { r: c.r, g: c.g, b: c.b } : null;
        if (c) {
          const to255 = (v: number) => Math.round(v * 255);
          document.documentElement.style.setProperty(
            '--opv-page',
            `rgb(${to255(c.r)} ${to255(c.g)} ${to255(c.b)})`,
          );
        }
        d.editor.renderer?.invalidateAllPictures();
        d.editor.requestRender();
      },
      { immediate: true },
    );
    watch(
      () => [...d.editor.state.selectedIds],
      (ids) => {
        post({
          type: 'selection',
          nodeId: ids[0] ? topLevelOf(d, ids[0]) : null,
        });
      },
    );
    return () =>
      h(CanvasRoot, null, {
        default: () => h(CanvasSurface, { style: 'width:100%;height:100%' }),
      });
  },
});

const App = defineComponent({
  setup() {
    const hostRef = ref<HTMLElement | null>(null);
    let stopInput = () => {};
    const onMessage = (e: MessageEvent<PenViewerCommand>) => {
      if (e.origin !== window.location.origin || e.source !== window.parent)
        return;
      const cmd = e.data;
      const host = hostRef.value;
      if (!cmd || typeof cmd !== 'object' || !host) return;
      if (cmd.type === 'init') resolveInit(cmd);
      else if (cmd.type === 'load') {
        load(cmd.data, cmd.fileName, host).catch((err: unknown) => {
          status.value = String(err);
          post({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        });
      } else if (cmd.type === 'focus') focus(cmd.nodeId);
      else if (cmd.type === 'export') {
        exportPng(cmd.requestId, cmd.nodeIds, cmd.scale).catch((err: unknown) =>
          post({
            type: 'error',
            requestId: cmd.requestId,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    };
    onMounted(() => {
      window.addEventListener('message', onMessage);
      if (hostRef.value) stopInput = attachViewerInput(hostRef.value);
      post({ type: 'ready' });
    });
    onBeforeUnmount(() => {
      window.removeEventListener('message', onMessage);
      stopInput();
    });
    return () =>
      h('div', { ref: hostRef, class: 'opv-host' }, [
        doc.value ? h(Canvas, { doc: doc.value, key: doc.value.pageId }) : null,
        status.value ? h('div', { class: 'opv-msg' }, status.value) : null,
      ]);
  },
});

createApp(App).mount('#app');

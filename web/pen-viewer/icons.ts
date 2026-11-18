// .pen の `type: "icon"`（Pencil のアイコンライブラリ参照。例 { icon: "chevrons-up-down", library: "lucide" }）を描く。
// OpenPencil 0.16 の .pen リーダーは icon_font しか知らず、icon は中身のない FRAME（塗りの四角）になる。
// そこで読む前に icon を透明な frame（目印付きの名前）に置き換え、読んだ後で Iconify のデータから
// OpenPencil 標準の placeIcon でベクターを差し込む。Iconify API は webapi のプロキシ経由（CORS・CSP のため）。
import {
  createIconifyProvider,
  type IconData,
  placeIcon,
} from '@open-pencil/core/icons';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { normalizeLegacyPenNode } from './compat';

/** 置き換えた frame の名前の先頭。ref の複製は id が変わるので名前で見つける */
const MARK = '\u0000pm-icon:';

/** Pencil の library 名 → Iconify のセット名（知らないものは小文字化してそのまま試す） */
const ICONIFY_PREFIX: Record<string, string> = {
  lucide: 'lucide',
  feather: 'feather',
  phosphor: 'ph',
  'material symbols': 'material-symbols',
  'material symbols outlined': 'material-symbols',
  'material symbols rounded': 'material-symbols',
  'material symbols sharp': 'material-symbols',
};

interface PenIconNode {
  type?: string;
  name?: string;
  icon?: string;
  library?: string;
  children?: unknown[];
  [key: string]: unknown;
}

export interface PenIconRef {
  /** Iconify 名（prefix:name） */
  iconName: string;
  /** 元のレイヤー名 */
  name: string;
}

function iconifyName(node: PenIconNode): string | null {
  if (typeof node.icon !== 'string' || !node.icon) return null;
  const lib = (typeof node.library === 'string' ? node.library : 'lucide')
    .trim()
    .toLowerCase();
  const prefix = ICONIFY_PREFIX[lib] ?? lib.replaceAll(' ', '-');
  // Material の名前は arrow_back、Iconify 側は arrow-back
  return `${prefix}:${node.icon.trim().toLowerCase().replaceAll('_', '-')}`;
}

/** 目印付きの名前なら元のレイヤー名、そうでなければそのまま（placePenIcons より前に名前を見せる用） */
export function penIconLayerName(name: string, refs: PenIconRef[]): string {
  if (!name.startsWith(MARK)) return name;
  return refs[Number(name.slice(MARK.length))]?.name ?? 'icon';
}

/**
 * .pen 原文をリーダーに渡す前に整える：旧形式の書き方を直し（compat.ts）、icon を透明な frame に置き換える。
 * JSON として読めない・直すところがなければ原文のまま返す。返す refs の添字が frame 名の目印に入る。
 */
export function preparePen(data: Uint8Array): {
  data: Uint8Array;
  refs: PenIconRef[];
} {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return { data, refs: [] };
  }
  const refs: PenIconRef[] = [];
  let changed = false;
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as PenIconNode;
    if (normalizeLegacyPenNode(node)) changed = true;
    if (node.type === 'icon') {
      const iconName = iconifyName(node);
      if (iconName) {
        refs.push({ iconName, name: node.name ?? node.icon ?? 'icon' });
        node.type = 'frame';
        node.name = `${MARK}${refs.length - 1}`;
        node.layout = 'none';
        delete node.icon;
        delete node.library;
        delete node.children;
        // 色は fill に残しておき（変数参照もリーダーに解決させる）、差し込み時に読んで frame からは外す
        return;
      }
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(doc);
  if (refs.length === 0 && !changed) return { data, refs };
  return { data: new TextEncoder().encode(JSON.stringify(doc)), refs };
}

/** Iconify API の `/{prefix}.json?icons=…` だけを使う最小クライアント（検索・一覧はビューアに不要） */
function iconifyClient(fetcher: typeof fetch) {
  const unsupported = () => Promise.reject(new Error('not supported'));
  return {
    async fetchCollection(prefix: string, iconNames: string[]) {
      const url = `https://api.iconify.design/${encodeURIComponent(prefix)}.json?icons=${encodeURIComponent(iconNames.join(','))}`;
      const res = await fetcher(url);
      if (!res.ok)
        throw new Error(`Iconify API error: ${res.status} for "${prefix}"`);
      return res.json();
    },
    search: unsupported,
    collections: unsupported,
    collectionIcons: unsupported,
  } as unknown as Parameters<typeof createIconifyProvider>[0];
}

/**
 * preparePen で置き換えた frame にベクターを差し込み、名前を元に戻す。
 * 取れなかったアイコンは空の frame のまま（四角は出さない）。差し込んだ数を返す。
 */
export async function placePenIcons(
  graph: SceneGraph,
  refs: PenIconRef[],
  fetcher: typeof fetch,
): Promise<number> {
  const targets = [...graph.getAllNodes()].filter((n) =>
    n.name.startsWith(MARK),
  );
  if (targets.length === 0) return 0;
  // provider.icons は 1 つのセットが失敗すると全体が reject するので、サイズ × セットごとに分けて取る
  const groups = new Map<string, { size: number; names: Set<string> }>();
  for (const node of targets) {
    const ref = refs[Number(node.name.slice(MARK.length))];
    if (!ref) continue;
    const size = Math.max(1, Math.round(Math.min(node.width, node.height)));
    const key = `${size}|${ref.iconName.slice(0, ref.iconName.indexOf(':'))}`;
    const group = groups.get(key) ?? { size, names: new Set<string>() };
    group.names.add(ref.iconName);
    groups.set(key, group);
  }
  const provider = createIconifyProvider(iconifyClient(fetcher));
  const found = new Map<string, IconData>();
  await Promise.all(
    [...groups.values()].map(async ({ size, names }) => {
      try {
        const icons = await provider.icons([...names], size);
        for (const [name, icon] of icons) found.set(`${size}|${name}`, icon);
      } catch (e) {
        console.warn('[pen-viewer] icon fetch failed:', e);
      }
    }),
  );
  let placed = 0;
  for (const node of targets) {
    const ref = refs[Number(node.name.slice(MARK.length))];
    const solid = node.fills.find((f) => f.type === 'SOLID' && f.visible);
    const color =
      solid && 'color' in solid ? solid.color : { r: 0, g: 0, b: 0, a: 1 };
    graph.updateNode(node.id, { name: ref?.name ?? 'icon', fills: [] });
    if (!ref) continue;
    const size = Math.max(1, Math.round(Math.min(node.width, node.height)));
    const icon = found.get(`${size}|${ref.iconName}`);
    if (!icon) continue;
    placeIcon(graph, node.id, icon, {
      size,
      color,
      identity: false,
      overrides: {
        x: (node.width - size) / 2,
        y: (node.height - size) / 2,
      },
    });
    placed++;
  }
  return placed;
}

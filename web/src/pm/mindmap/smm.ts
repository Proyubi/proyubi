// simple-mind-map（wanglin2/mind-map）适配层：
// 1) 插件注册（仅在本模块首次 import 时执行一次）；
// 2) 我们的 MindNode 树 ⇄ simple-mind-map 节点结构 的双向转换；
// 3) 我们的 4 个主题 key → simple-mind-map themeConfig（核心包只内置 default 主题，故自定义）。
import MindMap from "simple-mind-map";
import Drag from "simple-mind-map/src/plugins/Drag.js";
import Export from "simple-mind-map/src/plugins/Export.js";
import Select from "simple-mind-map/src/plugins/Select.js";
import type { MindMapTheme, MindNode } from "../types";

// 插件：导出（PNG）、拖拽改结构、框选多选。注册须在实例化之前，且全局只需一次；
// 本模块只会被求值一次，故在此顶层注册。usePlugin 是库的静态 API，并非 React Hook。
// biome-ignore lint/correctness/useHookAtTopLevel: usePlugin 是 simple-mind-map 的静态注册方法，不是 React Hook
MindMap.usePlugin(Export).usePlugin(Drag).usePlugin(Select);

// ---- 实例类型门面：库自带的构造器类型把所有选项都标成必填，过于严格，
//      这里用最小可用接口描述我们实际调用到的方法，构造时对 options 放宽。----
export interface SmmNode {
  data: Record<string, any> & { text?: string; uid?: string };
  children?: SmmNode[];
}

export interface SmmInstance {
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  execCommand(cmd: string, ...args: any[]): void;
  setThemeConfig(config: Record<string, any>): void;
  getData(withConfig?: boolean): SmmNode;
  export(
    type: string,
    isDownload?: boolean,
    name?: string,
    withConfig?: boolean
  ): Promise<string>;
  destroy(): void;
  view: {
    enlarge(): void;
    narrow(): void;
    fit(): void;
    reset(): void;
  };
}

type SmmOptions = {
  el: HTMLElement;
  data: SmmNode;
  layout?: string;
  themeConfig?: Record<string, any>;
  [k: string]: any;
};

const MindMapCtor = MindMap as unknown as new (opt: SmmOptions) => SmmInstance;

export function createMindMap(opt: SmmOptions): SmmInstance {
  return new MindMapCtor(opt);
}

// ---------------- 数据转换 ----------------

function genNodeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `n_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `n_${Math.random().toString(36).slice(2, 10)}`;
}

/** 我们的 MindNode → simple-mind-map 节点（uid 携带我们的稳定 id，便于回写保持身份）。 */
export function mindNodeToSmm(node: MindNode): SmmNode {
  const data: SmmNode["data"] = {
    text: node.text ?? "",
    uid: node.id,
    expand: node.collapsed !== true,
  };
  if (node.note) data.note = node.note;
  if (node.color) data.fillColor = node.color;
  return {
    data,
    children: (node.children ?? []).map(mindNodeToSmm),
  };
}

/** simple-mind-map 节点 → 我们的 MindNode（用于 data_change/getData 后落库）。 */
export function smmToMindNode(n: SmmNode): MindNode {
  const d = n?.data ?? {};
  const node: MindNode = {
    id: typeof d.uid === "string" && d.uid ? d.uid : genNodeId(),
    text: typeof d.text === "string" ? d.text : "",
    children: (n?.children ?? []).map(smmToMindNode),
  };
  if (typeof d.note === "string" && d.note) node.note = d.note;
  if (typeof d.fillColor === "string" && d.fillColor) node.color = d.fillColor;
  if (d.expand === false) node.collapsed = true;
  return node;
}

// ---------------- 主题 ----------------
// 仅覆盖关心的视觉项，其余继承核心 default 主题。
export const THEME_CONFIGS: Record<MindMapTheme, Record<string, any>> = {
  classic: {
    backgroundColor: "#f7f8fa",
    lineColor: "#2f6bff",
    lineWidth: 2,
    lineStyle: "curve",
    root: {
      fillColor: "#2f6bff",
      color: "#ffffff",
      borderColor: "transparent",
    },
    second: {
      fillColor: "#ffffff",
      color: "#1f2329",
      borderColor: "#e5e7eb",
      borderWidth: 1,
    },
    node: {
      fillColor: "#ffffff",
      color: "#1f2329",
      borderColor: "#e5e7eb",
      borderWidth: 1,
    },
  },
  dark: {
    backgroundColor: "#1f2127",
    lineColor: "#60a5fa",
    lineWidth: 2,
    lineStyle: "curve",
    root: {
      fillColor: "#3b82f6",
      color: "#ffffff",
      borderColor: "transparent",
    },
    second: {
      fillColor: "#2b2f38",
      color: "#e6e8eb",
      borderColor: "#3a3f4b",
      borderWidth: 1,
    },
    node: {
      fillColor: "#2b2f38",
      color: "#e6e8eb",
      borderColor: "#3a3f4b",
      borderWidth: 1,
    },
  },
  forest: {
    backgroundColor: "#f3f7f3",
    lineColor: "#2f7a3f",
    lineWidth: 2,
    lineStyle: "curve",
    root: {
      fillColor: "#2f7a3f",
      color: "#ffffff",
      borderColor: "transparent",
    },
    second: {
      fillColor: "#ffffff",
      color: "#1f2d22",
      borderColor: "#d8e6d8",
      borderWidth: 1,
    },
    node: {
      fillColor: "#ffffff",
      color: "#1f2d22",
      borderColor: "#d8e6d8",
      borderWidth: 1,
    },
  },
  sunset: {
    backgroundColor: "#fdf6f0",
    lineColor: "#e8590c",
    lineWidth: 2,
    lineStyle: "curve",
    root: {
      fillColor: "#e8590c",
      color: "#ffffff",
      borderColor: "transparent",
    },
    second: {
      fillColor: "#ffffff",
      color: "#3a2317",
      borderColor: "#f3dccb",
      borderWidth: 1,
    },
    node: {
      fillColor: "#ffffff",
      color: "#3a2317",
      borderColor: "#f3dccb",
      borderWidth: 1,
    },
  },
};

export function themeConfigOf(
  theme: MindMapTheme | undefined
): Record<string, any> {
  return THEME_CONFIGS[theme ?? "classic"] ?? THEME_CONFIGS.classic;
}

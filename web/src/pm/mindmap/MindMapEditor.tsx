// 思维导图编辑器：基于 simple-mind-map（wanglin2/mind-map）。
// 库本身负责画布渲染、节点增删改、内联编辑、折叠展开、缩放平移、键盘快捷键（Tab/Enter/Delete 等）。
// 本组件只做：挂载/销毁实例、工具栏命令、主题切换、PNG 导出、防抖自动保存（version 乐观锁）。
import { useIntl } from "@umijs/max";
import { App as AntApp, Button, Select, Space, Tooltip } from "antd";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  Download,
  Maximize2,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { updateMindMap } from "../api";
import type { MindMap, MindMapTheme } from "../types";
import { MIND_MAP_THEMES } from "../types";
import {
  createMindMap,
  mindNodeToSmm,
  type SmmInstance,
  smmToMindNode,
  themeConfigOf,
} from "./smm";

type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";
const SAVE_DEBOUNCE = 800;

const THEME_LABEL_KEY: Record<MindMapTheme, string> = {
  classic: "mindmap.theme.classic",
  dark: "mindmap.theme.dark",
  forest: "mindmap.theme.forest",
  sunset: "mindmap.theme.sunset",
};

export default function MindMapEditor({ map }: { map: MindMap }) {
  const intl = useIntl();
  const t = useCallback((id: string) => intl.formatMessage({ id }), [intl]);
  const { message } = AntApp.useApp();

  const [theme, setTheme] = useState<MindMapTheme>(map.theme);
  const [status, setStatus] = useState<SaveStatus>("saved");

  const containerRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<SmmInstance | null>(null);
  const versionRef = useRef(map.version);
  const themeRef = useRef<MindMapTheme>(map.theme);
  const saveTimerRef = useRef<number | null>(null);
  // 一次只允许一个保存请求在途，避免两次防抖用同一个 version 并发 PUT 撞 409。
  const savingRef = useRef(false);
  // 保存在途期间又有改动 → 记一笔，待当前保存结束后补一次。
  const dirtyWhileSavingRef = useRef(false);

  // ---------------- 保存（读取实例最新数据 → PUT，version 乐观锁） ----------------
  const doSave = useCallback(async () => {
    const inst = instRef.current;
    if (!inst) return;
    if (savingRef.current) {
      // 已有请求在途：标记待补存，结束后再触发，避免并发与丢改动。
      dirtyWhileSavingRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      const root = smmToMindNode(inst.getData(false));
      const updated = await updateMindMap(map.id, {
        root,
        theme: themeRef.current,
        version: versionRef.current,
      });
      versionRef.current = updated.version;
      setStatus("saved");
    } catch (err) {
      const code = (err as { info?: { code?: number } })?.info?.code;
      setStatus(code === 409 ? "conflict" : "error");
    } finally {
      savingRef.current = false;
    }
    // 在途期间有改动且实例仍在 → 再存一次（拿到的是更新后的 version）。
    if (dirtyWhileSavingRef.current && instRef.current) {
      dirtyWhileSavingRef.current = false;
      void doSave();
    }
  }, [map.id]);

  const scheduleSave = useCallback(() => {
    setStatus("dirty");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(doSave, SAVE_DEBOUNCE);
  }, [doSave]);

  // scheduleSave 每次渲染身份会变；用 ref 让挂载期注册的监听器始终调到最新版本，避免闭包陈旧。
  const scheduleSaveRef = useRef(scheduleSave);
  scheduleSaveRef.current = scheduleSave;

  // ---------------- 挂载 / 销毁实例（仅按导图 id 重建；其余字段经 ref 读最新值） ----------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const inst = createMindMap({
      el,
      data: mindNodeToSmm(map.root),
      layout: "logicalStructure",
      themeConfig: themeConfigOf(map.theme),
    });
    instRef.current = inst;
    versionRef.current = map.version;
    themeRef.current = map.theme;
    savingRef.current = false;
    dirtyWhileSavingRef.current = false;

    const onChange = () => scheduleSaveRef.current();
    inst.on("data_change", onChange);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      inst.off("data_change", onChange);
      inst.destroy();
      instRef.current = null;
    };
  }, [map.id]);

  // ---------------- 工具栏命令 ----------------
  const cmd = useCallback((command: string) => {
    instRef.current?.execCommand(command);
  }, []);

  const view = useCallback((fn: "enlarge" | "narrow" | "fit") => {
    instRef.current?.view[fn]();
  }, []);

  const onThemeChange = useCallback(
    (v: MindMapTheme) => {
      setTheme(v);
      themeRef.current = v;
      instRef.current?.setThemeConfig(themeConfigOf(v));
      scheduleSave();
    },
    [scheduleSave]
  );

  const onExport = useCallback(async () => {
    try {
      await instRef.current?.export("png", true, map.name || "mindmap");
    } catch {
      message.error(t("mindmap.save.error"));
    }
  }, [map.name, message, t]);

  const statusText: Record<SaveStatus, string> = {
    saved: t("mindmap.save.saved"),
    dirty: t("mindmap.save.dirty"),
    saving: t("mindmap.save.saving"),
    error: t("mindmap.save.error"),
    conflict: t("mindmap.save.conflict"),
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 140px)",
        border: "1px solid #f0f0f0",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid #f0f0f0",
          flexWrap: "wrap",
        }}
      >
        <Space size={4}>
          <Tooltip title={t("mindmap.act.addChild")}>
            <Button
              size="small"
              icon={<Plus size={16} />}
              onClick={() => cmd("INSERT_CHILD_NODE")}
            />
          </Tooltip>
          <Tooltip title={t("mindmap.act.addSibling")}>
            <Button
              size="small"
              icon={<CornerDownRight size={16} />}
              onClick={() => cmd("INSERT_NODE")}
            />
          </Tooltip>
          <Tooltip title={t("mindmap.act.delete")}>
            <Button
              size="small"
              icon={<Trash2 size={16} />}
              onClick={() => cmd("REMOVE_NODE")}
            />
          </Tooltip>
        </Space>

        <span style={{ width: 1, height: 18, background: "#f0f0f0" }} />

        <Space size={4}>
          <Tooltip title={t("mindmap.act.collapseAll")}>
            <Button
              size="small"
              icon={<ChevronsDownUp size={16} />}
              onClick={() => cmd("UNEXPAND_ALL")}
            />
          </Tooltip>
          <Tooltip title={t("mindmap.act.expandAll")}>
            <Button
              size="small"
              icon={<ChevronsUpDown size={16} />}
              onClick={() => cmd("EXPAND_ALL")}
            />
          </Tooltip>
        </Space>

        <span style={{ width: 1, height: 18, background: "#f0f0f0" }} />

        <Space size={4}>
          <Tooltip title={t("mindmap.act.zoomOut")}>
            <Button
              size="small"
              icon={<ZoomOut size={16} />}
              onClick={() => view("narrow")}
            />
          </Tooltip>
          <Tooltip title={t("mindmap.act.zoomIn")}>
            <Button
              size="small"
              icon={<ZoomIn size={16} />}
              onClick={() => view("enlarge")}
            />
          </Tooltip>
          <Tooltip title={t("mindmap.act.fit")}>
            <Button
              size="small"
              icon={<Maximize2 size={16} />}
              onClick={() => view("fit")}
            />
          </Tooltip>
        </Space>

        <span style={{ width: 1, height: 18, background: "#f0f0f0" }} />

        <Select
          size="small"
          value={theme}
          style={{ width: 110 }}
          onChange={onThemeChange}
          options={MIND_MAP_THEMES.map((k) => ({
            value: k,
            label: t(THEME_LABEL_KEY[k]),
          }))}
        />
        <Tooltip title={t("mindmap.act.exportPng")}>
          <Button
            size="small"
            icon={<Download size={16} />}
            onClick={onExport}
          />
        </Tooltip>

        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#8c8c8c" }}>
          {statusText[status]}
          {(status === "conflict" || status === "error") && (
            <Button
              type="link"
              size="small"
              onClick={() => window.location.reload()}
            >
              {t("mindmap.act.reload")}
            </Button>
          )}
        </span>
      </div>

      {/* 画布：simple-mind-map 在该容器内渲染 SVG。容器需有确定尺寸。 */}
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, width: "100%", position: "relative" }}
      />
    </div>
  );
}

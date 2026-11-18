import { useEffect, useState } from "react";
import { useIntl } from "@umijs/max";
import { App, Button, Empty, Input, Spin, Tooltip } from "antd";
import {
  DeleteOutlined,
  ExportOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import type { TaskLink } from "../types";
import { createTaskLink, deleteTaskLink, listTaskLinks } from "../api";
import "./TaskLinks.css";

interface Props {
  taskId: string;
}

/** Figma 官方 embed 端点：把分享链接包成可内联的 iframe src。 */
const figmaEmbedSrc = (url: string) =>
  `https://www.figma.com/embed?embed_host=proyubi&url=${encodeURIComponent(
    url
  )}`;

/** 取域名做兜底显示名（无 title 时）。 */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * 任务关联链接区：挂在任务编辑弹窗右栏「設計」页签。
 * kind==='figma' 内联 iframe 预览（需该 Figma 链接为「リンクを知っている全員が閲覧可」）；
 * 其余渲染为可点链接卡片。链接是任务共享上下文，任意成员可删除（即时 CRUD，独立于表单保存）。
 */
export default function TaskLinks({ taskId }: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listTaskLinks(taskId)
      .then((list) => alive && setLinks(list))
      .catch(() => alive && setLinks([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [taskId]);

  const add = async () => {
    const u = url.trim();
    if (!u || adding) return;
    setAdding(true);
    try {
      const link = await createTaskLink(taskId, u, title.trim() || undefined);
      setLinks((prev) => [...prev, link]);
      setUrl("");
      setTitle("");
    } finally {
      setAdding(false);
    }
  };

  const remove = (id: string) => {
    modal.confirm({
      title: t("projects.links.deleteConfirm"),
      okText: t("common.delete"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteTaskLink(id);
        setLinks((prev) => prev.filter((l) => l.id !== id));
        message.success(t("common.deleted"));
      },
    });
  };

  return (
    <div className="pm-links">
      {/* 添加区 */}
      <div className="pm-links-composer">
        <Input
          placeholder={t("projects.links.urlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPressEnter={add}
          allowClear
        />
        <Input
          placeholder={t("projects.links.titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onPressEnter={add}
          allowClear
        />
        <div className="pm-links-composer-actions">
          <span className="pm-links-hint">{t("projects.links.figmaHint")}</span>
          <Button
            type="primary"
            loading={adding}
            disabled={!url.trim()}
            onClick={add}
          >
            {t("projects.links.add")}
          </Button>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="pm-links-loading">
          <Spin size="small" />
        </div>
      ) : links.length === 0 ? (
        <Empty
          className="pm-links-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("projects.links.empty")}
        />
      ) : (
        <ul className="pm-links-list">
          {links.map((l) => {
            const label = l.title || hostOf(l.url);
            return (
              <li key={l.id} className="pm-link-item">
                <div className="pm-link-head">
                  <LinkOutlined className="pm-link-ico" />
                  <span className="pm-link-label" title={label}>
                    {label}
                  </span>
                  <Tooltip title={t("projects.links.open")}>
                    <Button
                      type="text"
                      size="small"
                      icon={<ExportOutlined />}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t("projects.links.open")}
                    />
                  </Tooltip>
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t("common.delete")}
                    onClick={() => remove(l.id)}
                  />
                </div>
                {l.kind === "figma" && (
                  <iframe
                    className="pm-link-figma"
                    title={label}
                    src={figmaEmbedSrc(l.url)}
                    allowFullScreen
                    referrerPolicy="no-referrer"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

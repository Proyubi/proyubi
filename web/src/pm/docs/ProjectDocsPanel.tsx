import { DeleteOutlined, LinkOutlined, PlusOutlined } from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import {
  App,
  Button,
  Drawer,
  Empty,
  Popconfirm,
  Segmented,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import { useMemo, useState } from "react";
import { deleteDoc } from "../api";
import type { PmDoc, Project, Task } from "../types";
import { fmt } from "../utils/date";
import DocAddModal from "./DocAddModal";
import DocIcon, { DocProviderLabel, useDocName } from "./DocIcon";
import DocLinkTasksModal from "./DocLinkTasksModal";
import DocPreview from "./DocPreview";
import DocRootCard from "./DocRootCard";
import "./docs.css";

type View = "registered" | "unlinked";

interface Props {
  open: boolean;
  onClose: () => void;
  project: Project;
  tasks: Task[];
  /** 案件の資料（root を含む）。取得はページ側 */
  docs: PmDoc[];
  loading?: boolean;
  /** 追加・紐付け・削除の後に呼ぶ（ページ側で再取得） */
  onChanged: () => void;
  /** タスク tag クリックでそのタスクを開く（任意） */
  onOpenTask?: (taskId: string) => void;
}

/**
 * ガント页「案件資料」ドロワー。案件フォルダ（root）カード + 2 つの表示：
 * - 登録済み資料：PM に登録した資料とタスク紐付け。行クリックで右にプレビュー
 * - 未紐付け：タスクに 1 件も紐付いていない資料だけ
 * フォルダの中身は右側に出さない（中のファイルはここでプレビューできない）。フォルダはカードの「開く」で Drive に、
 * 登録は「資料を追加」の Picker（案件フォルダ起点）から。設計書 §8。
 */
export default function ProjectDocsPanel({
  open,
  onClose,
  project,
  tasks,
  docs,
  loading,
  onChanged,
  onOpenTask,
}: Props) {
  const intl = useIntl();
  const docName = useDocName();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message } = App.useApp();
  const [view, setView] = useState<View>("registered");
  const [selectedId, setSelectedId] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [rootOpen, setRootOpen] = useState(false);
  const [linking, setLinking] = useState<PmDoc | null>(null);

  const root = useMemo(() => docs.find((d) => d.isRoot) ?? null, [docs]);
  /** 登録済み資料の Drive id（追加時の二重登録よけ） */
  const registeredIds = useMemo(
    () =>
      docs.flatMap((d) => (!d.isRoot && d.externalId ? [d.externalId] : [])),
    [docs]
  );
  const rootFolderId =
    root?.kind === "gfolder" ? (root.externalId ?? undefined) : undefined;
  const registered = useMemo(() => docs.filter((d) => !d.isRoot), [docs]);
  const unlinked = useMemo(
    () => registered.filter((d) => d.tasks.length === 0),
    [registered]
  );
  const list = view === "unlinked" ? unlinked : registered;
  const selected = list.find((d) => d.id === selectedId) ?? list[0] ?? null;

  const remove = async (d: PmDoc) => {
    await deleteDoc(d.id);
    message.success(t("docs.msg.removed"));
    onChanged();
  };

  return (
    <Drawer
      title={
        <span className="pm-docs-drawer-title">
          {t("docs.drawer.project")}
          <span className="pm-docs-drawer-sub">{project.name}</span>
        </span>
      }
      open={open}
      onClose={onClose}
      width="min(1120px, 96vw)"
      destroyOnHidden
      styles={{
        body: { padding: 16, display: "flex", flexDirection: "column" },
      }}
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setAddOpen(true)}
        >
          {t("docs.add")}
        </Button>
      }
    >
      <DocRootCard
        level="project"
        root={root}
        onSet={() => setRootOpen(true)}
        onRemove={() => root && remove(root)}
      />

      <Segmented
        className="pm-docs-views"
        value={view}
        onChange={(v) => setView(v as View)}
        options={[
          {
            value: "registered",
            label: t("docs.view.registered", { n: registered.length }),
          },
          {
            value: "unlinked",
            label: t("docs.view.unlinked", { n: unlinked.length }),
          },
        ]}
      />

      {loading && docs.length === 0 ? (
        <div className="pm-docs-center">
          <Spin />
        </div>
      ) : list.length === 0 ? (
        <Empty
          className="pm-docs-center"
          description={t(
            view === "unlinked" ? "docs.unlinkedEmpty" : "docs.empty"
          )}
        />
      ) : (
        <div className="pm-docs-split">
          <ul className="pm-docs-list">
            {list.map((d) => {
              const name = docName(d);
              return (
                <li
                  key={d.id}
                  className={`pm-docs-row${d.id === selected?.id ? " is-active" : ""}`}
                  onClick={() => setSelectedId(d.id)}
                >
                  <DocIcon doc={d} size={30} />
                  <div className="pm-docs-row-body">
                    <div className="pm-docs-row-name" title={name}>
                      {name}
                    </div>
                    <div className="pm-docs-row-meta">
                      <DocProviderLabel provider={d.provider} />
                      <span className="pm-doc-sep">·</span>
                      <span>{fmt(d.createdAt, "YYYY/MM/DD")}</span>
                      {d.createdByName && (
                        <>
                          <span className="pm-doc-sep">·</span>
                          <span>{d.createdByName}</span>
                        </>
                      )}
                    </div>
                    <div className="pm-docs-row-tags">
                      {d.tasks.length === 0 ? (
                        <Tag bordered={false}>{t("docs.unlinked")}</Tag>
                      ) : (
                        d.tasks.map((x) => (
                          <Tag
                            key={x.taskId}
                            color="blue"
                            bordered={false}
                            className={
                              onOpenTask
                                ? "pm-doc-tasktag is-link"
                                : "pm-doc-tasktag"
                            }
                            onClick={(e) => {
                              if (!onOpenTask) return;
                              e.stopPropagation();
                              onOpenTask(x.taskId);
                            }}
                          >
                            {x.taskName}
                          </Tag>
                        ))
                      )}
                    </div>
                  </div>
                  <div
                    className="pm-docs-row-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Tooltip title={t("docs.linkTasks")}>
                      <Button
                        type="text"
                        size="small"
                        icon={<LinkOutlined />}
                        aria-label={t("docs.linkTasks")}
                        onClick={() => setLinking(d)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title={t("docs.deleteConfirm", { name })}
                      description={t("docs.deleteConfirm.desc")}
                      okText={t("docs.remove")}
                      okButtonProps={{ danger: true }}
                      cancelText={t("common.cancel")}
                      onConfirm={() => remove(d)}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t("docs.remove")}
                      />
                    </Popconfirm>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="pm-docs-preview-col">
            <DocPreview doc={selected} folderHint />
          </div>
        </div>
      )}

      <DocAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={onChanged}
        customerId={project.customerId}
        projectId={project.id}
        tasks={tasks}
        scopes={["project", "task", "common"]}
        defaultScope="project"
        pickerFolderId={rootFolderId}
        registeredIds={registeredIds}
        initialMode={rootFolderId ? "google" : "url"}
      />
      <DocAddModal
        open={rootOpen}
        onClose={() => setRootOpen(false)}
        onDone={onChanged}
        projectId={project.id}
        pickerFolderId={rootFolderId}
        registeredIds={registeredIds}
        root="project"
      />
      <DocLinkTasksModal
        doc={linking}
        tasks={tasks}
        onClose={() => setLinking(null)}
        onDone={onChanged}
      />
    </Drawer>
  );
}

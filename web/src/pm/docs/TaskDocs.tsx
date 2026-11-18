import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { App, Button, Empty, Spin, Tooltip } from "antd";
import { useCallback, useEffect, useState } from "react";
import { listProjectDocs, listTaskDocs, updateDoc } from "../api";
import type { PmDoc, Task } from "../types";
import DocAddModal from "./DocAddModal";
import DocIcon, { useDocName } from "./DocIcon";
import DocPreview from "./DocPreview";
import "./docs.css";

interface Props {
  taskId: string;
  projectId: string;
  /** 同じ案件のタスク（紐付け先の選択肢） */
  tasks?: Task[];
}

/**
 * タスク編集ドロワー右栏「資料」タブ。上に紐付け済み資料の chip、下にプレビュー。
 * 「＋ 資料を紐付け」は新規 URL 登録と、本案件の登録済み資料から選ぶ、の両方に対応。
 * 外すのは「このタスクとの紐付け」だけで、資料そのものは案件に残る。
 */
export default function TaskDocs({ taskId, projectId, tasks }: Props) {
  const intl = useIntl();
  const docName = useDocName();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message, modal } = App.useApp();
  const [docs, setDocs] = useState<PmDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [projectDocs, setProjectDocs] = useState<PmDoc[]>([]);
  /** 案件フォルダの Drive id（Picker の「このフォルダ」ビュー用） */
  const [rootFolderId, setRootFolderId] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listTaskDocs(taskId);
      setDocs(list);
      setSelectedId((cur) =>
        cur && list.some((d) => d.id === cur) ? cur : list[0]?.id
      );
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setSelectedId(undefined);
    reload();
  }, [reload]);

  const openAdd = () => {
    setAddOpen(true);
    // 「登録済みから選ぶ」の候補：本案件の資料のうち、まだこのタスクに付いていないもの
    listProjectDocs(projectId)
      .then((list) => {
        const root = list.find((d) => d.isRoot && d.kind === "gfolder");
        setRootFolderId(root?.externalId ?? undefined);
        setProjectDocs(
          list.filter(
            (d) => !d.isRoot && !d.tasks.some((x) => x.taskId === taskId)
          )
        );
      })
      .catch(() => setProjectDocs([]));
  };

  const unlink = (d: PmDoc) => {
    modal.confirm({
      title: t("docs.unlinkConfirm"),
      content: docName(d),
      okText: t("docs.unlink"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        await updateDoc(d.id, {
          taskIds: d.tasks.map((x) => x.taskId).filter((id) => id !== taskId),
        });
        message.success(t("common.updated"));
        await reload();
      },
    });
  };

  const selected = docs.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="pm-taskdocs">
      <div className="pm-taskdocs-bar">
        <div className="pm-taskdocs-chips">
          {docs.map((d) => {
            const name = docName(d);
            return (
              <span
                key={d.id}
                className={`pm-doc-chip${d.id === selectedId ? " is-active" : ""}`}
                onClick={() => setSelectedId(d.id)}
                title={name}
              >
                <DocIcon doc={d} size={18} />
                <span className="pm-doc-chip-name">{name}</span>
                <Tooltip title={t("docs.unlink")}>
                  <CloseOutlined
                    className="pm-doc-chip-x"
                    aria-label={t("docs.unlink")}
                    onClick={(e) => {
                      e.stopPropagation();
                      unlink(d);
                    }}
                  />
                </Tooltip>
              </span>
            );
          })}
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={openAdd}
          >
            {t("docs.linkToTask")}
          </Button>
        </div>
      </div>

      {loading && docs.length === 0 ? (
        <div className="pm-taskdocs-center">
          <Spin size="small" />
        </div>
      ) : docs.length === 0 ? (
        <Empty
          className="pm-taskdocs-center"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("docs.taskEmpty")}
        />
      ) : (
        <div className="pm-taskdocs-preview">
          <DocPreview doc={selected} />
        </div>
      )}

      <DocAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={reload}
        projectId={projectId}
        tasks={tasks}
        scopes={["task"]}
        defaultScope="task"
        defaultTaskIds={[taskId]}
        existingDocs={projectDocs}
        pickerFolderId={rootFolderId}
      />
    </div>
  );
}

import { useIntl } from "@umijs/max";
import { App, Modal } from "antd";
import { useEffect, useState } from "react";
import { listTasks, updateDoc } from "../api";
import type { PmDoc, Task } from "../types";
import DocIcon, { useDocName } from "./DocIcon";
import DocTaskSelect from "./DocTaskSelect";
import "./docs.css";

interface Props {
  /** 対象資料（null で閉じる）。案件に属する資料のみ紐付け可能 */
  doc: PmDoc | null;
  /** その案件のタスク（未指定なら取得する） */
  tasks?: Task[];
  onClose: () => void;
  onDone: () => void;
}

/** 登録済み資料のタスク紐付けを編集する（taskIds を丸ごと置き換え）。 */
export default function DocLinkTasksModal({
  doc,
  tasks,
  onClose,
  onDone,
}: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const docName = useDocName();
  const { message } = App.useApp();
  const [value, setValue] = useState<string[]>([]);
  const [fetched, setFetched] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(doc ? doc.tasks.map((x) => x.taskId) : []);
    if (!doc?.projectId || tasks) return;
    let alive = true;
    setLoading(true);
    listTasks(doc.projectId)
      .then((list) => alive && setFetched(list))
      .catch(() => alive && setFetched([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [doc]);

  const save = async () => {
    if (!doc) return;
    setSaving(true);
    try {
      await updateDoc(doc.id, { taskIds: value });
      message.success(t("common.updated"));
      onDone();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("docs.linkTasks.title")}
      open={!!doc}
      onCancel={onClose}
      onOk={save}
      confirmLoading={saving}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      destroyOnHidden
      width={520}
    >
      {doc && (
        <div className="pm-doc-linkmodal-doc">
          <DocIcon doc={doc} size={22} />
          <span className="pm-doc-opt-name">{docName(doc)}</span>
        </div>
      )}
      <DocTaskSelect
        tasks={tasks ?? fetched}
        loading={loading}
        value={value}
        onChange={setValue}
      />
      <div className="pm-doc-linkmodal-note">{t("docs.linkTasks.note")}</div>
    </Modal>
  );
}

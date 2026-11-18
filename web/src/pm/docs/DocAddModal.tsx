import {
  CheckCircleFilled,
  CloseOutlined,
  GoogleOutlined,
  InfoCircleFilled,
} from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Segmented,
  Select,
  Spin,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { createDoc, createDocsBatch, listTasks, updateDoc } from "../api";
import type { DocPickerConfig, PmDoc, Task } from "../types";
import {
  GOOGLE_FOLDER_MIME,
  type PickedFile,
  hintDocUrl,
  mergePicked,
  pickedAsDocSource,
  pickedToBatchItems,
} from "../utils/doc";
import DocIcon, { useDocName } from "./DocIcon";
import DocTaskSelect from "./DocTaskSelect";
import {
  type OpenPickerOptions,
  PickerError,
  listFolderFiles,
  loadPickerConfig,
  openPicker,
  pickerLocale,
  preloadPicker,
} from "./googlePicker";
import "./docs.css";

export type DocScope = "common" | "project" | "task";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 登録／紐付けが成功した後（呼び出し側で再取得する） */
  onDone: () => void;
  /** 顧客共通で登録するときの顧客 */
  customerId?: string;
  /** 固定の案件（案件パネル・タスクタブ）。指定時は案件選択を出さない */
  projectId?: string;
  /** 案件を選ばせる場合の候補（顧客ドロワー） */
  projectOptions?: { id: string; name: string }[];
  /** 固定案件のタスク（未指定なら選択した案件のタスクを取得する） */
  tasks?: Task[];
  /** 出す紐付け先。1 つだけなら選択 UI 自体を出さない */
  scopes?: DocScope[];
  defaultScope?: DocScope;
  defaultTaskIds?: string[];
  /** ルートフォルダ設定モード（紐付け先・タスクは出さない） */
  root?: "customer" | "project";
  /** 既存資料の候補。渡すと「登録済みから選ぶ」モードを出す（タスクタブ用） */
  existingDocs?: PmDoc[];
  /** Google Picker の「このフォルダ」ビューの起点（ルートフォルダの Drive id） */
  pickerFolderId?: string | null;
  /** 開いた時のタブ（既定 url）。ルートフォルダがあるときは google */
  initialMode?: Mode;
  /** 登録済み資料の Drive id。フォルダ展開・一括登録で同じファイルを二重に登録しない */
  registeredIds?: string[];
}

type Mode = "url" | "google" | "existing";

/** Picker で選んだ 1 件 + 画面で付け直した表示名 */
type PickedRow = PickedFile & { title: string };

/** POST /docs/batch の上限 */
const MAX_BATCH = 50;

interface FormValues {
  url: string;
  title?: string;
  scope: DocScope;
  projectId?: string;
  taskIds?: string[];
  docIds?: string[];
}

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * 資料の追加ダイアログ。登録方法は 3 つ：
 * - 「URL から登録」：URL・表示名を入力。入力中は hintDocUrl で「何として認識されるか」を出すが目安で、種類は後端が判定する。
 * - 「Google ドライブから選択」：Google Picker で複数選択 → 名前・mimeType 付きで POST /docs/batch
 *   （ルート設定モードではフォルダ 1 件を選んで POST /docs isRoot）。picker-config が無効なら説明だけ出して使えない。
 * - 「登録済みから選ぶ」（existingDocs を渡した時）：既存資料にタスクを足す。
 * 紐付け先（顧客共通 / 案件全体 / タスク）は URL・Google の両方で共通。
 */
export default function DocAddModal({
  open,
  onClose,
  onDone,
  customerId,
  projectId: fixedProjectId,
  projectOptions,
  tasks: fixedTasks,
  scopes = ["common", "project", "task"],
  defaultScope,
  defaultTaskIds,
  root,
  existingDocs,
  pickerFolderId,
  initialMode = "url",
  registeredIds,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const docName = useDocName();
  const [mode, setMode] = useState<Mode>("url");
  const [submitting, setSubmitting] = useState(false);
  const [fetchedTasks, setFetchedTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [pickerConfig, setPickerConfig] = useState<DocPickerConfig | null>(
    null
  );
  const [picked, setPicked] = useState<PickedRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  /** ルート設定時：フォルダ内のファイルも資料として登録する */
  const [importFiles, setImportFiles] = useState(true);

  const url = Form.useWatch("url", form) ?? "";
  const scope = Form.useWatch("scope", form) ?? defaultScope ?? scopes[0];
  const pickedProjectId = Form.useWatch("projectId", form);
  const projectId = fixedProjectId ?? pickedProjectId;
  const needTasks = !root && (mode === "existing" || scope === "task");
  const useFixedTasks = !!fixedTasks && projectId === fixedProjectId;

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setPicked([]);
    setPickError(null);
    setImportFiles(true);
    form.resetFields();
    form.setFieldsValue({
      scope: defaultScope ?? scopes[0],
      taskIds: defaultTaskIds ?? [],
    });
  }, [open]);

  // Picker を使えるか（設定は 1 回だけ取得してキャッシュ）
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadPickerConfig()
      .then((c) => alive && setPickerConfig(c))
      .catch(
        () =>
          alive &&
          setPickerConfig({
            enabled: false,
            clientId: null,
            apiKey: null,
            appId: null,
          })
      );
    return () => {
      alive = false;
    };
  }, [open]);

  // Google タブを開いた時点でスクリプトを先読みしておく（クリック後の待ちでポップアップがブロックされないように）
  useEffect(() => {
    if (open && mode === "google" && pickerConfig?.enabled) preloadPicker();
  }, [open, mode, pickerConfig?.enabled]);

  // 案件を選ばせる場合（顧客ドロワー）は、その案件のタスクを都度取得する
  useEffect(() => {
    if (!open || !needTasks || useFixedTasks || !projectId) {
      setFetchedTasks([]);
      return;
    }
    let alive = true;
    setTasksLoading(true);
    listTasks(projectId)
      .then((list) => alive && setFetchedTasks(list))
      .catch(() => alive && setFetchedTasks([]))
      .finally(() => alive && setTasksLoading(false));
    return () => {
      alive = false;
    };
  }, [open, needTasks, useFixedTasks, projectId]);

  const taskList = useFixedTasks ? (fixedTasks ?? []) : fetchedTasks;
  const hint = useMemo(() => hintDocUrl(url), [url]);
  const kindName = (kind: string) => t(`docs.kind.${kind}`);

  const linkable = useMemo(
    () => (existingDocs ?? []).filter((d) => !d.isRoot),
    [existingDocs]
  );

  const pickerLabels = (title: string): OpenPickerOptions["labels"] => ({
    title,
    thisFolder: t("docs.picker.view.thisFolder"),
    myDrive: t("docs.picker.view.myDrive"),
    sharedDrives: t("docs.picker.view.sharedDrives"),
  });

  /**
   * フォルダ → 中のファイル（サブフォルダ含む）。まず Drive API で一覧し、
   * drive.file 権限で見えない（空）ときはそのフォルダを起点に Picker を開き直してファイルを選んでもらう。
   */
  const expandFolder = async (folder: PickedFile): Promise<PickedFile[]> => {
    const listed = await listFolderFiles(folder.id);
    if (listed) return listed;
    return openPicker({
      parentFolderId: folder.id,
      multiselect: true,
      allowFolders: false,
      locale: pickerLocale(intl.locale),
      labels: pickerLabels(
        t("docs.picker.titleInFolder", { name: folder.name })
      ),
    });
  };

  const registered = useMemo(
    () => new Set(registeredIds ?? []),
    [registeredIds]
  );

  const pick = async () => {
    setPickError(null);
    setPicking(true);
    try {
      const files = await openPicker({
        parentFolderId: pickerFolderId,
        multiselect: !root,
        foldersOnly: !!root,
        locale: pickerLocale(intl.locale),
        labels: pickerLabels(
          t(root ? "docs.picker.titleFolder" : "docs.picker.title")
        ),
      });
      if (files.length === 0) return;
      if (root) {
        setPicked([{ ...files[0], title: files[0].name }]);
        return;
      }
      // ファイルはそのまま、フォルダは中のファイルに展開して足す（フォルダ自体は登録しない）
      const out = files.filter((f) => f.mimeType !== GOOGLE_FOLDER_MIME);
      for (const folder of files.filter(
        (f) => f.mimeType === GOOGLE_FOLDER_MIME
      )) {
        const inner = await expandFolder(folder);
        out.push(...inner);
        if (inner.length > 0)
          message.info(
            t("docs.picker.expanded", { name: folder.name, n: inner.length })
          );
      }
      const fresh = out.filter((f) => !registered.has(f.id));
      if (fresh.length < out.length)
        message.info(
          t("docs.picker.skipDup", { n: out.length - fresh.length })
        );
      const rows = fresh.map((f) => ({ ...f, title: f.name }));
      setPicked((cur) => mergePicked(cur, rows));
    } catch (e) {
      const code = e instanceof PickerError ? e.code : "load";
      setPickError(t(`docs.picker.err.${code}`));
    } finally {
      setPicking(false);
    }
  };

  /** POST /docs/batch の上限ごとに分けて登録する */
  const createInChunks = async (
    base: Omit<Parameters<typeof createDocsBatch>[0], "items">,
    files: (PickedFile & { title?: string })[]
  ): Promise<number> => {
    let n = 0;
    for (let i = 0; i < files.length; i += MAX_BATCH) {
      const created = await createDocsBatch({
        ...base,
        items: pickedToBatchItems(files.slice(i, i + MAX_BATCH)),
      });
      n += created.length;
    }
    return n;
  };

  const submit = async () => {
    if (mode === "google") {
      if (!pickerConfig?.enabled) return;
      if (picked.length === 0) {
        message.warning(t("docs.picker.required"));
        return;
      }
    }
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      if (mode === "google") {
        if (root) {
          const [item] = pickedToBatchItems(picked);
          const scopeBody =
            root === "project" ? { projectId: fixedProjectId } : { customerId };
          await createDoc({ ...scopeBody, ...item, isRoot: true });
          // フォルダ内のファイルも、顧客共通 / 案件全体の資料としてまとめて登録する
          const files = importFiles
            ? (await expandFolder(picked[0])).filter(
                (f) => !registered.has(f.id)
              )
            : [];
          const n =
            files.length > 0 ? await createInChunks(scopeBody, files) : 0;
          message.success(
            n > 0 ? t("docs.msg.rootImported", { n }) : t("docs.msg.added")
          );
        } else {
          const s = v.scope ?? scope;
          const n = await createInChunks(
            {
              customerId: s === "common" ? customerId : undefined,
              projectId: s === "common" ? undefined : projectId,
              taskIds: s === "task" ? (v.taskIds ?? []) : undefined,
            },
            picked
          );
          message.success(t("docs.msg.addedN", { n: n || picked.length }));
        }
      } else if (mode === "existing") {
        const chosen = v.taskIds ?? [];
        await Promise.all(
          (v.docIds ?? []).map((id) => {
            const d = linkable.find((x) => x.id === id);
            const current = d ? d.tasks.map((x) => x.taskId) : [];
            return updateDoc(id, {
              taskIds: Array.from(new Set([...current, ...chosen])),
            });
          })
        );
        message.success(t("docs.msg.linked"));
      } else {
        const title = v.title?.trim() || undefined;
        if (root) {
          await createDoc(
            root === "project"
              ? {
                  projectId: fixedProjectId,
                  url: v.url.trim(),
                  title,
                  isRoot: true,
                }
              : { customerId, url: v.url.trim(), title, isRoot: true }
          );
        } else {
          const s = v.scope ?? scope;
          await createDoc({
            customerId: s === "common" ? customerId : undefined,
            projectId: s === "common" ? undefined : projectId,
            url: v.url.trim(),
            title,
            taskIds: s === "task" ? (v.taskIds ?? []) : undefined,
          });
        }
        message.success(t("docs.msg.added"));
      }
      onDone();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const showScope = !root && mode !== "existing" && scopes.length > 1;
  const showProjectPick =
    !root && !fixedProjectId && (mode === "existing" || scope !== "common");

  return (
    <Modal
      title={root ? t("docs.form.rootTitle") : t("docs.form.addTitle")}
      open={open}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={submitting}
      okText={
        mode === "existing"
          ? t("docs.linkTasks")
          : mode === "google" && !root && picked.length > 0
            ? t("docs.picker.addN", { n: picked.length })
            : t("docs.add")
      }
      okButtonProps={{
        disabled:
          mode === "google" && (!pickerConfig?.enabled || picked.length === 0),
      }}
      cancelText={t("common.cancel")}
      destroyOnHidden
      width={560}
    >
      <Segmented
        block
        className="pm-doc-add-mode"
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        options={[
          { value: "url", label: t("docs.form.mode.new") },
          {
            value: "google",
            label: t(
              root ? "docs.form.mode.googleFolder" : "docs.form.mode.google"
            ),
          },
          ...(linkable.length > 0 && !root
            ? [{ value: "existing", label: t("docs.form.mode.existing") }]
            : []),
        ]}
      />
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        {mode === "google" && (
          <div className="pm-doc-picker">
            {pickerConfig === null ? (
              <div className="pm-doc-picker-loading">
                <Spin size="small" />
              </div>
            ) : !pickerConfig.enabled ? (
              <Alert
                type="info"
                showIcon
                message={t("docs.picker.disabled")}
                description={t("docs.picker.disabled.desc")}
              />
            ) : (
              <>
                {pickError && (
                  <Alert
                    type="error"
                    showIcon
                    closable
                    onClose={() => setPickError(null)}
                    message={pickError}
                    className="pm-doc-picker-error"
                  />
                )}
                {picked.length > 0 && (
                  <ul className="pm-doc-picked">
                    {picked.map((f) => (
                      <li key={f.id} className="pm-doc-picked-row">
                        <DocIcon doc={pickedAsDocSource(f)} size={24} />
                        <Input
                          size="small"
                          value={f.title}
                          maxLength={200}
                          placeholder={docName(pickedAsDocSource(f))}
                          aria-label={t("docs.form.title")}
                          onChange={(e) => {
                            const title = e.target.value;
                            setPicked((cur) =>
                              cur.map((x) =>
                                x.id === f.id ? { ...x, title } : x
                              )
                            );
                          }}
                        />
                        <Button
                          type="text"
                          size="small"
                          icon={<CloseOutlined />}
                          aria-label={t("docs.picker.removeItem")}
                          onClick={() =>
                            setPicked((cur) => cur.filter((x) => x.id !== f.id))
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  block
                  icon={<GoogleOutlined />}
                  loading={picking}
                  onClick={pick}
                >
                  {t(
                    picked.length === 0
                      ? root
                        ? "docs.picker.pickFolder"
                        : "docs.picker.pick"
                      : root
                        ? "docs.picker.repickFolder"
                        : "docs.picker.pickMore"
                  )}
                </Button>
                {root && (
                  <Checkbox
                    className="pm-doc-picker-import"
                    checked={importFiles}
                    onChange={(e) => setImportFiles(e.target.checked)}
                  >
                    {t("docs.picker.importFiles")}
                  </Checkbox>
                )}
                <div className="pm-doc-picker-note">
                  {t(root ? "docs.form.url.rootExtra" : "docs.picker.note")}
                </div>
              </>
            )}
          </div>
        )}
        {mode === "url" ? (
          <>
            <Form.Item
              name="url"
              label={t("docs.form.url")}
              rules={[
                { required: true, message: t("docs.form.url.required") },
                {
                  pattern: URL_RE,
                  max: 2000,
                  message: t("docs.form.url.invalid"),
                },
                {
                  // フォルダはルート / 案件フォルダ専用（後端も 400 にする）
                  validator: (_, v: string) =>
                    !root && hintDocUrl(v ?? "")?.kind === "gfolder"
                      ? Promise.reject(new Error(t("docs.form.url.folder")))
                      : Promise.resolve(),
                },
              ]}
              extra={
                hint && !(hint.kind === "gfolder" && !root) ? (
                  <span
                    className={`pm-doc-hint${hint.previewable ? " is-ok" : ""}`}
                  >
                    {hint.previewable ? (
                      <CheckCircleFilled />
                    ) : (
                      <InfoCircleFilled />
                    )}
                    {hint.previewable
                      ? t("docs.hint.preview", { kind: kindName(hint.kind) })
                      : t("docs.hint.linkOnly", {
                          provider: t(`docs.provider.${hint.provider}`),
                        })}
                  </span>
                ) : (
                  t(root ? "docs.form.url.rootExtra" : "docs.form.url.extra")
                )
              }
            >
              <Input
                autoFocus
                allowClear
                placeholder={t(
                  root
                    ? "docs.form.url.rootPlaceholder"
                    : "docs.form.url.placeholder"
                )}
              />
            </Form.Item>
            <Form.Item
              name="title"
              label={t("docs.form.title")}
              rules={[{ max: 200 }]}
            >
              <Input
                allowClear
                maxLength={200}
                placeholder={t("docs.form.title.placeholder")}
              />
            </Form.Item>
            {showScope && (
              <Form.Item name="scope" label={t("docs.form.scope")}>
                <Radio.Group
                  optionType="button"
                  options={scopes.map((s) => ({
                    value: s,
                    label:
                      s === "common"
                        ? t("docs.common")
                        : s === "project"
                          ? t("docs.projectWide")
                          : t("docs.form.scope.task"),
                  }))}
                />
              </Form.Item>
            )}
          </>
        ) : mode === "existing" ? (
          <Form.Item
            name="docIds"
            label={t("docs.form.existing")}
            rules={[
              { required: true, message: t("docs.form.existing.required") },
            ]}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder={t("docs.form.existing.placeholder")}
              optionFilterProp="search"
              options={linkable.map((d) => ({
                value: d.id,
                search: `${docName(d)} ${d.url}`,
                label: (
                  <span className="pm-doc-opt">
                    <DocIcon doc={d} size={18} />
                    <span className="pm-doc-opt-name">{docName(d)}</span>
                  </span>
                ),
              }))}
            />
          </Form.Item>
        ) : null}
        {showProjectPick && (
          <Form.Item
            name="projectId"
            label={t("docs.form.project")}
            rules={[
              { required: true, message: t("docs.form.project.required") },
            ]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={(projectOptions ?? []).map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              onChange={() => form.setFieldValue("taskIds", [])}
            />
          </Form.Item>
        )}
        {needTasks && (
          <Form.Item
            name="taskIds"
            label={t("docs.form.tasks")}
            rules={[
              {
                required: true,
                type: "array",
                min: 1,
                message: t("docs.form.tasks.required"),
              },
            ]}
          >
            <DocTaskSelect tasks={taskList} loading={tasksLoading} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

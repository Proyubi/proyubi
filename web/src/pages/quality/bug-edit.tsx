import { useIntl } from "@umijs/max";
import {
  App as AntApp,
  Button,
  Col,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Skeleton,
  Space,
  TreeSelect,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/pm/api";
import RichTextEditor from "@/pm/components/RichTextEditor";
import MockupPanel from "@/pm/mockup/MockupPanel";
import { useData } from "@/pm/store";
import { buildTaskTreeData } from "@/pm/utils/taskTree";
import {
  BUG_SEVERITY_META,
  type Bug,
  type Environment,
  environmentLabel,
  QC_PRIORITY_META,
  type QcPriority,
} from "@/pm/types";
import "./index.css";

const PRIORITY_KEYS: QcPriority[] = ["high", "medium", "low"];

/** 旧・自由入力の環境（environmentId 無し）を Select 上で保持するためのセンチネル値 */
const LEGACY_ENV = "__legacy_env__";

const ISO_FMT = "YYYY-MM-DDTHH:mm:ss";

/** ツリー値エンコード：製品ノード = "c:<customerId>" / プロジェクトノード = "p:<projectId>" */
export const CUST_PREFIX = "c:";
export const PROJ_PREFIX = "p:";

/** ツリー選択値 → { customerId, projectId }。製品ノードなら projectId 無し。 */
export function decodeRef(
  ref: string | undefined,
  projToCust: Record<string, string>
): { customerId?: string; projectId?: string } {
  if (!ref) return {};
  if (ref.startsWith(PROJ_PREFIX)) {
    const projectId = ref.slice(PROJ_PREFIX.length);
    return { customerId: projToCust[projectId], projectId };
  }
  if (ref.startsWith(CUST_PREFIX)) {
    return { customerId: ref.slice(CUST_PREFIX.length) };
  }
  return {};
}

interface BugEditDrawerProps {
  open: boolean;
  /** 編集対象のバグ ID。未指定なら新規作成。 */
  bugId?: string;
  /** 複製して起票：このバグの内容を初期値に新規作成する（bugId 未指定時のみ有効） */
  copyFromId?: string;
  /** 新規作成時の対象製品（＝コンテキストの製品）。 */
  customerId?: string;
  onClose: () => void;
  /** 保存成功後（呼び出し側でリスト再取得）。moved=別製品へ移動したか。 */
  onSaved: (moved: boolean) => void;
}

/**
 * バグ票の作成/編集ドロワー（ページ幅の 60% を占める右サイドドロワー）。
 * 説明欄はタスク説明と同じ RichTextEditor（貼图・富文本）。
 */
export default function BugEditDrawer({
  open,
  bugId,
  copyFromId,
  customerId: propCustomerId,
  onClose,
  onSaved,
}: BugEditDrawerProps) {
  const intl = useIntl();
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id }, values),
    [intl]
  );
  const { message } = AntApp.useApp();
  const {
    customers,
    projects,
    members,
    ensureBase,
    loadProject,
    tasksOf,
    isProjectLoaded,
  } = useData();
  const [form] = Form.useForm();

  const isEdit = !!bugId;
  // 編集対象 or 複製元。どちらもバグ本体を取得してフォームに流し込む
  const sourceId = bugId ?? copyFromId;

  const [ready, setReady] = useState(false);
  const [bug, setBug] = useState<Bug | null>(null);
  const [saving, setSaving] = useState(false);
  // 選択中製品の環境マスタ（製品切替でカスケード再取得）
  const [environments, setEnvironments] = useState<Environment[]>([]);

  // 基础数据
  useEffect(() => {
    if (!open) return;
    ensureBase().finally(() => setReady(true));
  }, [open, ensureBase]);

  // 編集/複製時：バグ本体を取得。開閉/対象切替のたびにリセット。
  useEffect(() => {
    if (!open || !sourceId) {
      setBug(null);
      return;
    }
    setBug(null);
    api
      .getBug(sourceId)
      .then(setBug)
      .catch(() => onClose());
  }, [open, sourceId, onClose]);

  // 対象製品：編集/複製=元バグの customerId、新規=呼び出し側から渡された customerId
  const customerId = sourceId ? bug?.customerId : propCustomerId;

  const projToCust = useMemo(
    () => Object.fromEntries(projects.map((pr) => [pr.id, pr.customerId])),
    [projects]
  );

  // フォームで選択中の製品/版本。タスク候補はここにカスケードさせる。
  const projectRef = Form.useWatch("projectRef", form) as string | undefined;
  const { customerId: selCustomerId, projectId: selProjectId } = useMemo(
    () => decodeRef(projectRef, projToCust),
    [projectRef, projToCust]
  );

  // カスケード対象の版本：特定版本を選べばその1件のみ（タスク=フラットWBS）、
  // 製品全体なら配下の全版本（タスク=版本→WBS）。未選択時はコンテキスト製品にフォールバック。
  const custProjects = useMemo(() => {
    if (selProjectId) {
      const p = projects.find((pr) => pr.id === selProjectId);
      return p ? [p] : [];
    }
    const cid = selCustomerId ?? customerId;
    return projects.filter((pr) => pr.customerId === cid);
  }, [projects, selProjectId, selCustomerId, customerId]);

  useEffect(() => {
    for (const p of custProjects) {
      loadProject(p.id).catch(() => {});
    }
  }, [custProjects, loadProject]);

  // 環境マスタ：選択中製品（未選択時はコンテキスト製品）配下を取得。製品切替で再取得。
  const envCustomerId = selCustomerId ?? customerId;
  useEffect(() => {
    if (!open || !envCustomerId) {
      setEnvironments([]);
      return;
    }
    api
      .listEnvironments(envCustomerId)
      .then((es) => setEnvironments(es ?? []))
      .catch(() => setEnvironments([]));
  }, [open, envCustomerId]);

  // 環境 Select 選択肢：マスタ + 旧・自由入力（編集時のみ、後方互換で保持）
  const envOptions = useMemo(() => {
    const base = environments.map((e) => ({
      value: e.id,
      label: e.label ?? environmentLabel(e),
    }));
    if (isEdit && bug?.environment && !bug?.environmentId) {
      return [
        { value: LEGACY_ENV, label: `${bug.environment}（旧・自由入力）` },
        ...base,
      ];
    }
    return base;
  }, [environments, isEdit, bug?.environment, bug?.environmentId]);

  const tasks = useMemo(
    () =>
      custProjects.flatMap((p) => (isProjectLoaded(p.id) ? tasksOf(p.id) : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [custProjects, isProjectLoaded, tasksOf]
  );

  // タスク選択肢：選んだ版本配下の WBS（版本1件ならフラット、製品全体なら版本→WBS）。
  const taskTreeData = useMemo(
    () => buildTaskTreeData(custProjects, tasks),
    [custProjects, tasks]
  );
  const memberOptions = useMemo(
    () => members.map((m) => ({ label: m.name, value: m.id })),
    [members]
  );

  const custNameMap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c.name])),
    [customers]
  );

  // 全製品→各版本 の1本のツリー（製品全体=親 / 各版本=子）。別製品を選ぶと移動＝再採番。
  const productTree = useMemo(
    () =>
      customers.map((c) => ({
        title: `${c.name} ${t("quality.bug.wholeProduct")}`,
        value: `${CUST_PREFIX}${c.id}`,
        selectable: true,
        children: projects
          .filter((pr) => pr.customerId === c.id)
          .map((pr) => ({ title: pr.name, value: `${PROJ_PREFIX}${pr.id}` })),
      })),
    [customers, projects, t]
  );

  // フォーム初期化（編集=バグ取得後 / 新規=基础数据 ready 後）。
  // Drawer は destroyOnClose のため開くたびに Form が再マウントされる。
  const initedKey = sourceId
    ? `${bugId ? "edit" : "copy"}:${bug?.id}`
    : customerId ?? "new";
  useEffect(() => {
    if (!open || !ready) return;
    if (sourceId) {
      if (!bug) return;
      form.setFieldsValue({
        title: bug.title,
        description: bug.description ?? "",
        severity: bug.severity,
        priority: bug.priority,
        environmentId:
          bug.environmentId ?? (bug.environment ? LEGACY_ENV : undefined),
        assigneeMemberId: bug.assigneeMemberId ?? undefined,
        projectRef: bug.projectId
          ? `${PROJ_PREFIX}${bug.projectId}`
          : `${CUST_PREFIX}${bug.customerId}`,
        taskId: bug.taskId ?? undefined,
        // 複製は「今日起票した別のバグ」なので起票日は今日、完了日は持ち越さない
        reportedOn: isEdit && bug.reportedOn ? dayjs(bug.reportedOn) : dayjs(),
        resolvedAt:
          isEdit && bug.resolvedAt ? dayjs(bug.resolvedAt) : undefined,
      });
    } else {
      form.setFieldsValue({
        title: undefined,
        description: "",
        severity: "medium",
        priority: "medium",
        environmentId: undefined,
        assigneeMemberId: undefined,
        projectRef: customerId ? `${CUST_PREFIX}${customerId}` : undefined,
        taskId: undefined,
        reportedOn: dayjs(),
        resolvedAt: undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initedKey, ready, open]);

  const submit = async () => {
    const v = await form.validateFields();
    const {
      projectRef,
      environmentId: envSel,
      reportedOn,
      resolvedAt,
      ...rest
    } = v as typeof v & {
      projectRef?: string;
      environmentId?: string;
      reportedOn?: dayjs.Dayjs;
      resolvedAt?: dayjs.Dayjs | null;
    };
    const reportedOnStr = reportedOn?.format("YYYY-MM-DD");
    const { customerId: targetCustomerId, projectId } = decodeRef(
      projectRef,
      projToCust
    );
    if (!targetCustomerId) {
      message.error(t("quality.bug.selectProduct"));
      return;
    }
    setSaving(true);
    try {
      if (isEdit && bug) {
        const moved = targetCustomerId !== bug.customerId;
        // 環境：マスタ選択=environmentId / 旧値のまま=送らない / クリア=解除
        const envPayload: {
          environmentId?: string;
          unlinkEnvironment?: boolean;
        } =
          envSel === LEGACY_ENV
            ? {}
            : envSel
            ? { environmentId: envSel }
            : bug.environmentId || bug.environment
            ? { unlinkEnvironment: true }
            : {};
        // 完了日：日付が変わったときだけ送る（同日のまま送ると時刻が 00:00 に潰れる）
        const prevResolved = bug.resolvedAt
          ? dayjs(bug.resolvedAt).format("YYYY-MM-DD")
          : null;
        const nextResolved = resolvedAt
          ? resolvedAt.format("YYYY-MM-DD")
          : null;
        const resolvedPayload =
          prevResolved === nextResolved
            ? {}
            : resolvedAt
            ? { resolvedAt: resolvedAt.startOf("day").format(ISO_FMT) }
            : { clearResolvedAt: true };
        await api.updateBug(bug.id, {
          ...rest,
          ...envPayload,
          ...resolvedPayload,
          reportedOn: reportedOnStr,
          customerId: moved ? targetCustomerId : undefined,
          projectId,
          unlinkProject: !projectId,
          // 別製品へ移動時は旧タスク紐付けを解除
          unlinkTask: moved || !v.taskId,
          clearAssignee: !v.assigneeMemberId,
        });
        if (moved) {
          message.info(
            t("quality.bug.movedTo", {
              product: custNameMap[targetCustomerId] ?? "",
            })
          );
        } else {
          message.success(t("quality.msg.saved"));
        }
        onSaved(moved);
      } else {
        await api.createBug(targetCustomerId, {
          ...rest,
          reportedOn: reportedOnStr,
          projectId,
          environmentId: envSel && envSel !== LEGACY_ENV ? envSel : undefined,
        });
        message.success(t("quality.msg.saved"));
        onSaved(false);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const loading = !ready || (!!sourceId && !bug);

  return (
    <Drawer
      title={isEdit ? t("quality.bug.edit") : t("quality.bug.add")}
      open={open}
      onClose={onClose}
      width="60%"
      destroyOnClose
      maskClosable={false}
      extra={
        <Space>
          <Button onClick={onClose}>{t("quality.common.cancel")}</Button>
          <Button type="primary" loading={saving} onClick={submit}>
            {t("quality.common.save")}
          </Button>
        </Space>
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label={t("quality.bug.title")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="severity" label={t("quality.bug.severity")}>
                <Select
                  options={PRIORITY_KEYS.map((k) => ({
                    value: k,
                    label: t(BUG_SEVERITY_META[k].i18nKey),
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label={t("quality.bug.priority")}>
                <Select
                  options={PRIORITY_KEYS.map((k) => ({
                    value: k,
                    label: t(QC_PRIORITY_META[k].i18nKey),
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="assigneeMemberId"
                label={t("quality.bug.assignee")}
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={memberOptions}
                  placeholder={t("quality.common.unassigned")}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="environmentId"
                label={t("quality.bug.environment")}
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={envOptions}
                  placeholder={t("quality.env.select")}
                  notFoundContent={t("quality.env.emptyForProduct")}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="projectRef"
                label={t("quality.bug.project")}
                rules={[{ required: true }]}
              >
                <TreeSelect
                  showSearch
                  treeDefaultExpandAll
                  treeNodeFilterProp="title"
                  treeData={productTree}
                  popupMatchSelectWidth={false}
                  placeholder={t("quality.bug.selectProduct")}
                  // 製品/版本を切り替えたら、旧版本のタスク紐付けと環境選択はクリア
                  onChange={() => {
                    form.setFieldValue("taskId", undefined);
                    form.setFieldValue("environmentId", undefined);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="taskId" label={t("quality.bug.task")}>
                <TreeSelect
                  allowClear
                  showSearch
                  treeDefaultExpandAll
                  treeNodeFilterProp="title"
                  treeData={taskTreeData}
                  popupMatchSelectWidth={false}
                  placeholder="—"
                  notFoundContent={t("quality.bug.noTask")}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="reportedOn"
                label={t("quality.bug.reportedOn")}
                rules={[{ required: true }]}
              >
                <DatePicker
                  format="YYYY-MM-DD"
                  allowClear={false}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>
            {isEdit && (
              <Col span={12}>
                <Form.Item
                  name="resolvedAt"
                  label={t("quality.bug.resolvedAt")}
                  extra={t("quality.bug.resolvedAtHint")}
                >
                  <DatePicker format="YYYY-MM-DD" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            )}
          </Row>
          <Form.Item name="description" label={t("quality.bug.description")}>
            <RichTextEditor placeholder={t("quality.bug.description")} />
          </Form.Item>
          {/* 編集時のみ：このバグの再現画面・修正案などのモックアップ（即時 CRUD、保存ボタンとは独立） */}
          {isEdit && bug && (
            <>
              <Divider titlePlacement="start" plain>
                {t("mockup.tab")}
              </Divider>
              <MockupPanel bugId={bug.id} />
            </>
          )}
        </Form>
      )}
    </Drawer>
  );
}

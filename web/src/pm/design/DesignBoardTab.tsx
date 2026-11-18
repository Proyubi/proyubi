import {
  ApartmentOutlined,
  DownOutlined,
  LayoutOutlined,
  MoreOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useIntl, useSearchParams } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Segmented,
  Spin,
  Tag,
  TreeSelect,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatWhen } from '../mockup/utils';
import { useData } from '../store';
import { buildTaskTreeData } from '../utils/taskTree';
import {
  type Design,
  type DesignFormat,
  type DesignFrame,
  deleteDesign,
  FRAME_STATUSES,
  type FrameStatus,
  getDesign,
  listDesignFrames,
  listDesigns,
  updateDesignMeta,
} from './api';
import { CreateDesignModal } from './DesignFileModals';
import DesignWorkspace from './DesignWorkspace';
import PenWorkspace, { FRAME_STATUS_COLOR } from './PenWorkspace';
import './design.css';

type Filter = 'all' | DesignFormat;

interface Props {
  projectId: string;
}

/**
 * プロジェクト画面の「デザインボード」タブ。2 種類のボードを並べる：
 * - 画面デザイン（.pen、Figma 相当）：OpenPencil で表示し、画框ごとにレビュー・タスク紐付け
 * - 業務フローボード（Excalidraw、FigJam 相当）：画面・付箋・矢印で業務の流れを描く
 * URL：?tab=design&open=<id>（&frame=<nodeId> で画框を選んだ状態）でワークスペース、
 * &new=pen|excalidraw で新規、&taskId= でタスク初期選択。
 */
export default function DesignBoardTab({ projectId }: Props) {
  const intl = useIntl();
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id }, values),
    [intl],
  );
  const { message, modal } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, tasksOf } = useData();

  const [items, setItems] = useState<Design[]>([]);
  const [frames, setFrames] = useState<Record<string, DesignFrame[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Design | null>(null);
  const [saving, setSaving] = useState(false);
  /** URL で開かれた設計が一覧に無いとき（別案件・削除済みの判定用）に取った種類 */
  const [openFormat, setOpenFormat] = useState<DesignFormat | null>(null);
  const [form] = Form.useForm<{ title: string; taskId?: string }>();

  const openId = searchParams.get('open');
  const newParam = searchParams.get('new');
  const createKind: DesignFormat | null =
    newParam === 'pen' || newParam === 'excalidraw' ? newParam : null;
  const defaultTaskId = searchParams.get('taskId') ?? undefined;

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const load = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    listDesigns({ projectId })
      .then((list) => {
        setItems(list);
        // 画面デザインのカードに画框のレビュー状況を出す
        const pens = list.filter((d) => d.format === 'pen');
        Promise.all(
          pens.map((d) =>
            listDesignFrames(d.id)
              .then((f) => [d.id, f] as const)
              .catch(() => [d.id, [] as DesignFrame[]] as const),
          ),
        ).then((pairs) => setFrames(Object.fromEntries(pairs)));
      })
      .catch(() => {
        setItems([]);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(load, [load]);

  const opened = openId ? items.find((d) => d.id === openId) : undefined;
  useEffect(() => {
    setOpenFormat(null);
    if (!openId || loading || opened) return;
    getDesign(openId, undefined, { content: false })
      .then((d) => setOpenFormat(d.format))
      .catch(() => {
        message.error(t('design.error.notFound'));
        setParam({ open: null });
      });
  }, [openId, loading, opened]);
  const openedFormat = opened?.format ?? openFormat;

  const project = projects.find((p) => p.id === projectId);
  const tasks = tasksOf(projectId);
  const taskTreeData = useMemo(
    () => (project ? buildTaskTreeData([project], tasks) : []),
    [project, tasks],
  );

  const shown = items.filter((d) => filter === 'all' || d.format === filter);

  const openEdit = (d: Design) => {
    setEditing(d);
    form.setFieldsValue({ title: d.title, taskId: d.taskId ?? undefined });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const v = await form.validateFields();
    setSaving(true);
    try {
      await updateDesignMeta(editing.id, {
        title: v.title.trim(),
        ...(v.taskId
          ? { taskId: v.taskId }
          : editing.taskId
            ? { clearTask: true }
            : {}),
      });
      message.success(t('common.updated'));
      setEditing(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = (d: Design) => {
    modal.confirm({
      title: t('design.deleteConfirm', { title: d.title }),
      content: t('design.deleteHint'),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteDesign(d.id);
        message.success(t('common.deleted'));
        load();
      },
    });
  };

  const frameSummary = (d: Design) => {
    const list = (frames[d.id] ?? []).filter((f) => !f.removed);
    if (list.length === 0) return null;
    const count = (s: FrameStatus) =>
      list.filter((f) => f.reviewStatus === s).length;
    return (
      <div className="pm-board-card-frames">
        <span className="pm-design-sub">
          {t('design.board.frames', { n: list.length })}
        </span>
        {FRAME_STATUSES.filter((s) => s !== 'draft' && count(s) > 0).map(
          (s) => (
            <Tag key={s} bordered={false} color={FRAME_STATUS_COLOR[s]}>
              {t(`design.frame.status.${s}`)} {count(s)}
            </Tag>
          ),
        )}
      </div>
    );
  };

  return (
    <div className="pm-board-tab">
      <div className="pm-board-toolbar">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('design.board.filter.all') },
            { value: 'pen', label: t('design.format.pen') },
            { value: 'excalidraw', label: t('design.format.excalidraw') },
          ]}
        />
        <span className="pm-design-spacer" />
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'pen',
                icon: <LayoutOutlined />,
                label: (
                  <div className="pm-board-new-item">
                    <b>{t('design.board.newPen')}</b>
                    <span className="pm-design-sub">
                      {t('design.board.newPenHint')}
                    </span>
                  </div>
                ),
              },
              {
                key: 'excalidraw',
                icon: <ApartmentOutlined />,
                label: (
                  <div className="pm-board-new-item">
                    <b>{t('design.board.newFlow')}</b>
                    <span className="pm-design-sub">
                      {t('design.board.newFlowHint')}
                    </span>
                  </div>
                ),
              },
            ],
            onClick: ({ key }) => setParam({ new: key }),
          }}
        >
          <Button type="primary" icon={<PlusOutlined />}>
            {t('design.page.new')} <DownOutlined />
          </Button>
        </Dropdown>
      </div>

      {loadFailed && (
        <Alert
          className="pm-design-filter"
          type="error"
          showIcon
          message={t('design.error.load')}
          action={
            <Button size="small" onClick={load}>
              {t('design.retry')}
            </Button>
          }
        />
      )}

      {loading && items.length === 0 ? (
        <div className="pm-board-empty">
          <Spin />
        </div>
      ) : shown.length === 0 ? (
        <div className="pm-board-empty">
          <Empty description={t('design.board.empty')} />
        </div>
      ) : (
        <div className="pm-board-cards">
          {shown.map((d) => (
            <div key={d.id} className="pm-board-card">
              <button
                type="button"
                className={`pm-board-card-thumb is-${d.format}`}
                onClick={() => setParam({ open: d.id })}
                aria-label={d.title}
              >
                {d.format === 'pen' ? (
                  <LayoutOutlined />
                ) : (
                  <ApartmentOutlined />
                )}
              </button>
              <div className="pm-board-card-body">
                <div className="pm-board-card-head">
                  <Tag
                    bordered={false}
                    color={d.format === 'pen' ? 'purple' : 'blue'}
                  >
                    {t(`design.format.${d.format}`)}
                  </Tag>
                  <button
                    type="button"
                    className="pm-board-card-title"
                    onClick={() => setParam({ open: d.id })}
                  >
                    {d.title}
                  </button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'edit', label: t('common.edit') },
                        {
                          key: 'delete',
                          label: t('common.delete'),
                          danger: true,
                        },
                      ],
                      onClick: ({ key }) =>
                        key === 'edit' ? openEdit(d) : remove(d),
                    }}
                  >
                    <Button
                      size="small"
                      type="text"
                      icon={<MoreOutlined />}
                      aria-label={t('design.more')}
                    />
                  </Dropdown>
                </div>
                {d.format === 'pen' ? frameSummary(d) : null}
                {d.taskName && (
                  <div className="pm-design-sub">
                    {t('design.field.task')}: {d.taskName}
                  </div>
                )}
                <div className="pm-design-sub">
                  v{d.currentRevision} · {formatWhen(d.updatedAt)}{' '}
                  {d.updatedByName ?? ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateDesignModal
        kind={createKind}
        projectId={projectId}
        taskTreeData={taskTreeData}
        defaultTaskId={defaultTaskId}
        onClose={() => setParam({ new: null })}
        onCreated={(d) => {
          load();
          setParam({ new: null, taskId: null, open: d.id });
        }}
      />

      {openId && openedFormat === 'pen' && (
        <PenWorkspace
          key={openId}
          designId={openId}
          projectId={projectId}
          initialNodeId={searchParams.get('frame')}
          onClose={() => {
            setParam({ open: null, frame: null });
            load();
          }}
          onChanged={load}
        />
      )}
      {openId && openedFormat === 'excalidraw' && (
        <DesignWorkspace
          key={openId}
          designId={openId}
          projectId={projectId}
          onClose={() => setParam({ open: null })}
          onChanged={load}
          onOpen={(id, nodeId) => setParam({ open: id, frame: nodeId ?? null })}
        />
      )}

      <Modal
        open={!!editing}
        title={t('design.edit.title')}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        onOk={saveEdit}
        onCancel={() => setEditing(null)}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label={t('design.field.title')}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          {editing?.format === 'excalidraw' && (
            <Form.Item
              name="taskId"
              label={t('design.field.task')}
              extra={t('design.edit.taskHint')}
            >
              <TreeSelect
                allowClear
                showSearch
                treeDefaultExpandAll
                treeNodeFilterProp="title"
                treeData={taskTreeData}
                popupMatchSelectWidth={false}
                placeholder="—"
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

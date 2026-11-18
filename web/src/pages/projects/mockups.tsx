import { PlusOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useIntl, useNavigate, useParams, useSearchParams } from '@umijs/max';
import {
  App as AntApp,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  TreeSelect,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteMockup, listMockups, updateMockup } from '@/pm/api';
import MockupUploadModal from '@/pm/mockup/MockupUploadModal';
import MockupViewer from '@/pm/mockup/MockupViewer';
import { formatWhen, publisherLabel } from '@/pm/mockup/utils';
import { useData } from '@/pm/store';
import type { Mockup } from '@/pm/types';
import { buildTaskTreeData } from '@/pm/utils/taskTree';

/**
 * 案件のモックアップ一覧（M6）。タイトル・紐付け先の編集と削除はここで行う。
 * 中身の修正は Claude Code 等で直して「新しい版」として公開する（オンライン編集はしない）。
 * ?open=<mockupId> でプレビューを直接開く（pm-mcp の appUrl がこの形）。
 */
export default function ProjectMockupsPage() {
  const { projectId = '' } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const intl = useIntl();
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id }, values),
    [intl],
  );
  const { message, modal } = AntApp.useApp();
  const { projects, ensureBase, loadProject, tasksOf } = useData();

  const [items, setItems] = useState<Mockup[]>([]);
  const [loading, setLoading] = useState(false);
  const [sharedOnly, setSharedOnly] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<Mockup | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{
    title: string;
    taskId?: string;
    clearBug?: boolean;
  }>();

  const openId = searchParams.get('open');
  const setOpenId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set('open', id);
      else next.delete('open');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const closeViewer = useCallback(() => setOpenId(null), [setOpenId]);

  useEffect(() => {
    ensureBase();
    loadProject(projectId);
  }, [ensureBase, loadProject, projectId]);

  const load = useCallback(() => {
    setLoading(true);
    listMockups({ projectId })
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(load, [load]);

  const project = projects.find((p) => p.id === projectId);
  const tasks = tasksOf(projectId);
  const taskTreeData = useMemo(
    () => (project ? buildTaskTreeData([project], tasks) : []),
    [project, tasks],
  );

  const rows = sharedOnly ? items.filter((m) => m.share.enabled) : items;

  const openEdit = (m: Mockup) => {
    setEditing(m);
    form.setFieldsValue({
      title: m.title,
      taskId: m.taskId ?? undefined,
      clearBug: false,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const v = await form.validateFields();
    setSaving(true);
    try {
      await updateMockup(editing.id, {
        title: v.title.trim(),
        ...(v.taskId
          ? { taskId: v.taskId }
          : editing.taskId
            ? { clearTask: true }
            : {}),
        ...(v.clearBug ? { clearBug: true } : {}),
      });
      message.success(t('common.updated'));
      setEditing(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = (m: Mockup) => {
    modal.confirm({
      title: t('mockup.deleteConfirm', { title: m.title }),
      content: t('mockup.deleteHint'),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteMockup(m.id);
        message.success(t('common.deleted'));
        load();
      },
    });
  };

  const columns: ColumnsType<Mockup> = [
    {
      title: t('mockup.col.title'),
      dataIndex: 'title',
      render: (_, m) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => setOpenId(m.id)}
        >
          {m.title}
        </Button>
      ),
    },
    {
      title: t('mockup.col.linked'),
      key: 'linked',
      render: (_, m) =>
        m.bugId ? (
          <Space size={4}>
            <Tag color="red" bordered={false}>
              {t('mockup.linked.bug')}
            </Tag>
            {[m.bugNo, m.bugTitle].filter(Boolean).join(' ')}
          </Space>
        ) : m.taskId ? (
          <Space size={4}>
            <Tag color="blue" bordered={false}>
              {t('mockup.linked.task')}
            </Tag>
            {m.taskName}
          </Space>
        ) : (
          <Tag bordered={false}>{t('mockup.linked.project')}</Tag>
        ),
    },
    {
      title: t('mockup.col.version'),
      dataIndex: 'currentVersion',
      width: 70,
      render: (v: number) => `v${v}`,
    },
    {
      title: t('mockup.col.share'),
      key: 'share',
      width: 110,
      render: (_, m) =>
        m.share.enabled ? (
          <Tag color="green" bordered={false}>
            {t('mockup.chip.shared')}
          </Tag>
        ) : (
          '—'
        ),
    },
    {
      title: t('mockup.col.updated'),
      key: 'updated',
      width: 200,
      render: (_, m) => (
        <span className="pm-mockup-sub">
          {formatWhen(m.updatedAt)} {publisherLabel(m.updatedByName, m.lastVia)}
        </span>
      ),
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 140,
      render: (_, m) => (
        <Space size={4}>
          <Button size="small" onClick={() => openEdit(m)}>
            {t('common.edit')}
          </Button>
          <Button size="small" danger onClick={() => remove(m)}>
            {t('common.delete')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      title={
        project
          ? t('mockup.page.titleOf', { name: project.name })
          : t('mockup.page.title')
      }
      subTitle={t('mockup.page.subtitle')}
      onBack={() => nav(`/projects/${projectId}/gantt`)}
      extra={[
        <Checkbox
          key="shared"
          checked={sharedOnly}
          onChange={(e) => setSharedOnly(e.target.checked)}
        >
          {t('mockup.page.sharedOnly')}
        </Checkbox>,
        <Button
          key="upload"
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setUploadOpen(true)}
        >
          {t('mockup.page.upload')}
        </Button>,
      ]}
    >
      <Table<Mockup>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 800 }}
        locale={{ emptyText: t('mockup.empty') }}
      />

      <MockupUploadModal
        open={uploadOpen}
        scope={{ projectId }}
        onClose={() => setUploadOpen(false)}
        onDone={(m) => {
          setUploadOpen(false);
          load();
          setOpenId(m.id);
        }}
      />
      <MockupViewer mockupId={openId} onClose={closeViewer} onChanged={load} />

      <Modal
        open={!!editing}
        title={t('mockup.edit.title')}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        onOk={saveEdit}
        onCancel={() => setEditing(null)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label={t('mockup.field.title')}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="taskId"
            label={t('mockup.edit.task')}
            extra={t('mockup.edit.taskHint')}
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
          {editing?.bugId && (
            <Form.Item name="clearBug" valuePropName="checked">
              <Checkbox>
                {t('mockup.edit.clearBug', {
                  bug: [editing.bugNo, editing.bugTitle]
                    .filter(Boolean)
                    .join(' '),
                })}
              </Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </PageContainer>
  );
}

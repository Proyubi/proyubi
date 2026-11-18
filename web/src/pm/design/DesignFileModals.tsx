import { InboxOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { App, Form, Input, Modal, Radio, TreeSelect, Upload } from 'antd';
import { useEffect, useState } from 'react';
import {
  createDesign,
  type Design,
  type DesignFormat,
  saveDesign,
} from './api';
import { DESIGN_MAX_BYTES, PEN_MAX_BYTES, readDesignFile } from './scene';

type TreeData = React.ComponentProps<typeof TreeSelect>['treeData'];

function FileDrop({
  file,
  onFile,
  format,
}: {
  file: File | null;
  onFile: (f: File) => void;
  format: DesignFormat;
}) {
  const intl = useIntl();
  const t = (id: string, v?: Record<string, string | number>) =>
    intl.formatMessage({ id }, v);
  return (
    <Upload.Dragger
      accept={format === 'pen' ? '.pen' : '.excalidraw,.json'}
      multiple={false}
      showUploadList={false}
      beforeUpload={(f) => {
        onFile(f);
        return false;
      }}
    >
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p>{file ? file.name : t('design.file.drop')}</p>
      <p className="pm-design-sub">
        {format === 'pen'
          ? t('design.file.hintPen', { mb: PEN_MAX_BYTES / 1024 / 1024 })
          : t('design.file.hint', { mb: DESIGN_MAX_BYTES / 1024 / 1024 })}
      </p>
    </Upload.Dragger>
  );
}

function useFileError() {
  const intl = useIntl();
  return (code: string) =>
    intl.formatMessage({ id: `design.error.${code}`, defaultMessage: code });
}

interface CreateProps {
  /** pen = 画面デザイン（.pen をアップロード）、excalidraw = 業務フローボード（空 or .excalidraw 取り込み） */
  kind: DesignFormat | null;
  projectId: string;
  taskTreeData: TreeData;
  defaultTaskId?: string;
  onClose: () => void;
  onCreated: (d: Design) => void;
}

/** 新規：画面デザイン（.pen アップロード）/ 業務フローボード（空 or .excalidraw 取り込み） */
export function CreateDesignModal({
  kind,
  projectId,
  taskTreeData,
  defaultTaskId,
  onClose,
  onCreated,
}: CreateProps) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const fileError = useFileError();
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    title?: string;
    taskId?: string;
    mode: 'blank' | 'file';
  }>();
  const open = kind !== null;
  const isPen = kind === 'pen';
  const mode = Form.useWatch('mode', form);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      mode: isPen ? 'file' : 'blank',
      taskId: defaultTaskId,
    });
    setFile(null);
  }, [open, isPen, defaultTaskId, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const base = {
      projectId,
      taskId: v.taskId || undefined,
      title: v.title?.trim() || undefined,
    };
    let req: Parameters<typeof createDesign>[0];
    if (isPen || v.mode === 'file') {
      if (!file) {
        message.warning(t('design.file.need'));
        return;
      }
      const read = await readDesignFile(file);
      if (!read.ok) {
        message.error(fileError(read.error));
        return;
      }
      if (read.format !== kind) {
        message.error(fileError('format'));
        return;
      }
      req =
        read.format === 'pen'
          ? {
              ...base,
              format: 'pen',
              contentBase64: read.contentBase64,
              fileName: read.fileName,
            }
          : {
              ...base,
              format: 'excalidraw',
              content: read.content,
              fileName: read.fileName,
            };
    } else {
      req = {
        ...base,
        format: 'excalidraw',
        title: base.title ?? t('design.untitled'),
      };
    }
    setSaving(true);
    try {
      const d = await createDesign(req);
      onCreated(d);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t(isPen ? 'design.create.penTitle' : 'design.create.boardTitle')}
      okText={t('design.create.ok')}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        {isPen ? (
          <p className="pm-design-sub">{t('design.create.penHint')}</p>
        ) : (
          <Form.Item name="mode" label={t('design.create.mode')}>
            <Radio.Group
              options={[
                { value: 'blank', label: t('design.create.blank') },
                { value: 'file', label: t('design.create.file') },
              ]}
            />
          </Form.Item>
        )}
        {(isPen || mode === 'file') && (
          <Form.Item>
            <FileDrop file={file} onFile={setFile} format={kind ?? 'pen'} />
          </Form.Item>
        )}
        <Form.Item name="title" label={t('design.field.title')}>
          <Input
            maxLength={200}
            placeholder={t('design.field.titlePlaceholder')}
          />
        </Form.Item>
        {/* 画面デザインのタスクは画框単位で紐付ける（ワークスペースの右パネル） */}
        {!isPen && (
          <Form.Item name="taskId" label={t('design.field.task')}>
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
  );
}

interface RevisionProps {
  open: boolean;
  design: Design | null;
  onClose: () => void;
  onSaved: (d: Design) => void;
  /** 409 / 由来の競合（画面で最新を読み直させる） */
  onConflict: (message: string) => void;
}

/**
 * ファイルから新しい版を取り込む（Pencil で編集した .pen / 書き出した .excalidraw）。
 * expectedRevision = 開いている版。他の人が先に取り込んでいれば 409。
 */
export function UploadRevisionModal({
  open,
  design,
  onClose,
  onSaved,
  onConflict,
}: RevisionProps) {
  const intl = useIntl();
  const t = (id: string, v?: Record<string, string | number>) =>
    intl.formatMessage({ id }, v);
  const fileError = useFileError();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ note?: string }>();
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !design) return;
    form.resetFields();
    setFile(null);
  }, [open, design, form]);

  if (!design) return null;

  const submit = async () => {
    if (!file) {
      message.warning(t('design.file.need'));
      return;
    }
    const read = await readDesignFile(file);
    if (!read.ok) {
      message.error(fileError(read.error));
      return;
    }
    if (read.format !== (design.format as DesignFormat)) {
      message.error(fileError('format'));
      return;
    }
    const v = form.getFieldsValue();
    setSaving(true);
    try {
      const d = await saveDesign(design.id, {
        expectedRevision: design.currentRevision,
        ...(read.format === 'pen'
          ? { contentBase64: read.contentBase64 }
          : { content: read.content }),
        fileName: read.fileName,
        note: v.note?.trim() || undefined,
      });
      onSaved(d);
    } catch (e) {
      const err = e as { code?: number; message?: string };
      if (err.code === 409) onConflict(err.message ?? '');
      else message.error(err.message || t('design.error.save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('design.upload.title', { rev: design.currentRevision + 1 })}
      okText={t('design.upload.ok')}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item>
          <FileDrop file={file} onFile={setFile} format={design.format} />
        </Form.Item>
        <Form.Item name="note" label={t('design.field.note')}>
          <Input maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

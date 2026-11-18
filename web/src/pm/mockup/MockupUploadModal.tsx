import { InboxOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { App, Form, Input, Modal, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { uploadMockup } from '../api';
import type { Mockup } from '../types';
import { checkMockupFile, formatSize, MOCKUP_ACCEPT } from './utils';

interface Props {
  open: boolean;
  /** 指定時＝既存モックアップの新しい版（タイトル・紐付けは変えない） */
  mockupId?: string;
  /** 新規時の紐付け先（taskId / bugId 優先、どちらも無ければ projectId） */
  scope?: { projectId?: string; taskId?: string; bugId?: string };
  /** ドロップ領域から渡された初期ファイル */
  initialFile?: File | null;
  onClose: () => void;
  onDone: (m: Mockup) => void;
}

/**
 * HTML / zip のアップロード（新規公開 / 新しい版）。
 * ファイルは multipart でそのまま送る。zip はサーバで展開し、入口 HTML（index.html）+ 画像などの付属ファイルとして保存。
 * 上限・パス検査・sha256 重複判定はサーバ側。タイトル空欄ならサーバが入口 HTML の <title> から付ける。
 */
export default function MockupUploadModal({
  open,
  mockupId,
  scope,
  initialFile,
  onClose,
  onDone,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message } = App.useApp();
  const [form] = Form.useForm<{ title?: string; note?: string }>();
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setFile(initialFile ?? null);
  }, [open, initialFile, form]);

  const submit = async () => {
    if (!file) {
      message.warning(t('mockup.upload.needFile'));
      return;
    }
    const checked = await checkMockupFile(file);
    if (!checked.ok) {
      message.error(t(`mockup.upload.error.${checked.error}`));
      return;
    }
    const { title, note } = form.getFieldsValue();
    setSaving(true);
    try {
      const m = await uploadMockup({
        file,
        note: note?.trim() || undefined,
        ...(mockupId
          ? { mockupId }
          : {
              title: title?.trim() || undefined,
              ...(scope?.taskId || scope?.bugId
                ? { taskId: scope.taskId, bugId: scope.bugId }
                : { projectId: scope?.projectId }),
            }),
      });
      message.success(t('mockup.upload.done', { v: m.currentVersion }));
      onDone(m);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        mockupId ? t('mockup.upload.newVersion') : t('mockup.upload.title')
      }
      okText={t('mockup.upload.publish')}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnClose
    >
      <Upload.Dragger
        accept={MOCKUP_ACCEPT}
        multiple={false}
        showUploadList={false}
        beforeUpload={(f) => {
          setFile(f);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          {file ? file.name : t('mockup.upload.drop')}
        </p>
        <p className="ant-upload-hint">
          {file ? formatSize(file.size) : t('mockup.upload.hint')}
        </p>
      </Upload.Dragger>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {!mockupId && (
          <Form.Item name="title" label={t('mockup.field.title')}>
            <Input
              maxLength={200}
              placeholder={t('mockup.field.titlePlaceholder')}
            />
          </Form.Item>
        )}
        <Form.Item name="note" label={t('mockup.field.note')}>
          <Input
            maxLength={500}
            placeholder={t('mockup.field.notePlaceholder')}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

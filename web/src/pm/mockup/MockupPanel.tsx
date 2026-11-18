import { InboxOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { App, Empty, Spin, Tag, Upload } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { listMockups } from '../api';
import type { Mockup } from '../types';
import MockupUploadModal from './MockupUploadModal';
import MockupViewer from './MockupViewer';
import {
  checkMockupFile,
  formatWhen,
  MOCKUP_ACCEPT,
  publisherLabel,
} from './utils';
import './mockup.css';

interface Props {
  /** 一覧・新規公開の紐付け先。taskId / bugId / projectId のいずれか */
  taskId?: string;
  bugId?: string;
  projectId?: string;
}

/**
 * タスク詳細 / バグ詳細の「モックアップ」（M2）：カード一覧 + HTML ドロップ領域。
 * カードを開くと全画面プレビュー（MockupViewer）。即時 CRUD（フォーム保存とは独立）。
 */
export default function MockupPanel({ taskId, bugId, projectId }: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message } = App.useApp();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Mockup[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dropFile, setDropFile] = useState<File | null>(null);

  const scope = taskId ? { taskId } : bugId ? { bugId } : { projectId };

  const load = useCallback(() => {
    if (!taskId && !bugId && !projectId) return;
    setLoading(true);
    listMockups(taskId ? { taskId } : bugId ? { bugId } : { projectId })
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [taskId, bugId, projectId]);

  useEffect(load, [load]);

  const closeViewer = useCallback(() => setOpenId(null), []);

  return (
    <div className="pm-mockup-panel">
      {loading ? (
        <div className="pm-mockup-loading">
          <Spin size="small" />
        </div>
      ) : items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('mockup.empty')}
        />
      ) : (
        <ul className="pm-mockup-cards">
          {items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="pm-mockup-card"
                onClick={() => setOpenId(m.id)}
              >
                <span className="pm-mockup-thumb" aria-hidden>
                  <i className="b" />
                  <i />
                  <i style={{ width: '80%' }} />
                  <i />
                </span>
                <span className="pm-mockup-card-meta">
                  <b className="pm-mockup-card-title" title={m.title}>
                    {m.title}
                  </b>
                  <span className="pm-mockup-sub">
                    v{m.currentVersion} ·{' '}
                    {publisherLabel(m.updatedByName, m.lastVia)} ·{' '}
                    {formatWhen(m.updatedAt)}
                  </span>
                  <span>
                    {m.share.enabled ? (
                      <Tag color="green" bordered={false}>
                        {m.share.expiresAt
                          ? t('mockup.chip.sharedUntil', {
                              date: formatWhen(m.share.expiresAt).slice(0, 5),
                            })
                          : t('mockup.chip.shared')}
                      </Tag>
                    ) : (
                      <Tag bordered={false}>{t('mockup.chip.internal')}</Tag>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Upload.Dragger
        className="pm-mockup-drop"
        accept={MOCKUP_ACCEPT}
        multiple={false}
        showUploadList={false}
        beforeUpload={async (f) => {
          const r = await checkMockupFile(f);
          if (!r.ok) message.error(t(`mockup.upload.error.${r.error}`));
          else setDropFile(f);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">{t('mockup.upload.drop')}</p>
        <p className="ant-upload-hint">{t('mockup.upload.hint')}</p>
      </Upload.Dragger>

      <MockupUploadModal
        open={!!dropFile}
        initialFile={dropFile}
        scope={scope}
        onClose={() => setDropFile(null)}
        onDone={(m) => {
          setDropFile(null);
          load();
          setOpenId(m.id);
        }}
      />
      <MockupViewer mockupId={openId} onClose={closeViewer} onChanged={load} />
    </div>
  );
}

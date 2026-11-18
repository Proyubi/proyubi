import {
  CloseOutlined,
  DeleteOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  ExportOutlined,
  ShareAltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import {
  App,
  Button,
  Modal,
  Segmented,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteMockupVersion,
  getMockup,
  getMockupViewUrl,
  updateMockup,
} from '../api';
import type { Mockup } from '../types';
import MockupFrame from './MockupFrame';
import MockupShareModal from './MockupShareModal';
import MockupUploadModal from './MockupUploadModal';
import {
  DEVICE_WIDTH,
  type Device,
  formatSize,
  formatWhen,
  publisherLabel,
} from './utils';
import './mockup.css';

interface Props {
  /** null で閉じる */
  mockupId: string | null;
  onClose: () => void;
  /** 版の追加・削除・改名・共有変更のあと（一覧の再取得用） */
  onChanged?: () => void;
}

/** 版パネルの折りたたみはビューアーごとの好み。保存できない環境（プライベートモード等）では毎回開いた状態 */
const VERSIONS_COLLAPSED_KEY = 'pm.mockup.versionsCollapsed';

function readVersionsCollapsed(): boolean {
  try {
    return window.localStorage.getItem(VERSIONS_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeVersionsCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(VERSIONS_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // 保存できなくても開閉は効く
  }
}

/**
 * 全画面プレビュー（M3）：サンドボックス iframe + 表示幅切替 + 右側の版リスト（折りたたみ可）。
 * 原文 URL は短期署名付き（view-url）を都度取得する。
 */
export default function MockupViewer({ mockupId, onClose, onChanged }: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message, modal } = App.useApp();

  const [mockup, setMockup] = useState<Mockup | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [shareOpen, setShareOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionsCollapsed, setVersionsCollapsed] = useState(
    readVersionsCollapsed,
  );
  const versionsToggleRef = useRef<HTMLButtonElement>(null);
  const restoreVersionsFocus = useRef(false);
  const toggleVersions = () => {
    restoreVersionsFocus.current = true;
    const next = !versionsCollapsed;
    setVersionsCollapsed(next);
    writeVersionsCollapsed(next);
  };
  useEffect(() => {
    if (restoreVersionsFocus.current) {
      versionsToggleRef.current?.focus();
      restoreVersionsFocus.current = false;
    }
  }, [versionsCollapsed]);

  // onClose は呼び出し側で毎レンダー作り直されてもよいように ref 経由で使う
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const reload = useCallback(async (id: string, keepVersion?: number) => {
    const m = await getMockup(id);
    setMockup(m);
    const exists = m.versions?.some((v) => v.version === keepVersion);
    setVersion(keepVersion && exists ? keepVersion : m.currentVersion);
    return m;
  }, []);

  useEffect(() => {
    setMockup(null);
    setUrl(null);
    setVersion(null);
    setDevice('desktop');
    if (!mockupId) return;
    reload(mockupId).catch(() => onCloseRef.current());
  }, [mockupId, reload]);

  useEffect(() => {
    if (!mockupId || !version) return;
    let alive = true;
    setUrl(null);
    getMockupViewUrl(mockupId, version)
      .then((r) => alive && setUrl(r.url))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [mockupId, version]);

  const changed = (m?: Mockup) => {
    if (m)
      setMockup((prev) => ({ ...m, versions: m.versions ?? prev?.versions }));
    onChanged?.();
  };

  const rename = async (title: string) => {
    if (!mockup) return;
    const v = title.trim();
    if (!v || v === mockup.title) return;
    changed(await updateMockup(mockup.id, { title: v }));
    message.success(t('common.updated'));
  };

  const removeVersion = (v: number) => {
    if (!mockup) return;
    modal.confirm({
      title: t('mockup.version.deleteConfirm', { v }),
      content: t('mockup.version.deleteHint'),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteMockupVersion(mockup.id, v);
        await reload(
          mockup.id,
          version === v ? undefined : (version ?? undefined),
        );
        onChanged?.();
        message.success(t('common.deleted'));
      },
    });
  };

  const versions = mockup?.versions ?? [];

  return (
    <Modal
      open={!!mockupId}
      onCancel={onClose}
      footer={null}
      closable={false}
      // 100vw はスクロールバー幅ぶんはみ出すため、サイズ・余白は rootClassName 側の CSS で固定する
      rootClassName="pm-mockup-viewer-root"
      width="100%"
      styles={{ container: { padding: 0, borderRadius: 0 } }}
      destroyOnClose
    >
      <div className="pm-mockup-viewer">
        <div className="pm-mockup-vbar">
          <div className="pm-mockup-vbar-title">
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={onClose}
              aria-label={t('mockup.viewer.close')}
            />
            {mockup && (
              <>
                <Typography.Text
                  strong
                  className="pm-mockup-vtitle"
                  ellipsis={{ tooltip: mockup.title }}
                  editable={{ onChange: rename, tooltip: t('common.edit') }}
                >
                  {mockup.title}
                </Typography.Text>
                {version != null && <Tag color="blue">v{version}</Tag>}
              </>
            )}
          </div>
          <div className="pm-mockup-vbar-actions">
            <Segmented<Device>
              size="small"
              value={device}
              onChange={setDevice}
              options={[
                { value: 'desktop', label: t('mockup.viewer.desktop') },
                { value: 'tablet', label: t('mockup.viewer.tablet') },
                { value: 'phone', label: t('mockup.viewer.phone') },
              ]}
            />
            <Button
              size="small"
              icon={<ExportOutlined />}
              disabled={!url}
              href={url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('mockup.viewer.openTab')}
            </Button>
            <Button
              size="small"
              icon={<UploadOutlined />}
              disabled={!mockup}
              onClick={() => setUploadOpen(true)}
            >
              {t('mockup.viewer.newVersion')}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<ShareAltOutlined />}
              disabled={!mockup}
              onClick={() => setShareOpen(true)}
            >
              {t('mockup.viewer.share')}
            </Button>
          </div>
        </div>
        <div
          className={`pm-mockup-vbody${versionsCollapsed ? ' is-collapsed' : ''}`}
        >
          <div className="pm-mockup-stage">
            {url ? (
              <MockupFrame
                className="pm-mockup-frame"
                style={{ width: DEVICE_WIDTH[device] }}
                src={url}
                title={mockup?.title ?? 'mockup'}
              />
            ) : (
              <Spin />
            )}
          </div>
          {versionsCollapsed ? (
            <aside className="pm-mockup-versions-rail">
              <Tooltip title={t('mockup.version.expand')} placement="left">
                <button
                  ref={versionsToggleRef}
                  type="button"
                  className="pm-mockup-versions-rail-btn"
                  aria-label={t('mockup.version.expand')}
                  aria-expanded={false}
                  onClick={toggleVersions}
                >
                  <DoubleLeftOutlined />
                  <span className="pm-mockup-versions-rail-label">
                    {t('mockup.version.title')}
                  </span>
                  {versions.length > 0 && (
                    <span className="pm-mockup-versions-rail-count">
                      {versions.length}
                    </span>
                  )}
                </button>
              </Tooltip>
            </aside>
          ) : (
            <aside className="pm-mockup-versions">
              <div className="pm-mockup-versions-head">
                <span>{t('mockup.version.title')}</span>
                <Tooltip title={t('mockup.version.collapse')} placement="left">
                  <Button
                    ref={versionsToggleRef}
                    type="text"
                    size="small"
                    icon={<DoubleRightOutlined />}
                    aria-label={t('mockup.version.collapse')}
                    aria-expanded
                    onClick={toggleVersions}
                  />
                </Tooltip>
              </div>
              {versions.map((v) => (
                <div
                  key={v.version}
                  className={`pm-mockup-ver${v.version === version ? ' is-on' : ''}`}
                >
                  <button
                    type="button"
                    className="pm-mockup-ver-main"
                    onClick={() => setVersion(v.version)}
                  >
                    <span className="pm-mockup-ver-head">
                      <b>v{v.version}</b>
                      <span className="pm-mockup-sub">
                        {formatWhen(v.createdAt)}
                      </span>
                    </span>
                    {v.note && (
                      <span className="pm-mockup-ver-note">{v.note}</span>
                    )}
                    <span className="pm-mockup-sub">
                      {publisherLabel(v.createdByName, v.via)} ·{' '}
                      {formatSize(v.sizeBytes)}
                      {v.fileCount > 1 &&
                        ` · ${t('mockup.version.files', { n: v.fileCount })}`}
                    </span>
                  </button>
                  {versions.length > 1 && (
                    <Tooltip title={t('common.delete')}>
                      <Button
                        className="pm-mockup-ver-del"
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        aria-label={t('common.delete')}
                        onClick={() => removeVersion(v.version)}
                      />
                    </Tooltip>
                  )}
                </div>
              ))}
              {mockup && (
                <div className="pm-mockup-sub">
                  {mockup.share.enabled
                    ? mockup.share.pinnedVersion
                      ? t('mockup.version.sharePinned', {
                          v: mockup.share.pinnedVersion,
                        })
                      : t('mockup.version.shareLatest')
                    : t('mockup.version.notShared')}
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
      {mockup && shareOpen && (
        <MockupShareModal
          open
          mockup={mockup}
          onClose={() => setShareOpen(false)}
          onChanged={changed}
        />
      )}
      {mockup && (
        <MockupUploadModal
          open={uploadOpen}
          mockupId={mockup.id}
          onClose={() => setUploadOpen(false)}
          onDone={async (m) => {
            setUploadOpen(false);
            await reload(m.id);
            onChanged?.();
          }}
        />
      )}
    </Modal>
  );
}

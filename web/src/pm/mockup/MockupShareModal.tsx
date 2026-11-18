import { CopyOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import {
  App,
  Button,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
} from 'antd';
import { useState } from 'react';
import {
  mockupShareUrl,
  regenerateMockupShare,
  updateMockupShare,
} from '../api';
import type { Mockup } from '../types';
import { fmt } from '../utils/date';
import { formatWhen } from './utils';

interface Props {
  mockup: Mockup;
  open: boolean;
  onClose: () => void;
  onChanged: (m: Mockup) => void;
}

type Expiry = '7' | '30' | 'never';

/**
 * 共有設定（M4）。操作のたびに即保存する（「完了」は閉じるだけ）。
 * 期限は「今から N 日」で再設定するため、既存の期限は日付表示のみ（どのプリセットも選択状態にしない）。
 */
export default function MockupShareModal({
  mockup,
  open,
  onClose,
  onChanged,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message, modal } = App.useApp();
  const share = mockup.share;
  const [busy, setBusy] = useState(false);
  const [expiry, setExpiry] = useState<Expiry | undefined>(
    share.token && !share.expiresAt ? 'never' : undefined,
  );

  const days = (e: Expiry | undefined): number | null =>
    e === '7' ? 7 : e === 'never' ? null : 30;

  const save = async (patch: {
    enabled?: boolean;
    expiry?: Expiry;
    pinnedVersion?: number | null;
  }) => {
    const nextExpiry = patch.expiry ?? expiry;
    // 期限未操作で既存期限ありの場合は残日数で送り直す（期限を勝手に延ばさない）
    let expiresInDays = days(nextExpiry);
    if (!patch.expiry && nextExpiry === undefined && share.expiresAt) {
      const left = Math.ceil(
        (new Date(share.expiresAt).getTime() - Date.now()) / 86400000,
      );
      expiresInDays = Math.max(1, left);
    }
    setBusy(true);
    try {
      const m = await updateMockupShare(mockup.id, {
        enabled: patch.enabled ?? share.enabled,
        expiresInDays,
        pinnedVersion:
          patch.pinnedVersion !== undefined
            ? patch.pinnedVersion
            : share.pinnedVersion,
      });
      if (patch.expiry) setExpiry(patch.expiry);
      onChanged(m);
    } finally {
      setBusy(false);
    }
  };

  const url = share.token ? mockupShareUrl(share.token) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      message.success(t('mockup.share.copied'));
    } catch {
      message.error(t('mockup.share.copyFailed'));
    }
  };

  const regenerate = () => {
    modal.confirm({
      title: t('mockup.share.regenerateConfirm'),
      content: t('mockup.share.regenerateHint'),
      okText: t('mockup.share.regenerate'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        const m = await regenerateMockupShare(mockup.id);
        onChanged(m);
        message.success(t('mockup.share.regenerated'));
      },
    });
  };

  const versionOptions = [
    { value: 0, label: t('mockup.share.latest') },
    ...(mockup.versions ?? []).map((v) => ({
      value: v.version,
      label: t('mockup.share.pinTo', { v: v.version }),
    })),
  ];

  return (
    <Modal
      open={open}
      title={t('mockup.share.title', { title: mockup.title })}
      onCancel={onClose}
      footer={
        <Space>
          <Button disabled={!share.enabled || busy} onClick={regenerate}>
            {t('mockup.share.regenerate')}
          </Button>
          <Button type="primary" onClick={onClose}>
            {t('mockup.share.done')}
          </Button>
        </Space>
      }
    >
      <div className="pm-mockup-share">
        <div className="pm-mockup-share-row">
          <span>{t('mockup.share.enable')}</span>
          <Switch
            checked={share.enabled}
            loading={busy}
            onChange={(v) => save({ enabled: v })}
          />
        </div>
        {share.enabled && share.token && (
          <>
            <div className="pm-mockup-share-field">
              <span className="pm-mockup-share-label">
                {t('mockup.share.link')}
              </span>
              <Space.Compact style={{ width: '100%' }}>
                <Input value={url} readOnly />
                <Button icon={<CopyOutlined />} onClick={copy}>
                  {t('mockup.share.copy')}
                </Button>
              </Space.Compact>
            </div>
            <div className="pm-mockup-share-field">
              <span className="pm-mockup-share-label">
                {t('mockup.share.expiry')}
              </span>
              <Segmented<Expiry>
                value={expiry as Expiry}
                disabled={busy}
                onChange={(v) => save({ expiry: v })}
                options={[
                  { value: '7', label: t('mockup.share.days7') },
                  { value: '30', label: t('mockup.share.days30') },
                  { value: 'never', label: t('mockup.share.never') },
                ]}
              />
              <span className="pm-mockup-sub">
                {share.expiresAt
                  ? t('mockup.share.until', {
                      date: fmt(share.expiresAt, 'YYYY-MM-DD'),
                    })
                  : t('mockup.share.noExpiry')}
              </span>
            </div>
            <div className="pm-mockup-share-field">
              <span className="pm-mockup-share-label">
                {t('mockup.share.version')}
              </span>
              <Select
                value={share.pinnedVersion ?? 0}
                disabled={busy}
                options={versionOptions}
                onChange={(v) => save({ pinnedVersion: v === 0 ? null : v })}
                style={{ width: 220 }}
              />
            </div>
            <div className="pm-mockup-sub">
              {t('mockup.share.views', {
                n: share.viewCount,
                last: formatWhen(share.lastViewedAt),
              })}
            </div>
          </>
        )}
        {!share.enabled && (
          <div className="pm-mockup-sub">{t('mockup.share.offHint')}</div>
        )}
      </div>
    </Modal>
  );
}

import { useIntl, useParams } from '@umijs/max';
import { Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { LOGO_URL } from '@/constants/assets';
import { getPublicMockupShare } from '@/pm/api';
import MockupFrame from '@/pm/mockup/MockupFrame';
import type { PublicMockupShare } from '@/pm/types';
import { fmt } from '@/pm/utils/date';
import './mockup.css';

/**
 * モックアップの対外共有ページ（M5）。ログイン不要（app.tsx PUBLIC_PATHS に "/share"）。
 * 自社ドメインのタイトルバー + 原文のサンドボックス iframe だけを出す。
 * 無効（停止 / 期限切れ / 削除 / 存在しない）は理由を区別せず一律「無効」表示にする。
 */
export default function MockupSharePage() {
  const { token = '' } = useParams();
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const [data, setData] = useState<PublicMockupShare | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'invalid'>('loading');

  useEffect(() => {
    let alive = true;
    setState('loading');
    getPublicMockupShare(token)
      .then((d) => {
        if (!alive) return;
        // skipErrorHandler 下では {code,msg} が素で返ることもあるため viewUrl で判定
        if (d && typeof d.viewUrl === 'string' && d.viewUrl) {
          setData(d);
          setState('ok');
          document.title = d.title;
        } else {
          setState('invalid');
        }
      })
      .catch(() => alive && setState('invalid'));
    return () => {
      alive = false;
    };
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="share-mockup-center">
        <Spin />
      </div>
    );
  }

  if (state === 'invalid' || !data) {
    return (
      <div className="share-mockup-center">
        <img src={LOGO_URL} alt="" className="share-mockup-logo" />
        <p className="share-mockup-invalid">{t('mockup.public.invalid')}</p>
      </div>
    );
  }

  const context = [data.customerName, data.projectName]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="share-mockup">
      <header className="share-mockup-top">
        <div className="share-mockup-brand">
          <img src={LOGO_URL} alt="" className="share-mockup-logo" />
          <b className="share-mockup-title" title={data.title}>
            {data.title}
          </b>
          {context && <span className="share-mockup-sub">{context}</span>}
        </div>
        <div className="share-mockup-meta">
          <Tag bordered={false}>
            {t('mockup.public.version', {
              v: data.version,
              date: fmt(data.updatedAt, 'MM/DD'),
            })}
          </Tag>
          {data.expiresAt && (
            <span className="share-mockup-sub">
              {t('mockup.public.validUntil', {
                date: fmt(data.expiresAt, 'YYYY-MM-DD'),
              })}
            </span>
          )}
        </div>
      </header>
      <MockupFrame
        className="share-mockup-frame"
        src={data.viewUrl}
        title={data.title}
      />
    </div>
  );
}

import { useIntl } from '@umijs/max';
import { Spin } from 'antd';
import { type CSSProperties, useEffect, useState } from 'react';
import { MOCKUP_SANDBOX } from './utils';
import './mockup.css';

/** これを過ぎても load しなければ「時間がかかっています」を出す */
const SLOW_MS = 15000;

interface Props {
  src: string;
  title: string;
  /** 外枠（サイズ・影など）。iframe は外枠いっぱいに広がる */
  className?: string;
  style?: CSSProperties;
}

/**
 * 原文のサンドボックス iframe + 読み込み中オーバーレイ。
 * sandbox（opaque origin）のため中身は覗けず、エラーページでも load は発火する：
 * ここで分かるのは「読み込みが終わったか」だけ。
 */
export default function MockupFrame({ src, title, className, style }: Props) {
  const intl = useIntl();
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [src]);

  return (
    <div className={`pm-mockup-framebox ${className ?? ''}`} style={style}>
      <iframe
        key={src}
        className="pm-mockup-framebox-el"
        src={src}
        sandbox={MOCKUP_SANDBOX}
        referrerPolicy="no-referrer"
        title={title}
        onLoad={() => setLoaded(true)}
      />
      {!loaded && (
        <div className="pm-mockup-framebox-loading" aria-live="polite">
          <Spin />
          <span>
            {intl.formatMessage({
              id: slow ? 'mockup.viewer.slow' : 'mockup.viewer.loading',
            })}
          </span>
        </div>
      )}
    </div>
  );
}

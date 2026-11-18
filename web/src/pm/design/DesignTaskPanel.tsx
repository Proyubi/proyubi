import { PlusOutlined } from '@ant-design/icons';
import { useIntl, useNavigate } from '@umijs/max';
import { Button, Empty, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { formatWhen } from '../mockup/utils';
import {
  type Design,
  type DesignFrame,
  listDesigns,
  listFramesByTask,
} from './api';
import { FRAME_STATUS_COLOR } from './PenWorkspace';
import './design.css';

interface Props {
  taskId: string;
  projectId: string;
}

/**
 * タスク詳細の「デザイン」タブ：このタスクに紐付いた画面（.pen の画框）と業務フローボードを一覧し、
 * プロジェクト画面のデザインボードタブで開く。
 */
export default function DesignTaskPanel({ taskId, projectId }: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const nav = useNavigate();
  const [boards, setBoards] = useState<Design[]>([]);
  const [frames, setFrames] = useState<DesignFrame[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    Promise.all([listDesigns({ taskId }), listFramesByTask(taskId)])
      .then(([d, f]) => {
        setBoards(d.filter((x) => x.format === 'excalidraw'));
        setFrames(f);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [taskId]);

  const base = `/projects/${projectId}/gantt?tab=design`;

  return (
    <div className="pm-design-task-panel">
      {loading ? (
        <Spin size="small" />
      ) : failed ? (
        <div className="pm-design-error">{t('design.error.load')}</div>
      ) : boards.length === 0 && frames.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('design.task.empty')}
        />
      ) : (
        <ul className="pm-design-task-list">
          {frames.map((f) => (
            <li key={`${f.designId}/${f.nodeId}`}>
              <Button
                type="link"
                onClick={() =>
                  nav(
                    `${base}&open=${f.designId}&frame=${encodeURIComponent(f.nodeId)}`,
                  )
                }
              >
                {f.name}
              </Button>
              <Tag bordered={false} color={FRAME_STATUS_COLOR[f.reviewStatus]}>
                {t(`design.frame.status.${f.reviewStatus}`)}
              </Tag>
              <span className="pm-design-sub">
                {f.designTitle}
                {f.removed ? ` · ${t('design.frame.removed')}` : ''}
              </span>
            </li>
          ))}
          {boards.map((d) => (
            <li key={d.id}>
              <Button type="link" onClick={() => nav(`${base}&open=${d.id}`)}>
                {d.title}
              </Button>
              <Tag bordered={false} color="blue">
                {t('design.format.excalidraw')}
              </Tag>
              <span className="pm-design-sub">
                v{d.currentRevision} · {formatWhen(d.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="pm-design-task-actions">
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => nav(`${base}&new=excalidraw&taskId=${taskId}`)}
        >
          {t('design.board.newFlow')}
        </Button>
        <Button size="small" type="link" onClick={() => nav(base)}>
          {t('design.task.openList')}
        </Button>
      </div>
    </div>
  );
}

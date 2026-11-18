import { CloseOutlined, LayoutOutlined, SyncOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Alert, Button, Select, Spin, TreeSelect } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatWhen } from '../mockup/utils';
import { useData } from '../store';
import { buildTaskTreeData } from '../utils/taskTree';
import {
  type DesignFrame,
  FRAME_STATUSES,
  type FrameStatus,
  getDesign,
  linkFrameTask,
  listDesignFrames,
  setFrameStatus,
  unlinkFrameTask,
} from './api';
import type { FrameRef } from './flowScreens';

interface Props {
  projectId: string;
  screen: FrameRef;
  readOnly: boolean;
  /** 最新版で画像を差し替える（書き出しはワークスペース側） */
  onRefresh: () => Promise<void>;
  onOpenDesign: (designId: string, nodeId: string) => void;
}

/**
 * 業務フローボードで選んだ「画面」の参照元。審査ステータスとタスクは .pen の画框（サーバ）のものを
 * そのまま表示・変更する（画面デザイン側と同じ値）。画像の版が古ければ最新版に差し替えられる。
 */
export default function FlowScreenInspector({
  projectId,
  screen,
  readOnly,
  onRefresh,
  onOpenDesign,
}: Props) {
  const intl = useIntl();
  const t = useCallback(
    (id: string, v?: Record<string, string | number>) =>
      intl.formatMessage({ id }, v),
    [intl],
  );
  const { projects, tasksOf } = useData();
  const [frame, setFrame] = useState<DesignFrame | null | undefined>(undefined);
  const [latest, setLatest] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setFrame(undefined);
    listDesignFrames(screen.designId)
      .then((list) =>
        setFrame(list.find((f) => f.nodeId === screen.nodeId) ?? null),
      )
      .catch(() => setFrame(null));
    getDesign(screen.designId, undefined, { content: false })
      .then((d) => setLatest(d.currentRevision))
      .catch(() => setLatest(null));
  }, [screen.designId, screen.nodeId, screen.revision]);

  const project = projects.find((p) => p.id === projectId);
  const tasks = tasksOf(projectId);
  const taskTreeData = useMemo(
    () => (project ? buildTaskTreeData([project], tasks) : []),
    [project, tasks],
  );

  const status = async (s: FrameStatus) =>
    setFrame(await setFrameStatus(screen.designId, screen.nodeId, s));

  return (
    <div className="pm-flow-inspector">
      <div className="pm-pen-inspector-head">
        <b className="pm-pen-frame-title">{screen.name}</b>
      </div>
      <div className="pm-design-sub">
        {t('design.flow.source', {
          design: screen.designTitle,
          rev: screen.revision,
        })}
      </div>
      {latest !== null && latest > screen.revision && (
        <Alert
          type="warning"
          showIcon
          message={t('design.flow.outdated', { rev: latest })}
          action={
            !readOnly && (
              <Button
                size="small"
                icon={<SyncOutlined />}
                loading={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await onRefresh();
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                {t('design.flow.refresh', { rev: latest })}
              </Button>
            )
          }
        />
      )}
      {frame === undefined ? (
        <Spin size="small" />
      ) : frame === null ? (
        <Alert type="info" showIcon message={t('design.flow.frameGone')} />
      ) : (
        <>
          <div className="pm-pen-field">
            <span className="pm-design-sub">
              {t('design.frame.reviewStatus')} · {t('design.flow.shared')}
            </span>
            <Select<FrameStatus>
              value={frame.reviewStatus}
              onChange={status}
              style={{ width: '100%' }}
              options={FRAME_STATUSES.map((s) => ({
                value: s,
                label: (
                  <span>
                    <span className={`pm-pen-dot is-${s}`} />{' '}
                    {t(`design.frame.status.${s}`)}
                  </span>
                ),
              }))}
            />
            {frame.statusByName && (
              <span className="pm-design-sub">
                {frame.statusByName} · {formatWhen(frame.statusAt)}
              </span>
            )}
          </div>
          <div className="pm-pen-field">
            <span className="pm-design-sub">{t('design.frame.tasks')}</span>
            {frame.tasks.length > 0 && (
              <ul className="pm-pen-tasks">
                {frame.tasks.map((x) => (
                  <li key={x.taskId}>
                    <span>{x.name}</span>
                    <Button
                      size="small"
                      type="text"
                      icon={<CloseOutlined />}
                      aria-label={t('design.frame.unlink')}
                      onClick={async () =>
                        setFrame(
                          await unlinkFrameTask(
                            screen.designId,
                            screen.nodeId,
                            x.taskId,
                          ),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            <TreeSelect
              showSearch
              size="small"
              value={null}
              treeDefaultExpandAll
              treeNodeFilterProp="title"
              treeData={taskTreeData}
              popupMatchSelectWidth={false}
              placeholder={t('design.frame.linkTask')}
              onChange={async (v) =>
                v &&
                setFrame(
                  await linkFrameTask(
                    screen.designId,
                    screen.nodeId,
                    String(v),
                  ),
                )
              }
            />
          </div>
        </>
      )}
      <Button
        block
        icon={<LayoutOutlined />}
        onClick={() => onOpenDesign(screen.designId, screen.nodeId)}
      >
        {t('design.flow.openDesign')}
      </Button>
    </div>
  );
}

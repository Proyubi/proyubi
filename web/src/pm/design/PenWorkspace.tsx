import {
  ArrowLeftOutlined,
  CloseOutlined,
  CommentOutlined,
  DownloadOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import {
  Alert,
  App,
  Badge,
  Button,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatSize, formatWhen, publisherLabel } from '../mockup/utils';
import { useData } from '../store';
import { buildTaskTreeData } from '../utils/taskTree';
import {
  type Design,
  type DesignApiError,
  type DesignFrame,
  FRAME_STATUSES,
  type FrameStatus,
  fetchPenSource,
  getDesign,
  linkFrameTask,
  listDesignFrames,
  setFrameStatus,
  unlinkFrameTask,
} from './api';
import DesignComments from './DesignComments';
import { UploadRevisionModal } from './DesignFileModals';
import PenViewerFrame, { type PenViewerHandle } from './PenViewerFrame';
import type { PenViewerFrame as ViewerFrame } from './penViewerProtocol';
import { designFileName, downloadBlob } from './scene';
import './design.css';

export const FRAME_STATUS_COLOR: Record<FrameStatus, string> = {
  draft: 'default',
  review: 'gold',
  changes: 'red',
  approved: 'green',
};

interface Props {
  designId: string;
  projectId: string;
  /** 開いたときに選ぶ画框（流程板の「画面デザインで開く」、タスク詳細から） */
  initialNodeId?: string | null;
  onClose: () => void;
  /** 一覧の再読み込み（新しい版の取り込み後） */
  onChanged: () => void;
}

/** 左の画框一覧の 1 行：表示中の版に実在する画框 + サーバ側の審査情報 */
interface FrameRow {
  nodeId: string;
  name: string;
  info?: DesignFrame;
}

/**
 * 画面デザイン（.pen）ワークスペース。OpenPencil（読み取り専用、iframe）で原稿を表示し、
 * 画框ごとに審査ステータス・タスク紐付け・コメントを付ける。
 * .pen の編集は Pencil で行い、「新しい版をアップロード」で取り込む（OpenPencil は .pen への書き戻しに未対応）。
 */

/** 画面一覧の開閉はビューアーごとの好み。保存できない環境（プライベートモード等）では毎回既定値 */
const LIST_OPEN_KEY = 'pm.design.pen.frameListOpen';

function readListOpen(): boolean | null {
  try {
    const v = window.localStorage.getItem(LIST_OPEN_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function writeListOpen(open: boolean) {
  try {
    window.localStorage.setItem(LIST_OPEN_KEY, open ? '1' : '0');
  } catch {
    // 保存できなくても開閉は効く
  }
}

export default function PenWorkspace({
  designId,
  projectId,
  initialNodeId,
  onClose,
  onChanged,
}: Props) {
  const intl = useIntl();
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id }, values),
    [intl],
  );
  const { message } = App.useApp();
  const { projects, tasksOf } = useData();

  const [design, setDesign] = useState<Design | null>(null);
  const [viewRev, setViewRev] = useState<number | null>(null);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerFrames, setViewerFrames] = useState<ViewerFrame[] | null>(null);
  const [missingFonts, setMissingFonts] = useState<string[]>([]);
  const [frames, setFrames] = useState<DesignFrame[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const wide = typeof window === 'undefined' || window.innerWidth >= 900;
  const [showList, setShowList] = useState(() =>
    // 狭い画面では一覧がキャンバスに重なるので、保存した状態は使わず閉じて始める
    wide ? (readListOpen() ?? true) : false,
  );
  const [showSide, setShowSide] = useState(wide);
  const viewerRef = useRef<PenViewerHandle>(null);
  useEffect(() => writeListOpen(showList), [showList]);

  const shownRev = viewRev ?? design?.currentRevision ?? 0;

  const loadFrames = useCallback(() => {
    listDesignFrames(designId)
      .then(setFrames)
      .catch(() => setFrames([]));
  }, [designId]);

  const load = useCallback(
    async (revision: number | null) => {
      setLoadError(null);
      setViewerError(null);
      setViewerFrames(null);
      setData(null);
      try {
        const d = await getDesign(designId, revision ?? undefined, {
          content: false,
        });
        setDesign(d);
        setViewRev(revision);
        setData(await fetchPenSource(designId, revision ?? undefined));
      } catch (e) {
        const err = e as DesignApiError;
        setLoadError(
          err.code === 404
            ? t('design.error.notFound')
            : err.message || t('design.error.load'),
        );
      }
    },
    [designId, t],
  );

  useEffect(() => {
    load(null);
    loadFrames();
  }, [load, loadFrames]);

  const byNode = useMemo(
    () => new Map(frames.map((f) => [f.nodeId, f])),
    [frames],
  );

  // 表示中の版に実在する画框（ビューア読み込み前はサーバの最新画框）
  const rows: FrameRow[] = useMemo(() => {
    const base = viewerFrames
      ? viewerFrames.map((f) => ({ nodeId: f.nodeId, name: f.name }))
      : frames
          .filter((f) => !f.removed)
          .map((f) => ({ nodeId: f.nodeId, name: f.name }));
    const q = query.trim().toLowerCase();
    return base
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .map((r) => ({ ...r, info: byNode.get(r.nodeId) }));
  }, [viewerFrames, frames, byNode, query]);

  const counts = useMemo(() => {
    const c: Record<FrameStatus, number> = {
      draft: 0,
      review: 0,
      changes: 0,
      approved: 0,
    };
    for (const f of frames) if (!f.removed) c[f.reviewStatus] += 1;
    return c;
  }, [frames]);

  const project = projects.find((p) => p.id === projectId);
  const tasks = tasksOf(projectId);
  const taskTreeData = useMemo(
    () => (project ? buildTaskTreeData([project], tasks) : []),
    [project, tasks],
  );

  const selectedFrame = selected ? byNode.get(selected) : undefined;
  const selectedName =
    selectedFrame?.name ??
    viewerFrames?.find((f) => f.nodeId === selected)?.name ??
    selected;

  const pick = (nodeId: string) => {
    setSelected(nodeId);
    viewerRef.current?.focus(nodeId);
    if (!wide) setShowList(false);
    setShowSide(true);
  };

  const replaceFrame = (f: DesignFrame) =>
    setFrames((prev) => prev.map((x) => (x.nodeId === f.nodeId ? f : x)));

  const changeStatus = async (status: FrameStatus) => {
    if (!selected) return;
    replaceFrame(await setFrameStatus(designId, selected, status));
  };

  const addTask = async (taskId: string) => {
    if (!selected) return;
    replaceFrame(await linkFrameTask(designId, selected, taskId));
  };

  const removeTask = async (taskId: string) => {
    if (!selected) return;
    replaceFrame(await unlinkFrameTask(designId, selected, taskId));
  };

  const download = () => {
    if (!data || !design) return;
    downloadBlob(
      designFileName(design, shownRev, design.revision?.fileName),
      new Uint8Array(data),
      'application/octet-stream',
    );
  };

  const revOptions = (design?.revisions ?? []).map((r) => ({
    value: r.revision,
    label: `v${r.revision} · ${formatWhen(r.createdAt)} ${publisherLabel(
      r.createdByName,
      r.via,
    )}`,
  }));

  const statusLabel = (s: FrameStatus) => t(`design.frame.status.${s}`);

  return (
    <div
      className="pm-design-workspace"
      role="dialog"
      aria-label={design?.title}
    >
      <div className="pm-design-toolbar">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={onClose}
          aria-label={t('design.back')}
        />
        <Button
          icon={<UnorderedListOutlined />}
          type={showList ? 'primary' : 'default'}
          ghost={showList}
          onClick={() => setShowList((v) => !v)}
          aria-label={t('design.frame.list')}
        />
        <Typography.Text strong ellipsis className="pm-design-title">
          {design?.title ?? '…'}
        </Typography.Text>
        <Tag bordered={false} color="purple">
          {t('design.format.pen')}
        </Tag>
        <Space size={4} className="pm-design-hide-narrow">
          {FRAME_STATUSES.filter((s) => s !== 'draft').map((s) => (
            <Tag key={s} bordered={false} color={FRAME_STATUS_COLOR[s]}>
              {statusLabel(s)} {counts[s]}
            </Tag>
          ))}
        </Space>
        <span className="pm-design-spacer" />
        {design && (
          <Select
            className="pm-design-rev-select"
            value={shownRev}
            options={revOptions}
            popupMatchSelectWidth={false}
            onChange={(rev) =>
              load(rev === design.currentRevision ? null : rev)
            }
          />
        )}
        <Button
          icon={<DownloadOutlined />}
          onClick={download}
          disabled={!data}
          aria-label={t('design.pen.download')}
        >
          <span className="pm-design-hide-narrow">
            {t('design.pen.download')}
          </span>
        </Button>
        <Button
          type="primary"
          icon={<UploadOutlined />}
          onClick={() => setUploadOpen(true)}
          disabled={!design}
        >
          <span className="pm-design-hide-narrow">
            {t('design.upload.menu')}
          </span>
        </Button>
        <Button
          icon={<CommentOutlined />}
          type={showSide ? 'primary' : 'default'}
          ghost={showSide}
          onClick={() => setShowSide((v) => !v)}
          aria-label={t('design.frame.panel')}
        />
      </div>

      {viewRev !== null && design && (
        <Alert
          type="info"
          banner
          message={t('design.pen.historyBanner', {
            rev: shownRev,
            latest: design.currentRevision,
          })}
          action={
            <Button size="small" onClick={() => load(null)}>
              {t('design.history.latest')}
            </Button>
          }
        />
      )}
      {missingFonts.length > 0 && (
        <Alert
          type="warning"
          banner
          closable
          message={t('design.pen.missingFonts', {
            fonts: missingFonts.join(', '),
          })}
        />
      )}

      <div className="pm-design-body">
        {!showList && (
          <div className="pm-pen-frames-rail">
            <Button
              type="text"
              size="small"
              icon={<MenuUnfoldOutlined />}
              onClick={() => setShowList(true)}
              title={t('design.frame.expand')}
              aria-label={t('design.frame.expand')}
            />
          </div>
        )}
        {showList && (
          <aside className="pm-pen-frames" aria-label={t('design.frame.list')}>
            <div className="pm-pen-frames-head">
              <Input.Search
                allowClear
                size="small"
                placeholder={t('design.frame.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button
                type="text"
                size="small"
                icon={<MenuFoldOutlined />}
                onClick={() => setShowList(false)}
                title={t('design.frame.collapse')}
                aria-label={t('design.frame.collapse')}
              />
            </div>
            <ul>
              {rows.map((r) => (
                <li key={r.nodeId}>
                  <button
                    type="button"
                    className={`pm-pen-frame${selected === r.nodeId ? ' is-active' : ''}`}
                    onClick={() => pick(r.nodeId)}
                  >
                    <span
                      className={`pm-pen-dot is-${r.info?.reviewStatus ?? 'draft'}`}
                      title={statusLabel(r.info?.reviewStatus ?? 'draft')}
                    />
                    <span className="pm-pen-frame-name">{r.name}</span>
                    {(r.info?.tasks.length ?? 0) > 0 && (
                      <span className="pm-design-sub">
                        #{r.info?.tasks.length}
                      </span>
                    )}
                    {(r.info?.openComments ?? 0) > 0 && (
                      <Badge count={r.info?.openComments} size="small" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {rows.length === 0 && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('design.frame.none')}
              />
            )}
          </aside>
        )}

        <div className="pm-design-main pm-pen-stage">
          {loadError ? (
            <div className="pm-design-error-full">
              <Alert type="error" showIcon message={loadError} />
              <Button onClick={() => load(viewRev)}>{t('design.retry')}</Button>
            </div>
          ) : viewerError ? (
            <div className="pm-design-error-full">
              <Alert
                type="error"
                showIcon
                message={t('design.pen.viewerError')}
                description={viewerError}
              />
              <Button icon={<DownloadOutlined />} onClick={download}>
                {t('design.pen.download')}
              </Button>
            </div>
          ) : (
            <>
              {(!data || !viewerFrames) && (
                <div className="pm-design-canvas-loading pm-pen-loading">
                  <Spin />
                  <span className="pm-design-sub">
                    {t('design.pen.loading')}
                  </span>
                </div>
              )}
              {data && design && (
                <PenViewerFrame
                  ref={viewerRef}
                  className="pm-pen-viewer"
                  title={design.title}
                  data={data}
                  fileName={design.revision?.fileName ?? `${design.title}.pen`}
                  onLoaded={(f) => {
                    setViewerFrames(f);
                    if (
                      initialNodeId &&
                      f.some((x) => x.nodeId === initialNodeId)
                    ) {
                      setSelected(initialNodeId);
                      setShowSide(true);
                      // ビューアの zoomToFit の後に寄せる
                      setTimeout(
                        () => viewerRef.current?.focus(initialNodeId),
                        120,
                      );
                    }
                  }}
                  onFonts={setMissingFonts}
                  onSelection={(id) => {
                    setSelected(id);
                    if (id) setShowSide(true);
                  }}
                  onError={setViewerError}
                />
              )}
            </>
          )}
        </div>

        {showSide && design && !loadError && (
          <aside className="pm-design-side pm-pen-side">
            {selected ? (
              <div className="pm-pen-inspector">
                <div className="pm-pen-inspector-head">
                  <b className="pm-pen-frame-title">{selectedName}</b>
                  <Button
                    size="small"
                    type="text"
                    icon={<CloseOutlined />}
                    onClick={() => setSelected(null)}
                    aria-label={t('design.close')}
                  />
                </div>
                {selectedFrame ? (
                  <>
                    <div className="pm-pen-field">
                      <span className="pm-design-sub">
                        {t('design.frame.reviewStatus')}
                      </span>
                      <Select<FrameStatus>
                        value={selectedFrame.reviewStatus}
                        onChange={changeStatus}
                        style={{ width: '100%' }}
                        options={FRAME_STATUSES.map((s) => ({
                          value: s,
                          label: (
                            <span>
                              <span className={`pm-pen-dot is-${s}`} />{' '}
                              {statusLabel(s)}
                            </span>
                          ),
                        }))}
                      />
                      {selectedFrame.statusByName && (
                        <span className="pm-design-sub">
                          {selectedFrame.statusByName} ·{' '}
                          {formatWhen(selectedFrame.statusAt)}
                        </span>
                      )}
                    </div>
                    <div className="pm-pen-field">
                      <span className="pm-design-sub">
                        {t('design.frame.tasks')}
                      </span>
                      {selectedFrame.tasks.length === 0 ? (
                        <span className="pm-design-sub">—</span>
                      ) : (
                        <ul className="pm-pen-tasks">
                          {selectedFrame.tasks.map((x) => (
                            <li key={x.taskId}>
                              <span>{x.name}</span>
                              <Button
                                size="small"
                                type="text"
                                icon={<CloseOutlined />}
                                onClick={() => removeTask(x.taskId)}
                                aria-label={t('design.frame.unlink')}
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
                        onChange={(v) => v && addTask(String(v))}
                      />
                    </div>
                  </>
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    message={t('design.frame.notInLatest')}
                  />
                )}
                <DesignComments
                  designId={design.id}
                  revision={shownRev}
                  elementId={selected}
                  onChanged={loadFrames}
                />
              </div>
            ) : (
              <div className="pm-pen-inspector">
                <div className="pm-pen-summary">
                  <div>
                    <span className="pm-design-sub">
                      {t('design.pen.file')}
                    </span>{' '}
                    {design.revision?.fileName ?? '—'}
                  </div>
                  <div>
                    <span className="pm-design-sub">
                      {t('design.pen.size')}
                    </span>{' '}
                    {design.revision
                      ? formatSize(design.revision.sizeBytes)
                      : '—'}
                  </div>
                  <div className="pm-design-sub">
                    {t('design.pen.selectHint')}
                  </div>
                </div>
                <DesignComments
                  designId={design.id}
                  revision={shownRev}
                  elementId={null}
                />
              </div>
            )}
          </aside>
        )}
      </div>

      <UploadRevisionModal
        open={uploadOpen}
        design={design}
        onClose={() => setUploadOpen(false)}
        onSaved={(d) => {
          setUploadOpen(false);
          message.success(t('design.pen.uploaded', { rev: d.currentRevision }));
          onChanged();
          load(null);
          loadFrames();
        }}
        onConflict={(msg) => {
          setUploadOpen(false);
          message.error(msg);
          load(null);
        }}
      />
    </div>
  );
}

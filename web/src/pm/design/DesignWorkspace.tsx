import {
  ArrowLeftOutlined,
  CommentOutlined,
  DownloadOutlined,
  LayoutOutlined,
  MoreOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  convertToExcalidrawElements,
  newElementWith,
} from '@excalidraw/excalidraw';
import { getLocale, history, useIntl } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Dropdown,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatSize, formatWhen, publisherLabel } from '../mockup/utils';
import AddScreensModal from './AddScreensModal';
import {
  createDesign,
  type Design,
  type DesignApiError,
  getDesign,
  saveDesign,
} from './api';
import DesignCanvas, {
  type ExcalidrawAPI,
  excalidrawLang,
} from './DesignCanvas';
import DesignComments from './DesignComments';
import { UploadRevisionModal } from './DesignFileModals';
import FlowScreenInspector from './FlowScreenInspector';
import {
  type FrameRef,
  frameFileId,
  frameRefOf,
  layoutScreens,
  type RenderedFrame,
  SCREEN_WIDTH,
  screenHeight,
} from './flowScreens';
import { saveSceneDraft } from './saveFlow';
import {
  base64ToBytes,
  buildManifest,
  designFileName,
  downloadBlob,
  parseScene,
  type SceneData,
  sceneVersion,
} from './scene';
import { usePenFrameRenderer } from './usePenFrameRenderer';
import './design.css';

type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

interface Props {
  designId: string;
  projectId: string;
  onClose: () => void;
  /** 一覧の再読み込み（保存・取り込み後） */
  onChanged: () => void;
  /** 別デザインを開く（衝突時の「別デザインとして保存」後 / 画面の参照元の画面デザイン） */
  onOpen: (id: string, nodeId?: string) => void;
}

/**
 * デザインを開いた全画面ワークスペース。
 * - excalidraw：Excalidraw で編集し、expectedRevision 付きで保存（409 は草稿を保ったまま選択肢を出す）。
 * - pen：原文の保持・書き出し・新修訂の取り込みのみ。ブラウザ内の原生編集・描画は未対応（実際の制限を表示）。
 * 旧修訂は読み取り専用で開き、「この版から復元」で新しい修訂として保存できる（履歴は書き換えない）。
 */
export default function DesignWorkspace({
  designId,
  projectId,
  onClose,
  onChanged,
  onOpen,
}: Props) {
  const intl = useIntl();
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id }, values),
    [intl],
  );
  const { message, modal } = App.useApp();

  const [design, setDesign] = useState<Design | null>(null);
  /** 表示中の修訂（null = 最新、編集可） */
  const [viewRev, setViewRev] = useState<number | null>(null);
  const [scene, setScene] = useState<SceneData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>('clean');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [showComments, setShowComments] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 900,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addScreensOpen, setAddScreensOpen] = useState(false);
  /** 選択中の要素が .pen の画框画像なら、その参照元 */
  const [screen, setScreen] = useState<FrameRef | null>(null);
  const screenKey = useRef('');
  const renderer = usePenFrameRenderer();
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const baseline = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  const readOnly = viewRev !== null;
  const shownRev = viewRev ?? design?.currentRevision ?? 0;

  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    // 保存失敗（競合・検証エラー）は次の保存成功まで表示し続ける（編集で「未保存」に上書きしない）
    setStatus((s) =>
      dirty ? (s === 'error' ? 'error' : 'dirty') : s === 'dirty' ? 'clean' : s,
    );
  }, []);

  const load = useCallback(
    async (revision: number | null) => {
      setLoading(true);
      setLoadError(null);
      try {
        const d = await getDesign(designId, revision ?? undefined);
        if (d.format === 'excalidraw') {
          const parsed = parseScene(d.content ?? '');
          if (!parsed.ok) {
            // 読めない内容を空白板で開くと、保存で上書きして消してしまう
            setLoadError(t('design.error.parse'));
            setDesign(d);
            return;
          }
          setScene(parsed.scene);
        } else {
          setScene(null);
        }
        setDesign(d);
        setViewRev(revision);
        baseline.current = null;
        dirtyRef.current = false;
        setStatus('clean');
        setStatusMsg(null);
        setMountKey((k) => k + 1);
      } catch (e) {
        const err = e as DesignApiError;
        setLoadError(
          err.code === 404
            ? t('design.error.notFound')
            : err.message || t('design.error.load'),
        );
      } finally {
        setLoading(false);
      }
    },
    [designId, t],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  // ブラウザを閉じる / 再読み込み時の未保存警告
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // アプリ内遷移（サイドバー等）の未保存警告
  useEffect(() => {
    if (status !== 'dirty' && status !== 'error') return;
    const unblock = history.block((tx) => {
      // 画面内の guard で破棄を確認済み（dirtyRef=false）なら二重に聞かない
      if (!dirtyRef.current) {
        unblock();
        tx.retry();
        return;
      }
      modal.confirm({
        title: t('design.leave.title'),
        content: t('design.leave.content'),
        okText: t('design.leave.ok'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        onOk: () => {
          unblock();
          tx.retry();
        },
      });
    });
    return unblock;
  }, [status, modal, t]);

  /** 未保存なら確認してから実行 */
  const guard = useCallback(
    (action: () => void) => {
      if (!dirtyRef.current) {
        action();
        return;
      }
      modal.confirm({
        title: t('design.leave.title'),
        content: t('design.leave.content'),
        okText: t('design.leave.ok'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        onOk: () => {
          dirtyRef.current = false;
          action();
        },
      });
    },
    [modal, t],
  );

  const onSceneChange = useCallback(
    (elements: readonly unknown[], app: unknown, files: unknown) => {
      // 画面（.pen の画框画像）を 1 つだけ選んだら参照元パネルを出す
      const selectedIds = Object.keys(
        (app as { selectedElementIds?: Record<string, boolean> })
          .selectedElementIds ?? {},
      );
      const picked =
        selectedIds.length === 1
          ? frameRefOf(
              (elements as { id: string }[]).find(
                (e) => e.id === selectedIds[0],
              ),
            )
          : null;
      const key = picked
        ? `${picked.designId}/${picked.nodeId}/${picked.revision}`
        : '';
      if (key !== screenKey.current) {
        screenKey.current = key;
        setScreen(picked);
        if (picked) setShowComments(true);
      }
      if (readOnly) return;
      const v = sceneVersion(
        elements as Record<string, unknown>[],
        (files ?? {}) as Record<string, unknown>,
      );
      // 初回 onChange（読み込み直後）を基準にする
      if (baseline.current === null) {
        baseline.current = v;
        return;
      }
      setDirty(v !== baseline.current);
    },
    [readOnly, setDirty],
  );

  /** 画面を追加：表示中の中央に横一列で置く */
  const insertScreens = (
    source: { id: string; title: string },
    revision: number,
    frames: RenderedFrame[],
  ) => {
    const api = apiRef.current;
    if (!api) return;
    const st = api.getAppState();
    const zoom = st.zoom.value;
    const total = frames.length * SCREEN_WIDTH + (frames.length - 1) * 100;
    const cx = st.width / 2 / zoom - st.scrollX;
    const cy = st.height / 2 / zoom - st.scrollY;
    const skeletons = layoutScreens(
      source,
      revision,
      frames,
      Math.round(cx - total / 2),
      Math.round(cy - 200),
    );
    api.addFiles(skeletons.map((x) => x.file) as never);
    const added = convertToExcalidrawElements(
      skeletons.flatMap((x) => [x.image, x.label]) as never,
    );
    api.updateScene({ elements: [...api.getSceneElements(), ...added] });
    api.scrollToContent(added, { fitToContent: true, animate: true });
    setAddScreensOpen(false);
    message.success(t('design.flow.added', { n: frames.length }));
  };

  /** 選択中の画面を最新版で書き出し直し、同じ画框を参照する画像をすべて差し替える */
  const refreshScreen = async () => {
    const api = apiRef.current;
    if (!api || !screen) return;
    const out = await renderer.render(screen.designId, [screen.nodeId]);
    const f = out.frames[0];
    if (!f) {
      message.error(t('design.flow.renderFailed'));
      return;
    }
    const fileId = frameFileId(screen.designId, screen.nodeId, out.revision);
    api.addFiles([
      {
        id: fileId,
        dataURL: f.dataURL,
        mimeType: 'image/png',
        created: Date.now(),
      },
    ] as never);
    api.updateScene({
      elements: api.getSceneElements().map((el) => {
        const ref = frameRefOf(el);
        if (
          !ref ||
          ref.designId !== screen.designId ||
          ref.nodeId !== screen.nodeId
        ) {
          return el;
        }
        return newElementWith(
          el as never,
          {
            fileId,
            height: screenHeight(f.width, f.height, el.width),
            customData: {
              pm: { ...ref, name: f.name, revision: out.revision },
            },
          } as never,
        );
      }),
    });
    message.success(t('design.flow.refreshed', { rev: out.revision }));
  };

  const currentScene = () => {
    const api = apiRef.current;
    if (!api) return null;
    return {
      elements: api.getSceneElements() as unknown as Record<string, unknown>[],
      appState: api.getAppState() as unknown as Record<string, unknown>,
      files: api.getFiles() as unknown as Record<string, unknown>,
    };
  };

  const afterSaved = (d: Design) => {
    setDesign((prev) => (prev ? { ...prev, ...d } : d));
    const s = currentScene();
    baseline.current = s ? sceneVersion(s.elements, s.files) : null;
    dirtyRef.current = false;
    setStatus('saved');
    setStatusMsg(null);
    onChanged();
  };

  const showConflict = (draft: string | null, msg: string) => {
    setStatus('error');
    setStatusMsg(msg);
    const m = modal.confirm({
      title: t('design.conflict.title'),
      content: (
        <div>
          <p>{msg}</p>
          <p>{t('design.conflict.content')}</p>
          {draft && (
            <Space direction="vertical">
              <Button
                block
                onClick={async () => {
                  if (!design) return;
                  try {
                    const copy = await createDesign({
                      projectId: design.projectId,
                      taskId: design.taskId ?? undefined,
                      title: t('design.conflict.copyTitle', {
                        title: design.title,
                      }),
                      format: 'excalidraw',
                      content: draft,
                    });
                    m.destroy();
                    dirtyRef.current = false;
                    onChanged();
                    onOpen(copy.id);
                  } catch (e) {
                    message.error((e as Error).message);
                  }
                }}
              >
                {t('design.conflict.saveAsCopy')}
              </Button>
              <Button
                block
                icon={<DownloadOutlined />}
                onClick={() =>
                  downloadBlob(
                    `${design?.title ?? 'draft'}.draft.excalidraw`,
                    draft,
                    'application/json',
                  )
                }
              >
                {t('design.conflict.download')}
              </Button>
            </Space>
          )}
        </div>
      ),
      okText: t('design.conflict.reload'),
      okButtonProps: { danger: true },
      cancelText: t('design.conflict.keep'),
      onOk: () => load(null),
    });
  };

  const save = async () => {
    if (!design || readOnly) return;
    const s = currentScene();
    if (!s) return;
    setStatus('saving');
    const r = await saveSceneDraft(design, s, saveDesign);
    if (r.status === 'saved') {
      afterSaved(r.design);
      message.success(t('design.saved', { rev: r.design.currentRevision }));
    } else if (r.status === 'conflict') {
      showConflict(r.draft, r.message);
    } else if (r.status === 'invalid') {
      setStatus('error');
      const msg = t(`design.error.${r.code}`);
      setStatusMsg(msg);
      message.error(msg);
    } else {
      setStatus('error');
      const msg = r.code === 0 ? t('design.error.network') : r.message;
      setStatusMsg(msg);
      message.error(msg);
    }
  };

  // ⌘S / Ctrl+S で保存
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** 旧修訂の内容を新しい修訂として保存（履歴は変えない） */
  const restore = async () => {
    if (!design || viewRev === null) return;
    const latest = await getDesign(design.id);
    try {
      const d = await saveDesign(design.id, {
        expectedRevision: latest.currentRevision,
        ...(design.format === 'pen'
          ? { contentBase64: design.content }
          : { content: design.content }),
        fileName: design.revision?.fileName ?? undefined,
        note: t('design.restore.note', { rev: viewRev }),
      });
      message.success(t('design.saved', { rev: d.currentRevision }));
      onChanged();
      load(null);
    } catch (e) {
      const err = e as DesignApiError;
      if (err.code === 409) showConflict(null, err.message);
      else message.error(err.message);
    }
  };

  const exportFile = () => {
    if (!design?.content || !design.revision) return;
    const name = designFileName(design, shownRev, design.revision.fileName);
    if (design.format === 'pen') {
      downloadBlob(
        name,
        base64ToBytes(design.content),
        'application/octet-stream',
      );
    } else {
      downloadBlob(name, design.content, 'application/json');
    }
  };

  const exportManifest = () => {
    if (!design?.revision) return;
    const m = buildManifest(design, {
      revision: shownRev,
      sha256: design.revision.sha256,
      sizeBytes: design.revision.sizeBytes,
    });
    const base = designFileName(
      design,
      shownRev,
      design.revision.fileName,
    ).replace(/\.(pen|excalidraw)$/i, '');
    downloadBlob(
      `${base}.design.json`,
      JSON.stringify(m, null, 2),
      'application/json',
    );
  };

  const statusTag = () => {
    switch (status) {
      case 'dirty':
        return <Tag color="orange">{t('design.status.dirty')}</Tag>;
      case 'saving':
        return <Tag color="processing">{t('design.status.saving')}</Tag>;
      case 'saved':
        return <Tag color="green">{t('design.status.saved')}</Tag>;
      case 'error':
        return (
          <Tag color="red" title={statusMsg ?? undefined}>
            {t('design.status.error')}
          </Tag>
        );
      default:
        return null;
    }
  };

  const revOptions = (design?.revisions ?? []).map((r) => ({
    value: r.revision,
    label: `v${r.revision} · ${formatWhen(r.createdAt)} ${publisherLabel(
      r.createdByName,
      r.via,
    )}`,
  }));

  return (
    <div
      className="pm-design-workspace"
      role="dialog"
      aria-label={design?.title}
    >
      <div className="pm-design-toolbar">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => guard(onClose)}
          aria-label={t('design.back')}
        />
        <Typography.Text strong ellipsis className="pm-design-title">
          {design?.title ?? '…'}
        </Typography.Text>
        {design && (
          <Tag
            bordered={false}
            color={design.format === 'pen' ? 'purple' : 'blue'}
          >
            {t(`design.format.${design.format}`)}
          </Tag>
        )}
        {design?.taskName && (
          <Tag bordered={false} className="pm-design-hide-narrow">
            {design.taskName}
          </Tag>
        )}
        {statusTag()}
        <span className="pm-design-spacer" />
        {design && (
          <Select
            size="middle"
            className="pm-design-rev-select"
            value={shownRev}
            options={revOptions}
            popupMatchSelectWidth={false}
            onChange={(rev) =>
              guard(() => load(rev === design.currentRevision ? null : rev))
            }
          />
        )}
        <Button
          icon={<CommentOutlined />}
          type={showComments ? 'primary' : 'default'}
          ghost={showComments}
          onClick={() => setShowComments((v) => !v)}
          aria-label={t('design.comment.title')}
        />
        <Dropdown
          menu={{
            items: [
              {
                key: 'export',
                icon: <DownloadOutlined />,
                label: t('design.export.file'),
              },
              {
                key: 'manifest',
                icon: <DownloadOutlined />,
                label: t('design.export.manifest'),
              },
              {
                key: 'upload',
                icon: <UploadOutlined />,
                label: t('design.upload.menu'),
                disabled: readOnly,
              },
            ],
            onClick: ({ key }) => {
              if (key === 'export') exportFile();
              if (key === 'manifest') exportManifest();
              if (key === 'upload') guard(() => setUploadOpen(true));
            },
          }}
        >
          <Button icon={<MoreOutlined />} aria-label={t('design.more')} />
        </Dropdown>
        {design?.format === 'excalidraw' && !readOnly && (
          <Button
            icon={<LayoutOutlined />}
            onClick={() => setAddScreensOpen(true)}
            disabled={!!loadError}
          >
            <span className="pm-design-hide-narrow">
              {t('design.flow.add')}
            </span>
          </Button>
        )}
        {design?.format === 'excalidraw' && !readOnly && (
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={status === 'saving'}
            disabled={!!loadError}
            onClick={save}
          >
            <span className="pm-design-hide-narrow">{t('common.save')}</span>
          </Button>
        )}
      </div>

      {readOnly && design && (
        <Alert
          type="info"
          banner
          message={t('design.history.banner', {
            rev: shownRev,
            latest: design.currentRevision,
          })}
          action={
            <Space>
              <Button size="small" onClick={() => load(null)}>
                {t('design.history.latest')}
              </Button>
              <Button size="small" type="primary" onClick={restore}>
                {t('design.history.restore')}
              </Button>
            </Space>
          }
        />
      )}

      <div className="pm-design-body">
        <div className="pm-design-main">
          {loading && !design ? (
            <div className="pm-design-canvas-loading">
              <Spin />
            </div>
          ) : loadError ? (
            <div className="pm-design-error-full">
              <Alert type="error" showIcon message={loadError} />
              <Button onClick={() => load(viewRev)}>{t('design.retry')}</Button>
            </div>
          ) : design?.format === 'excalidraw' && scene ? (
            <DesignCanvas
              key={mountKey}
              initialData={{
                elements: scene.elements as never,
                appState: scene.appState as never,
                files: scene.files as never,
                scrollToContent: true,
              }}
              excalidrawAPI={(api) => {
                apiRef.current = api;
              }}
              onChange={onSceneChange as never}
              viewModeEnabled={readOnly}
              langCode={excalidrawLang(getLocale())}
              name={design.title}
            />
          ) : design?.format === 'pen' ? (
            <div className="pm-design-pen">
              <Alert
                type="warning"
                showIcon
                message={t('design.pen.limitTitle')}
                description={t('design.pen.limitBody')}
              />
              <Descriptions
                column={1}
                size="small"
                bordered
                items={[
                  {
                    key: 'file',
                    label: t('design.pen.file'),
                    children: design.revision?.fileName ?? '—',
                  },
                  {
                    key: 'size',
                    label: t('design.pen.size'),
                    children: design.revision
                      ? formatSize(design.revision.sizeBytes)
                      : '—',
                  },
                  {
                    key: 'sha',
                    label: 'SHA-256',
                    children: (
                      <Typography.Text code copyable className="pm-design-sha">
                        {design.revision?.sha256}
                      </Typography.Text>
                    ),
                  },
                  {
                    key: 'source',
                    label: t('design.source.title'),
                    children: design.source?.path
                      ? [
                          design.source.repo,
                          design.source.ref,
                          design.source.path,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : '—',
                  },
                ]}
              />
              <Space wrap>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={exportFile}
                >
                  {t('design.pen.download')}
                </Button>
                {!readOnly && (
                  <Button
                    icon={<UploadOutlined />}
                    onClick={() => setUploadOpen(true)}
                  >
                    {t('design.upload.menu')}
                  </Button>
                )}
              </Space>
              <ol className="pm-design-pen-steps">
                <li>{t('design.pen.step1')}</li>
                <li>{t('design.pen.step2')}</li>
                <li>{t('design.pen.step3')}</li>
              </ol>
            </div>
          ) : null}
        </div>
        {showComments && design && !loadError && (
          <aside className="pm-design-side">
            {screen && (
              <FlowScreenInspector
                projectId={projectId}
                screen={screen}
                readOnly={readOnly}
                onRefresh={refreshScreen}
                onOpenDesign={(id, nodeId) => guard(() => onOpen(id, nodeId))}
              />
            )}
            <DesignComments designId={design.id} revision={shownRev} />
          </aside>
        )}
      </div>

      <AddScreensModal
        open={addScreensOpen}
        projectId={projectId}
        onClose={() => setAddScreensOpen(false)}
        onInsert={insertScreens}
      />
      {renderer.element}

      <UploadRevisionModal
        open={uploadOpen}
        design={design}
        onClose={() => setUploadOpen(false)}
        onSaved={(d) => {
          setUploadOpen(false);
          message.success(t('design.saved', { rev: d.currentRevision }));
          onChanged();
          load(null);
        }}
        onConflict={(msg) => {
          setUploadOpen(false);
          showConflict(null, msg);
        }}
      />
    </div>
  );
}

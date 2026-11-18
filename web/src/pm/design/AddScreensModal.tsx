import { useIntl } from '@umijs/max';
import { Alert, App, Checkbox, Empty, Modal, Select, Space, Spin } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import {
  type Design,
  type DesignFrame,
  listDesignFrames,
  listDesigns,
} from './api';
import type { RenderedFrame } from './flowScreens';
import { usePenFrameRenderer } from './usePenFrameRenderer';

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onInsert: (
    design: { id: string; title: string },
    revision: number,
    frames: RenderedFrame[],
  ) => void;
}

/**
 * 業務フローボードに「画面」を追加：本プロジェクトの画面デザイン（.pen）から画框を選び、
 * ブラウザ内の OpenPencil で PNG に書き出して置く（参照元の設計・画框・版を画像に記録）。
 */
export default function AddScreensModal({
  open,
  projectId,
  onClose,
  onInsert,
}: Props) {
  const intl = useIntl();
  const t = (id: string, v?: Record<string, string | number>) =>
    intl.formatMessage({ id }, v);
  const { message } = App.useApp();
  const [pens, setPens] = useState<Design[] | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const [frames, setFrames] = useState<DesignFrame[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const renderer = usePenFrameRenderer();

  useEffect(() => {
    if (!open) return;
    setPens(null);
    setPicked([]);
    listDesigns({ projectId })
      .then((list) => {
        const p = list.filter((d) => d.format === 'pen');
        setPens(p);
        setDesignId((cur) =>
          cur && p.some((d) => d.id === cur) ? cur : (p[0]?.id ?? null),
        );
      })
      .catch(() => setPens([]));
  }, [open, projectId]);

  useEffect(() => {
    setFrames(null);
    setPicked([]);
    if (!open || !designId) return;
    listDesignFrames(designId)
      .then((f) => setFrames(f.filter((x) => !x.removed)))
      .catch(() => setFrames([]));
  }, [open, designId]);

  const design = useMemo(
    () => pens?.find((d) => d.id === designId),
    [pens, designId],
  );

  const submit = async () => {
    if (!design || picked.length === 0) {
      message.warning(t('design.flow.pickNeed'));
      return;
    }
    try {
      const order = (frames ?? [])
        .map((f) => f.nodeId)
        .filter((id) => picked.includes(id));
      const out = await renderer.render(design.id, order);
      if (out.frames.length === 0) {
        message.error(t('design.flow.renderFailed'));
        return;
      }
      onInsert(
        { id: design.id, title: design.title },
        out.revision,
        out.frames,
      );
    } catch (e) {
      message.error(`${t('design.flow.renderFailed')} ${(e as Error).message}`);
    }
  };

  return (
    <Modal
      open={open}
      title={t('design.flow.addTitle')}
      okText={t('design.flow.addOk', { n: picked.length })}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={renderer.busy}
      okButtonProps={{ disabled: picked.length === 0 }}
      width={560}
      destroyOnHidden
    >
      {pens === null ? (
        <Spin />
      ) : pens.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('design.flow.noPen')}
        />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            value={designId}
            onChange={setDesignId}
            options={pens.map((d) => ({
              value: d.id,
              label: `${d.title} · v${d.currentRevision}`,
            }))}
          />
          <span className="pm-design-sub">{t('design.flow.renderHint')}</span>
          {frames === null ? (
            <Spin size="small" />
          ) : frames.length === 0 ? (
            <Alert type="info" showIcon message={t('design.frame.none')} />
          ) : (
            <>
              <Checkbox
                checked={picked.length === frames.length}
                indeterminate={
                  picked.length > 0 && picked.length < frames.length
                }
                onChange={(e) =>
                  setPicked(e.target.checked ? frames.map((f) => f.nodeId) : [])
                }
              >
                {t('design.flow.pickAll')}
              </Checkbox>
              <Checkbox.Group
                className="pm-flow-pick"
                value={picked}
                onChange={(v) => setPicked(v as string[])}
                options={frames.map((f) => ({
                  value: f.nodeId,
                  label: (
                    <span>
                      <span className={`pm-pen-dot is-${f.reviewStatus}`} />{' '}
                      {f.name}
                      {f.tasks.length > 0 && (
                        <span className="pm-design-sub">
                          {' '}
                          · {f.tasks.map((x) => x.name).join(', ')}
                        </span>
                      )}
                    </span>
                  ),
                }))}
              />
            </>
          )}
        </Space>
      )}
      {renderer.element}
    </Modal>
  );
}

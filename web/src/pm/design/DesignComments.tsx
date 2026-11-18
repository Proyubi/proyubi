import { useIntl } from '@umijs/max';
import {
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Tag,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { formatWhen, publisherLabel } from '../mockup/utils';
import {
  addDesignComment,
  type DesignComment,
  deleteDesignComment,
  editDesignComment,
  listDesignComments,
  resolveDesignComment,
} from './api';

const MAX_COMMENT = 4000;

interface Props {
  designId: string;
  /** 表示中の修訂（新規コメントはこの修訂に付く） */
  revision: number;
  /**
   * .pen の画框単位：string = その画框（node_id）のコメントだけ、null = 画框に付かない版全体のコメントだけ。
   * 省略 = 全件（白板）。新規コメントはこの値で付く。
   */
  elementId?: string | null;
  /** 投稿・解決・削除の後（画框の未解決件数を更新する用） */
  onChanged?: () => void;
}

/**
 * 修訂単位の審査コメント（第一段階：要素への定位はしない）。
 * 本文はプレーンテキスト表示（HTML として解釈しない）。編集・削除は本人のみ、解決は誰でも（サーバで再判定）。
 */
export default function DesignComments({
  designId,
  revision,
  elementId,
  onChanged,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message } = App.useApp();
  const [scope, setScope] = useState<'rev' | 'all'>('rev');
  const [items, setItems] = useState<DesignComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    listDesignComments(designId, scope === 'rev' ? revision : undefined)
      .then((rows) =>
        setItems(
          elementId === undefined
            ? rows
            : rows.filter((c) => (c.elementId ?? null) === elementId),
        ),
      )
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [designId, revision, scope, elementId]);

  useEffect(load, [load]);

  const reload = () => {
    load();
    onChanged?.();
  };

  const post = async () => {
    const body = draft.trim();
    if (!body) {
      message.warning(t('design.comment.empty'));
      return;
    }
    setPosting(true);
    try {
      await addDesignComment(designId, revision, body, elementId ?? undefined);
      setDraft('');
      reload();
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (c: DesignComment) => {
    if (!editText.trim()) {
      message.warning(t('design.comment.empty'));
      return;
    }
    await editDesignComment(c.id, editText.trim());
    setEditingId(null);
    load();
  };

  const toggleResolved = async (c: DesignComment, resolved: boolean) => {
    await resolveDesignComment(c.id, resolved);
    reload();
  };

  return (
    <div className="pm-design-comments">
      <div className="pm-design-comments-head">
        <b>{t('design.comment.title')}</b>
        <Segmented
          size="small"
          value={scope}
          onChange={(v) => setScope(v as 'rev' | 'all')}
          options={[
            {
              value: 'rev',
              label: t('design.comment.scopeRev', { rev: revision }),
            },
            { value: 'all', label: t('design.comment.scopeAll') },
          ]}
        />
      </div>
      <div className="pm-design-comments-list">
        {loading ? (
          <Spin size="small" />
        ) : loadFailed ? (
          <div className="pm-design-error">
            {t('design.comment.loadFailed')}{' '}
            <Button size="small" onClick={load}>
              {t('design.retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('design.comment.none')}
          />
        ) : (
          items.map((c) => (
            <div
              key={c.id}
              className={`pm-design-comment${c.resolved ? ' is-resolved' : ''}`}
            >
              <div className="pm-design-comment-meta">
                <span>{publisherLabel(c.authorName, c.via)}</span>
                <Tag bordered={false}>v{c.revision}</Tag>
                <span className="pm-design-sub">{formatWhen(c.createdAt)}</span>
              </div>
              {editingId === c.id ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.TextArea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    maxLength={MAX_COMMENT}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                  />
                  <Space>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => saveEdit(c)}
                    >
                      {t('common.save')}
                    </Button>
                    <Button size="small" onClick={() => setEditingId(null)}>
                      {t('common.cancel')}
                    </Button>
                  </Space>
                </Space>
              ) : (
                <div className="pm-design-comment-body">{c.body}</div>
              )}
              <div className="pm-design-comment-actions">
                <Checkbox
                  checked={c.resolved}
                  onChange={(e) => toggleResolved(c, e.target.checked)}
                >
                  {c.resolved && c.resolvedByName
                    ? t('design.comment.resolvedBy', { name: c.resolvedByName })
                    : t('design.comment.resolved')}
                </Checkbox>
                {c.mine && editingId !== c.id && (
                  <Space size={4}>
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        setEditingId(c.id);
                        setEditText(c.body);
                      }}
                    >
                      {t('common.edit')}
                    </Button>
                    <Popconfirm
                      title={t('design.comment.deleteConfirm')}
                      okText={t('common.delete')}
                      cancelText={t('common.cancel')}
                      onConfirm={async () => {
                        await deleteDesignComment(c.id);
                        reload();
                      }}
                    >
                      <Button size="small" type="link" danger>
                        {t('common.delete')}
                      </Button>
                    </Popconfirm>
                  </Space>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="pm-design-comments-form">
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('design.comment.placeholder', { rev: revision })}
          maxLength={MAX_COMMENT}
          autoSize={{ minRows: 2, maxRows: 6 }}
        />
        <Button type="primary" loading={posting} onClick={post} block>
          {t('design.comment.post')}
        </Button>
      </div>
    </div>
  );
}

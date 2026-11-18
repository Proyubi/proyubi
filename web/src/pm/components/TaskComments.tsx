import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "@umijs/max";
import { App, Avatar, Button, type GetRef, Input, Popover, Spin } from "antd";
import { DeleteOutlined, EditOutlined, SmileOutlined } from "@ant-design/icons";
import type { Member, TaskComment } from "../types";
import dayjs from "../utils/date";
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from "../api";
import "./TaskComments.css";

interface Props {
  taskId: string;
  members: Member[];
}

/** 常用 emoji（工作评论场景）；点选插入到输入框光标处 */
const EMOJIS = [
  "👍",
  "🙏",
  "🎉",
  "✅",
  "🔥",
  "💪",
  "👀",
  "😄",
  "😅",
  "🤔",
  "😊",
  "😍",
  "😭",
  "🙌",
  "👏",
  "💡",
  "⚠️",
  "❤️",
  "🚀",
  "✨",
  "😂",
  "👌",
  "🆗",
  "❓",
  "❗",
  "📌",
  "📝",
  "⏰",
  "🐛",
  "🎯",
];

type TextAreaRef = GetRef<typeof Input.TextArea>;

/**
 * 任务评论区：挂在任务编辑弹窗底部。
 * 评论是独立于表单保存的即时 CRUD（发表/编辑/删除立刻落库，不随表单「保存」提交）。
 * 编辑/删除仅本人可见（comment.mine 由服务端判定）。
 */
export default function TaskComments({ taskId, members }: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { message, modal } = App.useApp();
  const memberMap = useMemo(() => {
    const m: Record<string, Member> = {};
    for (const x of members) m[x.id] = x;
    return m;
  }, [members]);

  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const draftRef = useRef<TextAreaRef>(null);

  /** 在光标处插入 emoji（取不到光标则追加到末尾），插入后保持焦点与光标 */
  const insertEmoji = (emoji: string) => {
    setEmojiOpen(false);
    const el = draftRef.current?.resizableTextArea?.textArea;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };
  /** 正在内联编辑的评论 id 与其编辑中的文本 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listComments(taskId)
      .then((list) => alive && setComments(list))
      .catch(() => alive && setComments([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [taskId]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const c = await createComment(taskId, content);
      setComments((prev) => [...prev, c]);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async (id: string) => {
    const content = editingText.trim();
    if (!content) return;
    const updated = await updateComment(id, content);
    setComments((prev) => prev.map((c) => (c.id === id ? updated : c)));
    setEditingId(null);
    setEditingText("");
  };

  const remove = (id: string) => {
    modal.confirm({
      title: t("projects.comments.deleteConfirm"),
      okText: t("common.delete"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteComment(id);
        setComments((prev) => prev.filter((c) => c.id !== id));
        message.success(t("common.deleted"));
      },
    });
  };

  return (
    <div className="pm-comments">
      <div className="pm-comments-title">
        {t("projects.comments.title")}
        {comments.length > 0 && (
          <span className="pm-comments-count">{comments.length}</span>
        )}
      </div>

      {loading ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spin size="small" />
        </div>
      ) : comments.length === 0 ? (
        <div className="pm-comments-empty">{t("projects.comments.empty")}</div>
      ) : (
        <ul className="pm-comments-list">
          {comments.map((c) => {
            const color = c.authorMemberId
              ? memberMap[c.authorMemberId]?.color
              : undefined;
            const editing = editingId === c.id;
            const authorLabel =
              (c.authorMemberId
                ? memberMap[c.authorMemberId]?.name
                : undefined) ||
              c.authorName ||
              "—";
            return (
              <li key={c.id} className="pm-comment">
                <Avatar
                  size={28}
                  className="pm-comment-avatar"
                  style={{ background: color ?? "#9ca3af" }}
                >
                  {authorLabel.slice(0, 2).toUpperCase()}
                </Avatar>
                <div className="pm-comment-body">
                  <div className="pm-comment-head">
                    <span className="pm-comment-author" title={authorLabel}>
                      {authorLabel}
                    </span>
                    <span className="pm-comment-time">
                      {dayjs(c.createdAt).format("YYYY-MM-DD HH:mm")}
                      {c.updatedAt !== c.createdAt && (
                        <span className="pm-comment-edited">
                          {t("projects.comments.edited")}
                        </span>
                      )}
                    </span>
                    {c.mine && !editing && (
                      <span className="pm-comment-ops">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          aria-label={t("common.edit")}
                          onClick={() => {
                            setEditingId(c.id);
                            setEditingText(c.content);
                          }}
                        />
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t("common.delete")}
                          onClick={() => remove(c.id)}
                        />
                      </span>
                    )}
                  </div>
                  {editing ? (
                    <div className="pm-comment-edit">
                      <Input.TextArea
                        autoSize={{ minRows: 2, maxRows: 6 }}
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            saveEdit(c.id);
                          }
                        }}
                      />
                      <div className="pm-comment-edit-ops">
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => saveEdit(c.id)}
                          disabled={!editingText.trim()}
                        >
                          {t("common.save")}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            setEditingId(null);
                            setEditingText("");
                          }}
                        >
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="pm-comment-text">{c.content}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="pm-comments-composer">
        <Input.TextArea
          ref={draftRef}
          autoSize={{ minRows: 4, maxRows: 10 }}
          placeholder={t("projects.comments.placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="pm-comments-composer-actions">
          <Popover
            trigger="click"
            placement="topLeft"
            open={emojiOpen}
            onOpenChange={setEmojiOpen}
            content={
              <div className="pm-emoji-grid">
                {EMOJIS.map((e) => (
                  <button
                    type="button"
                    key={e}
                    className="pm-emoji-item"
                    onClick={() => insertEmoji(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            }
          >
            <Button
              type="text"
              icon={<SmileOutlined />}
              aria-label={t("projects.comments.emoji")}
            />
          </Popover>
          <Button
            type="primary"
            loading={sending}
            disabled={!draft.trim()}
            onClick={send}
          >
            {t("projects.comments.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}

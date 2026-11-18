import { useEffect, useMemo, useState } from "react";
import { useIntl } from "@umijs/max";
import { Avatar, Empty, Select, Spin } from "antd";
import type {
  Member,
  TaskActivity as Activity,
  TaskActivityChange,
  TaskActivityGroup,
} from "../types";
import { TASK_ACTIVITY_GROUP, TASK_STATUS_META } from "../types";
import dayjs from "../utils/date";
import { listTaskActivities } from "../api";
import "./TaskActivity.css";

interface Props {
  taskId: string;
  members: Member[];
}

/** 説明の差分プレビューで、変更箇所の前後に残す文脈の長さ（文字） */
const CONTEXT_CHARS = 24;

/**
 * タスク操作履歴：タスクドロワー右カラム（バグ管理の右隣）の読み取り専用パネル。
 *
 * サーバ側で「1回の保存＝1件」に畳み込まれた履歴をそのまま時系列に並べる。
 * ここでやるのは表示だけ：
 *  - コード値（status / type など）のラベル化はロケールを持つこちらの責務
 *  - 集合フィールド（担当者・ラベル・サブタスク・依存）は矢印ではなく ＋/－ チップ
 *  - 説明は共通の前後を削った差分プレビュー（全文は展開で表示）
 * 追記専用なので編集・削除の導線は持たない。
 */
export default function TaskActivity({ taskId, members }: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  const [rows, setRows] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<TaskActivityGroup | "all">("all");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listTaskActivities(taskId)
      .then((r) => alive && setRows(r ?? []))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [taskId]);

  const memberMap = useMemo(() => {
    const m: Record<string, Member> = {};
    for (const x of members) m[x.id] = x;
    return m;
  }, [members]);

  /** 絞り込み用の件数。作成/サブタスク/依存は「その他」に寄せる */
  const counts = useMemo(() => {
    const c: Record<TaskActivityGroup, number> = {
      progress: 0,
      schedule: 0,
      people: 0,
      other: 0,
    };
    for (const r of rows) {
      const groups = new Set(activityGroups(r));
      for (const g of groups) c[g] += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(
    () =>
      group === "all"
        ? rows
        : rows.filter((r) => activityGroups(r).includes(group)),
    [rows, group]
  );

  if (loading) {
    return (
      <div className="pm-activity-loading">
        <Spin size="small" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="pm-activity">
        <Empty
          className="pm-activity-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <>
              <div>{t("projects.activity.empty")}</div>
              <div className="pm-activity-empty-hint">
                {t("projects.activity.emptyHint")}
              </div>
            </>
          }
        />
      </div>
    );
  }

  let lastDay = "";

  return (
    <div className="pm-activity">
      <div className="pm-activity-bar">
        <span className="pm-activity-title">
          {t("projects.activity.title")}
        </span>
        <span className="pm-activity-count">{rows.length}</span>
        <Select
          className="pm-activity-filter"
          size="small"
          variant="borderless"
          value={group}
          onChange={setGroup}
          popupMatchSelectWidth={200}
          options={[
            {
              value: "all",
              label: `${t("projects.activity.filter.all")} · ${rows.length}`,
            },
            ...(
              ["progress", "schedule", "people", "other"] as TaskActivityGroup[]
            ).map((g) => ({
              value: g,
              label: `${t(`projects.activity.filter.${g}`)} · ${counts[g]}`,
              disabled: counts[g] === 0,
            })),
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <div className="pm-activity-none">
          {t("projects.activity.noneInFilter")}
        </div>
      ) : (
        <ul className="pm-activity-feed">
          {visible.map((a, i) => {
            const day = dayjs(a.createdAt).format("YYYY-MM-DD");
            const showDay = day !== lastDay;
            lastDay = day;
            const color = a.actorMemberId
              ? memberMap[a.actorMemberId]?.color
              : undefined;
            const name =
              (a.actorMemberId ? memberMap[a.actorMemberId]?.name : undefined) ||
              a.actorName ||
              "—";
            return (
              <li key={a.id}>
                {showDay && (
                  <div className="pm-activity-day">
                    {day === dayjs().format("YYYY-MM-DD")
                      ? `${t("projects.activity.today")} · ${day}`
                      : day}
                  </div>
                )}
                <div
                  className={`pm-activity-item${
                    i === visible.length - 1 ? " is-last" : ""
                  }`}
                >
                  <Avatar
                    size={26}
                    className="pm-activity-avatar"
                    style={{ background: color ?? "#9ca3af" }}
                  >
                    {name.slice(0, 2).toUpperCase()}
                  </Avatar>
                  <div className="pm-activity-body">
                    <div className="pm-activity-head">
                      <span className="pm-activity-who" title={name}>
                        {name}
                      </span>
                      <span className="pm-activity-verb">{verb(a, t)}</span>
                      <span className="pm-activity-when">
                        {dayjs(a.createdAt).format("HH:mm")}
                      </span>
                      {a.source === "mcp" && (
                        <span className="pm-activity-source">MCP</span>
                      )}
                    </div>
                    <ChangeList changes={a.changes} t={t} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 1 件の履歴が属するフィルタ分類（複数フィールドなら複数に属する） */
function activityGroups(a: Activity): TaskActivityGroup[] {
  if (a.changes.length === 0) return ["other"];
  const set = new Set<TaskActivityGroup>();
  for (const c of a.changes) {
    set.add(TASK_ACTIVITY_GROUP[c.field] ?? "other");
  }
  return [...set];
}

/** 見出しの動詞。単一フィールドならフィールド名を出し、複数なら件数にまとめる */
function verb(
  a: Activity,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  switch (a.action) {
    case "created":
      return t("projects.activity.action.created");
    case "child_added":
      return t("projects.activity.action.childAdded");
    case "child_removed":
      return t("projects.activity.action.childRemoved");
    case "dep_added":
      return t("projects.activity.action.depAdded");
    case "dep_removed":
      return t("projects.activity.action.depRemoved");
    default:
      return a.changes.length === 1
        ? t("projects.activity.action.updatedOne", {
            field: fieldLabel(a.changes[0].field, t),
          })
        : t("projects.activity.action.updated", { count: a.changes.length });
  }
}

function fieldLabel(
  field: string,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  const key = `projects.activity.field.${field}`;
  const label = t(key);
  // 未知フィールド（後端が先行して増えた場合）はキーではなく素の名前を出す
  return label === key ? field : label;
}

function ChangeList({
  changes,
  t,
}: {
  changes: TaskActivityChange[];
  t: (id: string, values?: Record<string, string | number>) => string;
}) {
  if (changes.length === 0) return null;
  return (
    <div className="pm-activity-diffs">
      {changes.map((c) => (
        <ChangeRow key={c.field} change={c} t={t} />
      ))}
    </div>
  );
}

function ChangeRow({
  change,
  t,
}: {
  change: TaskActivityChange;
  t: (id: string, values?: Record<string, string | number>) => string;
}) {
  const { field, added, removed } = change;

  // 集合フィールド：＋追加 / －削除 のチップ
  if (added?.length || removed?.length) {
    return (
      <div className="pm-activity-diff">
        <span className="pm-activity-key">{fieldLabel(field, t)}</span>
        <span className="pm-activity-val">
          {(added ?? []).map((v) => (
            <span key={`a-${v}`} className="pm-activity-pill is-add">
              ＋ {v}
            </span>
          ))}
          {(removed ?? []).map((v) => (
            <span key={`r-${v}`} className="pm-activity-pill is-del">
              － {v}
            </span>
          ))}
        </span>
      </div>
    );
  }

  if (field === "description") {
    return <DescriptionDiff change={change} t={t} />;
  }

  return (
    <div className="pm-activity-diff">
      <span className="pm-activity-key">{fieldLabel(field, t)}</span>
      <span className="pm-activity-val">
        <Value field={field} raw={change.from} t={t} side="from" />
        <span className="pm-activity-arrow">→</span>
        <Value field={field} raw={change.to} t={t} side="to" />
      </span>
    </div>
  );
}

/** 単値の描画。ステータスだけは一目で読めるよう色付きピルにする */
function Value({
  field,
  raw,
  t,
  side,
}: {
  field: string;
  raw?: string | null;
  t: (id: string, values?: Record<string, string | number>) => string;
  side: "from" | "to";
}) {
  const v = raw ?? "";
  const cls = side === "from" ? "pm-activity-old" : "pm-activity-new";

  if (field === "status") {
    if (!v) return <span className={cls}>{t("projects.activity.none")}</span>;
    const meta = TASK_STATUS_META[v as keyof typeof TASK_STATUS_META];
    return (
      <span
        className={`pm-activity-pill${side === "from" ? " is-old" : ""}`}
        style={
          side === "to" && meta
            ? { background: `${meta.color}1a`, color: meta.color }
            : undefined
        }
      >
        {meta ? t(meta.i18nKey) : v}
      </span>
    );
  }

  if (!v) {
    return (
      <span className={cls}>
        {field === "plannedEffort" || field === "actualEffort"
          ? t("projects.activity.autoEffort")
          : t("projects.activity.none")}
      </span>
    );
  }

  return (
    <span className={`${cls} ${isNumeric(field) ? "pm-activity-num" : ""}`}>
      {display(field, v, t)}
    </span>
  );
}

function isNumeric(field: string): boolean {
  return (
    field === "progress" ||
    field === "planRange" ||
    field === "actualRange" ||
    field === "plannedEffort" ||
    field === "actualEffort"
  );
}

/** コード値・機械可読な値を表示用に整える */
function display(
  field: string,
  v: string,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  switch (field) {
    case "progress":
      return `${v}%`;
    case "planRange":
    case "actualRange": {
      // "2026-08-17~2026-09-04"（片側だけなら空）
      const [s, e] = v.split("~");
      const dash = t("projects.activity.ongoing");
      return `${s || dash} 〜 ${e || dash}`;
    }
    case "type":
      return t(`projects.taskForm.type.${v}`);
    case "roadmapVisible":
      return t(
        v === "true"
          ? "projects.activity.value.shown"
          : "projects.activity.value.hidden"
      );
    default:
      return v;
  }
}

/**
 * 説明（リッチテキスト）の差分。共通の前後を削り、変わった部分だけを見せる。
 * 全文は履歴に保存された範囲（サーバ側で 500 文字に打ち切り）まで展開できる。
 */
function DescriptionDiff({
  change,
  t,
}: {
  change: TaskActivityChange;
  t: (id: string, values?: Record<string, string | number>) => string;
}) {
  const [open, setOpen] = useState(false);
  const from = change.from ?? "";
  const to = change.to ?? "";
  const d = useMemo(() => inlineDiff(from, to), [from, to]);

  return (
    <div className="pm-activity-diffs">
      <div className="pm-activity-text">
        {open ? (
          <>
            {from && (
              <div className="pm-activity-full is-old">{from}</div>
            )}
            <div className="pm-activity-full">{to || t("projects.activity.none")}</div>
          </>
        ) : (
          <>
            {d.prefix && <span>{d.prefix}</span>}
            {d.removed && <span className="pm-activity-cut">{d.removed}</span>}
            {d.added && <span className="pm-activity-ins">{d.added}</span>}
            {d.suffix && <span>{d.suffix}</span>}
          </>
        )}
        <button
          type="button"
          className="pm-activity-more"
          onClick={() => setOpen((o) => !o)}
        >
          {t(
            open ? "projects.activity.collapse" : "projects.activity.showFull"
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 共通の先頭・末尾を削って「変わった中身」だけを取り出す。
 * 文脈は前後 {@link CONTEXT_CHARS} 文字だけ残し、削った側には省略記号を付ける。
 * 形態素解析は行わない（日本語・中国語で単語分割が破綻するため、文字単位で十分）。
 */
function inlineDiff(from: string, to: string) {
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  ) {
    tail += 1;
  }
  const prefixFull = from.slice(0, head);
  const suffixFull = from.slice(from.length - tail);
  return {
    prefix:
      prefixFull.length > CONTEXT_CHARS
        ? `…${prefixFull.slice(-CONTEXT_CHARS)}`
        : prefixFull,
    removed: from.slice(head, from.length - tail),
    added: to.slice(head, to.length - tail),
    suffix:
      suffixFull.length > CONTEXT_CHARS
        ? `${suffixFull.slice(0, CONTEXT_CHARS)}…`
        : suffixFull,
  };
}

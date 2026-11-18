import {
  ArrowRightOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { Button, Drawer, Tooltip } from "antd";
import {
  PROJECT_DISPLAY_STATUS_META,
  projectDisplayStatus,
} from "@/pm/utils/projectStatus";
import type { Project } from "@/pm/types";
import { fmt } from "@/pm/utils/date";
import {
  isOverdueWithSubs,
  isOwnOverdue,
  subSummary,
} from "@/pm/utils/projectTree";

type Props = {
  /** 表示中の親。null で閉じる */
  parent: Project | null;
  /** 親のサブ一覧（sort_order 順） */
  subs: Project[];
  onClose: () => void;
  onOpen: (p: Project) => void;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
  onAddSub: (parent: Project) => void;
  /** 「全サブ完了 → 納品済みにしますか？」の提案から親を納品済みにする（ユーザー操作のみ） */
  onMarkDone: (parent: Project) => void;
};

/** カードの淡色状態タグ（カードビューと同じ見た目） */
function StatusPill({ p }: { p: Project }) {
  const intl = useIntl();
  return (
    <span className={`pm-card-status is-${projectDisplayStatus(p)}`}>
      <i className="pm-card-dot" />
      {intl.formatMessage({ id: PROJECT_DISPLAY_STATUS_META[projectDisplayStatus(p)].i18nKey })}
    </span>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="pm-card-progress pm-subd-progress">
      <div className="pm-card-rail">
        <span
          className={`pm-card-fill${pct >= 100 ? " is-done" : ""}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="pm-card-pct">{pct}%</span>
    </div>
  );
}

/**
 * サブプロジェクト一覧ドロワー（カードビューでサブを持つカードをクリックしたとき）。
 * 上：親の名前 / 状態 / 期間 / 進捗（集計の説明つき）。中：サブ 1 件 1 行。下：追加 / 閉じる。
 */
export default function SubProjectDrawer({
  parent,
  subs,
  onClose,
  onOpen,
  onEdit,
  onDelete,
  onAddSub,
  onMarkDone,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const sum = subSummary(subs);

  const period = (p: Project, withSubs = false) => {
    const overdueOwn = isOwnOverdue(p);
    const overdueSub = withSubs && !overdueOwn && isOverdueWithSubs(p, subs);
    return (
      <span className="pm-tbl-date">
        {fmt(p.start, "YYYY/MM/DD")} —{" "}
        {p.end ? (
          fmt(p.end, "YYYY/MM/DD")
        ) : (
          <span className="pm-tbl-ongoing">{t("projects.card.ongoing")}</span>
        )}
        {overdueOwn && (
          <span className="pm-tbl-overdue"> · {t("projects.card.overdue")}</span>
        )}
        {overdueSub && (
          <span className="pm-tbl-overdue"> · {t("projects.sub.overdueHint")}</span>
        )}
      </span>
    );
  };

  return (
    <Drawer
      open={!!parent}
      onClose={onClose}
      size={480}
      title={t("projects.sub.drawerTitle")}
      extra={
        <span className="pm-subd-count">
          {t("projects.sub.drawerCount", { count: subs.length })}
        </span>
      }
      styles={{ body: { padding: 0 } }}
      footer={
        <div className="pm-subd-foot">
          {parent && (
            <Button
              type="link"
              icon={<PlusOutlined />}
              onClick={() => onAddSub(parent)}
              style={{ paddingInline: 0 }}
            >
              {t("projects.sub.add")}
            </Button>
          )}
          <Button onClick={onClose}>{t("projects.sub.close")}</Button>
        </div>
      }
      destroyOnHidden
    >
      {parent && (
        <>
          <div className="pm-subd-sum">
            <div className="pm-subd-r1">
              <b className="pm-subd-name">{parent.name}</b>
              <StatusPill p={parent} />
            </div>
            <div className="pm-subd-r1">{period(parent, true)}</div>
            <Bar pct={parent.progress ?? 0} />
            <div className="pm-subd-note">{t("projects.sub.rollupNote")}</div>
            {sum.allDone && parent.status !== "done" && (
              <div className="pm-subd-alldone">
                <CheckCircleFilled />
                <span>{t("projects.sub.allDone")}</span>
                <Button
                  size="small"
                  type="link"
                  onClick={() => onMarkDone(parent)}
                >
                  {t("projects.sub.markDone")}
                </Button>
              </div>
            )}
          </div>
          <div className="pm-subd-list">
            {subs.map((c) => (
              <div key={c.id} className="pm-subd-row">
                <i className={`pm-sub-dot is-${projectDisplayStatus(c)}`} />
                <a
                  className="pm-subd-row-name"
                  title={c.name}
                  onClick={() => onOpen(c)}
                >
                  {c.name}
                </a>
                <span className="pm-subd-acts">
                  <Tooltip title={t("projects.card.enter")}>
                    <a onClick={() => onOpen(c)}>
                      <ArrowRightOutlined />
                    </a>
                  </Tooltip>
                  <Tooltip title={t("projects.card.edit")}>
                    <a onClick={() => onEdit(c)}>
                      <EditOutlined />
                    </a>
                  </Tooltip>
                  <Tooltip title={t("projects.card.delete")}>
                    <a className="is-danger" onClick={() => onDelete(c)}>
                      <DeleteOutlined />
                    </a>
                  </Tooltip>
                </span>
                <div className="pm-subd-row-sub">
                  <span className="pm-subd-row-meta">
                    <StatusPill p={c} />
                    {period(c)}
                  </span>
                  <Bar pct={c.progress ?? 0} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}

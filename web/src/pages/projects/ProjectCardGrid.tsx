import {
  EllipsisOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { Button, Dropdown, type MenuProps, Tooltip } from "antd";
import {
  PROJECT_DISPLAY_STATUS_META,
  projectDisplayStatus,
} from "@/pm/utils/projectStatus";
import { useState } from "react";
import type { Project } from "@/pm/types";
import { fmt } from "@/pm/utils/date";
import {
  isOverdueWithSubs,
  isOwnOverdue,
  subSummary,
} from "@/pm/utils/projectTree";

/**
 * 運用型の「今月 x/y 件完了」。一覧の進捗列とカードで同じ値を出すための共通化。
 * 後端が集計済みの monthDoneCount / monthTotalCount をそのまま使う（未集計は 0 扱い）。
 */
export function opsMonthCounts(p: Project) {
  return { done: p.monthDoneCount ?? 0, total: p.monthTotalCount ?? 0 };
}

/**
 * 「＋プロジェクト作成」の入口に出す文言。カードとリストの作成行で共通。
 * 顧客未選択なら作れないので「先に選んで」を出す。
 */
export function useCreateEntryText(customerName?: string) {
  const intl = useIntl();
  return customerName
    ? intl.formatMessage(
        { id: "projects.createEntry.addTo" },
        { customer: customerName }
      )
    : intl.formatMessage({ id: "projects.createEntry.needCustomer" });
}

type Props = {
  /** トップレベルのプロジェクトだけ（サブはカードにしない） */
  projects: Project[];
  /** 親 id → サブ一覧 */
  childrenOf: Map<string, Project[]>;
  /** 選択中の顧客 / 製品名。未選択なら作成カードは無効表示 */
  customerName?: string;
  canCreate: boolean;
  onCreate: () => void;
  onOpen: (p: Project) => void;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
  /** サブを持つカードのクリック / バッジ行 → サブ一覧ドロワー */
  onShowSubs: (p: Project) => void;
  onAddSub: (p: Project) => void;
  /** 絞り込み結果が空のときの控えめなヒント */
  emptyHint?: React.ReactNode;
};

/**
 * プロジェクト管理のカードビュー。一覧と同じ絞り込み・並び順のデータを受け取り、
 * 先頭は常に「＋プロジェクト作成」カード。ページング・ドラッグ並べ替えはしない。
 * カードはトップレベルだけ。サブは下端のバッジ行（件数・完了・期限超過）で示し、
 * クリックでドロワーに一覧を出す。
 */
export default function ProjectCardGrid({
  projects,
  childrenOf,
  customerName,
  canCreate,
  onCreate,
  onOpen,
  onEdit,
  onDelete,
  onShowSubs,
  onAddSub,
  emptyHint,
}: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const createSub = useCreateEntryText(customerName);

  return (
    <div className="pm-card-scroll">
      <div className="pm-card-grid">
        <button
          type="button"
          className={`pm-card pm-card-create${canCreate ? "" : " is-disabled"}`}
          disabled={!canCreate}
          aria-disabled={!canCreate}
          onClick={onCreate}
        >
          <span className="pm-card-create-icon">
            <PlusOutlined />
          </span>
          <span className="pm-card-create-title">{t("projects.create")}</span>
          {!canCreate && (
            <span className="pm-card-create-sub" title={createSub}>
              {createSub}
            </span>
          )}
        </button>
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            p={p}
            subs={childrenOf.get(p.id) ?? []}
            onOpen={onOpen}
            onEdit={onEdit}
            onDelete={onDelete}
            onShowSubs={onShowSubs}
            onAddSub={onAddSub}
          />
        ))}
      </div>
      {projects.length === 0 && emptyHint ? (
        <div className="pm-card-empty">{emptyHint}</div>
      ) : null}
    </div>
  );
}

function ProjectCard({
  p,
  subs,
  onOpen,
  onEdit,
  onDelete,
  onShowSubs,
  onAddSub,
}: {
  p: Project;
  subs: Project[];
  onOpen: (p: Project) => void;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
  onShowSubs: (p: Project) => void;
  onAddSub: (p: Project) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = PROJECT_DISPLAY_STATUS_META[projectDisplayStatus(p)];
  const isOps = p.kind === "ops";
  const sum = subSummary(subs);
  const hasSubs = sum.count > 0;
  // 親は自分 or サブのどれかが期限超過なら期限超過扱い
  const overdue = isOverdueWithSubs(p, subs);
  const overdueBySubOnly = overdue && !isOwnOverdue(p);
  // カード本体クリック：サブを持つ親はサブ一覧ドロワー、それ以外はガント
  const activate = () => (hasSubs ? onShowSubs(p) : onOpen(p));

  const items: MenuProps["items"] = [
    { key: "open", label: t("projects.card.enter") },
    { key: "edit", label: t("projects.cardView.edit") },
    // 運用型はサブを持てない（v1）
    ...(isOps ? [] : [{ key: "addSub", label: t("projects.sub.add") }]),
    { type: "divider" as const },
    { key: "delete", label: t("projects.cardView.delete"), danger: true },
  ];
  const onMenu: MenuProps["onClick"] = ({ key, domEvent }) => {
    // portal 経由でも React のイベントは親へバブルするので念のため止める
    domEvent.stopPropagation();
    setMenuOpen(false);
    if (key === "open") onOpen(p);
    else if (key === "edit") onEdit(p);
    else if (key === "addSub") onAddSub(p);
    else if (key === "delete") onDelete(p);
  };

  let period: React.ReactNode;
  if (!p.end) {
    // 終了日なし＝期限なし。自分自身の期限超過判定はしない（超過ならサブ由来）
    period = (
      <>
        {fmt(p.start, "YYYY/MM/DD")} —{" "}
        <span className="pm-tbl-ongoing">{t("projects.card.ongoing")}</span>
        {overdue && (
          <span className="pm-card-overdue" title={t("projects.sub.overdueHint")}>
            {t("projects.card.overdue")}
          </span>
        )}
      </>
    );
  } else {
    period = (
      <>
        <span className={overdue ? "pm-card-date-over" : undefined}>
          {fmt(p.start, "YYYY/MM/DD")} — {fmt(p.end, "YYYY/MM/DD")}
        </span>
        {overdue && (
          <span
            className="pm-card-overdue"
            title={overdueBySubOnly ? t("projects.sub.overdueHint") : undefined}
          >
            {t("projects.card.overdue")}
          </span>
        )}
      </>
    );
  }

  let metric: React.ReactNode;
  if (isOps) {
    metric = (
      <div className="pm-card-ops">
        {t("projects.ops.thisMonth", opsMonthCounts(p))}
      </div>
    );
  } else {
    const pct = p.progress ?? 0;
    metric = (
      <Tooltip
        title={t(
          hasSubs ? "projects.sub.progressTipSubs" : "projects.sub.progressTip"
        )}
      >
        {/* 透明ボタンより上に出して Tooltip を効かせる。クリックはカード本体と同じ動作 */}
        <div className="pm-card-progress is-over-hit" onClick={activate}>
          <div className="pm-card-rail">
            <span
              className={`pm-card-fill${pct >= 100 ? " is-done" : ""}`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <span className="pm-card-pct">{pct}%</span>
        </div>
      </Tooltip>
    );
  }

  // バッジの色：期限超過のサブあり=赤 / 全部完了=緑 / それ以外=主青
  const badgeTone =
    sum.overdue > 0 ? " is-red" : sum.allDone ? " is-green" : "";
  let subRow: React.ReactNode;
  if (isOps) {
    subRow = <div className="pm-card-sub pm-card-sub-none">—</div>;
  } else if (hasSubs) {
    subRow = (
      <button
        type="button"
        className="pm-card-sub is-link"
        title={t("projects.sub.showList")}
        aria-label={
          sum.overdue > 0
            ? `${sum.count} ${t("projects.sub.label")} ${t("projects.sub.doneOf", { done: sum.done, total: sum.count })} ${t("projects.sub.overdueN", { count: sum.overdue })}`
            : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          onShowSubs(p);
        }}
      >
        <span className={`pm-card-nb${badgeTone}`}>{sum.count}</span>
        {/* 期限超過ありは「期限超過 N」が増えて幅が足りないので短いラベル（全文は title） */}
        <span
          className="pm-card-sub-lbl"
          title={sum.overdue > 0 ? t("projects.sub.label") : undefined}
        >
          {t(
            sum.overdue > 0 ? "projects.sub.labelShort" : "projects.sub.label"
          )}
        </span>
        <span className="pm-card-sub-done">
          {t("projects.sub.doneOf", { done: sum.done, total: sum.count })}
        </span>
        {sum.overdue > 0 && (
          <span className="pm-card-sub-over">
            {t("projects.sub.overdueN", { count: sum.overdue })}
          </span>
        )}
        <RightOutlined className="pm-card-sub-chev" />
      </button>
    );
  } else {
    // サブなし：バッジは出さずに行の高さだけ確保（全カードで段の位置を揃える）
    subRow = <div className="pm-card-sub" />;
  }

  return (
    <div className={`pm-card pm-card-item${menuOpen ? " is-menu-open" : ""}`}>
      {/* カード全面を覆う透明ボタン＝本体クリック / Enter。
          サブを持つ親はサブ一覧ドロワー、それ以外はガントを開く。
          「⋯」をボタンの中に入れ子にできないので、重ねて z-index で上に出す */}
      <button
        type="button"
        className="pm-card-hit"
        aria-label={p.name}
        title={p.name}
        onClick={activate}
      />
      <div className="pm-card-head">
        <span className={`pm-card-status is-${projectDisplayStatus(p)}`}>
          <i className="pm-card-dot" />
          {t(meta.i18nKey)}
        </span>
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          menu={{ items, onClick: onMenu }}
        >
          <Button
            type="text"
            size="small"
            className="pm-card-more"
            onClick={(event) => event.stopPropagation()}
            icon={<EllipsisOutlined />}
            aria-label={t("projects.cardView.more")}
          />
        </Dropdown>
      </div>
      <div className="pm-card-name" title={p.name}>
        {p.name}
      </div>
      <div className="pm-card-period">{period}</div>
      {metric}
      {subRow}
    </div>
  );
}

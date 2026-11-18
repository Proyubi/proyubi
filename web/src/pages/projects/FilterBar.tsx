import { useIntl } from "@umijs/max";
import {
  PROJECT_DISPLAY_STATUS_META,
  projectDisplayStatus,
  type ProjectDisplayStatus,
} from "@/pm/utils/projectStatus";
import type { Project } from "@/pm/types";
import { isOverdueWithSubs, isOwnOverdue } from "@/pm/utils/projectTree";

/**
 * プロジェクト一覧の絞り込み行（テーブルカードのツールバー 2 行目）。
 *
 * ここは「今出ている表を減らす」もの。対象は選択中の顧客配下のプロジェクトだけで、
 * 状態チップだけで絞る。名前で探すのはヘッダーの ⌘K パレット（SearchButton）の担当
 * （顧客あたりの件数は少なくチップで足りるので、表内のキーワード欄は置かない）。
 * カードの外に出すと「全体検索」に見えてしまうため、必ずカード内に置くこと。
 */

/** チップの識別子。「すべて」「期限超過」は status ではないので、チップとしてだけ存在する */
export type ProjectFilterKey = ProjectDisplayStatus | "all" | "overdue";
export type ProjectFilterCounts = Record<ProjectFilterKey, number>;

/**
 * 絞り込み条件。
 * - statuses：状態チップの複数選択（OR）。空＝「すべて」。
 * - overdue：期限超過チップ。状態とは別軸なので AND で掛け合わせる（例：進行中 ∧ 期限超過）。
 */
export type ProjectFilter = {
  statuses: ProjectDisplayStatus[];
  overdue: boolean;
};
export const EMPTY_PROJECT_FILTER: ProjectFilter = { statuses: [], overdue: false };

/** 何も絞っていない（ドラッグ並べ替えを許可できる）状態か */
export function isProjectFilterEmpty(f: ProjectFilter) {
  return f.statuses.length === 0 && !f.overdue;
}

/**
 * 期限超過：終了日が過ぎているのに終わっていないもの。
 * 期間列 / カードの赤字表示と絞り込みチップで同じ判定を使う（片方だけ直してズレるのを防ぐ）。
 * 終了日なし＝継続中（運用型）は期限が無いので対象外。
 */
export function isOverdue(p: Project) {
  return isOwnOverdue(p);
}

/**
 * 絞り込み行（チップ）を適用する。リストとカードで同じ結果を出すための共通化。
 *
 * サブプロジェクト対応：list はトップレベルだけを渡す（チップの件数・ページングもトップレベル基準）。
 * - 状態チップ：選択した状態のどれかに当たれば該当（OR）。期限超過とは AND。
 * - 期限超過チップ：親は自分 or サブのどれかが期限超過なら該当（{@link isOverdueWithSubs}）。
 */
export function applyProjectFilter(
  list: Project[],
  filter: ProjectFilter,
  childrenOf?: Map<string, Project[]>
): Project[] {
  let out = list;
  if (filter.statuses.length > 0) {
    const set = new Set(filter.statuses);
    out = out.filter((p) => set.has(projectDisplayStatus(p)));
  }
  if (filter.overdue) {
    out = out.filter((p) => isOverdueWithSubs(p, childrenOf?.get(p.id)));
  }
  return out;
}

/**
 * 表示用ライフサイクル順。作業完了（ready）と手動の納品済み（done）は区別する。
 */
const STATUS_ORDER: ProjectDisplayStatus[] = ["planned", "active", "ready", "paused", "done"];

export default function ProjectFilterBar({
  counts,
  value,
  onChange,
  disabled,
}: {
  counts: ProjectFilterCounts;
  value: ProjectFilter;
  onChange: (v: ProjectFilter) => void;
  /** 顧客未選択：表が空なので絞り込みも効かせない */
  disabled?: boolean;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });

  // 状態チップを切り替える。全部選んだら「すべて」と同じなので空に戻す
  // （見た目が違うのに結果が同じ、という状態を作らない）
  const toggleStatus = (s: ProjectDisplayStatus) => {
    const has = value.statuses.includes(s);
    const next = has
      ? value.statuses.filter((x) => x !== s)
      : STATUS_ORDER.filter((x) => x === s || value.statuses.includes(x));
    onChange({
      ...value,
      statuses: next.length === STATUS_ORDER.length ? [] : next,
    });
  };

  const chip = (
    v: ProjectFilterKey,
    label: string,
    on: boolean,
    onClick: () => void,
    overdue = false
  ) => {
    // 0 件のチップは押しても空になるだけなので落とす。ただし選択中のものは
    // 残す（削除で 0 件になった直後に解除できなくなるのを防ぐ）
    const off = disabled || (!on && counts[v] === 0);
    return (
      <button
        key={v}
        type="button"
        className={`pm-filter-chip${on ? " is-on" : ""}${
          overdue ? " is-overdue" : ""
        }`}
        aria-pressed={on}
        disabled={off}
        onClick={onClick}
      >
        {overdue && <span className="pm-filter-dot" />}
        {label}
        <b>{counts[v]}</b>
      </button>
    );
  };

  return (
    <div className="pm-filter">
      <div className="pm-filter-chips">
        {/* 「すべて」は状態の選択を全部外す（期限超過はそのまま） */}
        {chip("all", t("projects.filter.all"), value.statuses.length === 0, () =>
          onChange({ ...value, statuses: [] })
        )}
        {STATUS_ORDER.map((s) =>
          chip(
            s,
            t(PROJECT_DISPLAY_STATUS_META[s].i18nKey),
            value.statuses.includes(s),
            () => toggleStatus(s)
          )
        )}
        {/* 期限超過は status ではなく期間から導出する値。同列に並べると
            「状態のひとつ」に見えるので区切りと破線枠で分ける */}
        <span className="pm-filter-sep" />
        {chip(
          "overdue",
          t("projects.card.overdue"),
          value.overdue,
          () => onChange({ ...value, overdue: !value.overdue }),
          true
        )}
      </div>
    </div>
  );
}

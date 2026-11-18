import { SearchOutlined } from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { Input } from "antd";
import { PROJECT_STATUS_META, type ProjectStatus } from "@/pm/types";

/**
 * プロジェクト一覧の絞り込み行（テーブルカードのツールバー 2 行目）。
 *
 * ここは「今出ている表を減らす」もの。対象は選択中の顧客配下のプロジェクトだけで、
 * 名前と説明しか見ない。顧客を跨いでタスク / バグまで探すのはヘッダーの ⌘K パレット
 * （SearchButton）の担当なので、役割が混ざらないよう置き場所を分けている。
 * カードの外に出すと「全体検索」に見えてしまうため、必ずカード内に置くこと。
 */

/** 「すべて」「期限超過」は status ではないので、絞り込みの値としてだけ存在する */
export type ProjectFilter = ProjectStatus | "all" | "overdue";
export type ProjectFilterCounts = Record<ProjectFilter, number>;

/**
 * チップの並びはライフサイクル順にする。PROJECT_STATUS_META のキー順
 * （planned / active / done / paused）だと納品済みが一時停止より前に来て、
 * 左から右へ進む流れとして読めなくなる。
 */
const STATUS_ORDER: ProjectStatus[] = ["planned", "active", "paused", "done"];

export default function ProjectFilterBar({
  counts,
  value,
  onChange,
  keyword,
  onKeyword,
  disabled,
}: {
  counts: ProjectFilterCounts;
  value: ProjectFilter;
  onChange: (v: ProjectFilter) => void;
  keyword: string;
  onKeyword: (v: string) => void;
  /** 顧客未選択：表が空なので絞り込みも効かせない */
  disabled?: boolean;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });

  const chip = (v: ProjectFilter, label: string, overdue = false) => {
    const on = value === v;
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
        // 同じチップをもう一度押したら解除（「すべて」に戻す）
        onClick={() => onChange(on && v !== "all" ? "all" : v)}
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
        {chip("all", t("projects.filter.all"))}
        {STATUS_ORDER.map((s) => chip(s, t(PROJECT_STATUS_META[s].i18nKey)))}
        {/* 期限超過は status ではなく期間から導出する値。同列に並べると
            「状態のひとつ」に見えるので区切りと破線枠で分ける */}
        <span className="pm-filter-sep" />
        {chip("overdue", t("projects.card.overdue"), true)}
      </div>
      <Input
        className="pm-filter-kw"
        allowClear
        value={keyword}
        onChange={(e) => onKeyword(e.target.value)}
        prefix={<SearchOutlined />}
        placeholder={t("projects.filter.placeholder")}
        disabled={disabled}
        aria-label={t("projects.filter.placeholder")}
      />
    </div>
  );
}

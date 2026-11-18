import { SearchOutlined } from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { openTaskSearch } from "./index";
import "./button.css";

/**
 * ページ内に置く「見せかけの検索窓」。押すとコマンドパレット（⌘K）を開くだけ。
 *
 * サイドバーのアイコンだけだと ⌘K を知らない人が検索に辿り着けないため、
 * 一覧系ページ（俯瞰 / プロジェクト管理）のヘッダー右にだけ発見装置として置く。
 * 「この一覧を絞り込む」フィルタとは別物なので、既にフィルタ行があるページでは
 * その隣ではなくヘッダー側に離して置く。
 */
export default function SearchButton({
  /** 狭い画面ではラベルと ⌘K を落としてアイコンだけにする */
  compact,
}: {
  compact?: boolean;
}) {
  const { formatMessage } = useIntl();
  return (
    <button
      type="button"
      className={`tsp-btn${compact ? " is-compact" : ""}`}
      onClick={() => openTaskSearch()}
      aria-label={formatMessage({ id: "search.entry" })}
    >
      <SearchOutlined />
      <span className="tsp-btn-label">
        {formatMessage({ id: "search.placeholder" })}
      </span>
      <kbd className="tsp-kbd">⌘K</kbd>
    </button>
  );
}

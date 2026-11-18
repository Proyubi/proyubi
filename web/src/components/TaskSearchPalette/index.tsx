import { SearchOutlined } from "@ant-design/icons";
import { history, useIntl } from "@umijs/max";
import { Avatar, Empty, Modal, Spin, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchAll } from "@/pm/api";
import { useData } from "@/pm/store";
import { bugDisplayNo } from "@/pm/utils/bug";
import { highlightText } from "@/pm/utils/highlight";
import type {
  PmSearchVO,
  SearchBugHit,
  SearchKind,
  SearchProjectHit,
  SearchTaskHit,
} from "@/pm/types";
import { EMPTY_SEARCH } from "@/pm/types";
import "./index.css";

/**
 * 全ページ共通のタスク検索パレット（⌘K / Ctrl+K）。
 *
 * pm-web は headerRender:false でトップバーが無いため、常駐の検索窓を置ける場所が無い。
 * 可視な入口は各ページヘッダーの {@link SearchButton} だけにして、実体はこのモーダルに寄せる。
 * ボタン側は {@link OPEN_EVENT} を投げるだけなので、入口をどこに増やしても import 1 行で済む。
 * 本体は app.tsx の childrenRender でマウントされる（サイドバー側だとモバイルで
 * Drawer に閉じ込められ、Drawer を開くまで ⌘K が効かない）。
 */
const OPEN_EVENT = "pm:open-search";

/**
 * 任意の場所からパレットを開く。ページ側は import するだけでよい。
 *
 * keyword を渡すとその語で開く。一覧の絞り込みが空振りしたときに、打った語を
 * 捨てさせず横断検索へ引き継ぐための入口（projects の空状態から使っている）。
 */
export function openTaskSearch(keyword?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { keyword } }));
}

/** 入力から実際に投げるまでの待ち時間(ms)。日本語 IME の変換確定を待てる程度。 */
const DEBOUNCE_MS = 220;

type Row =
  | { kind: "task"; data: SearchTaskHit }
  | { kind: "project"; data: SearchProjectHit }
  | { kind: "bug"; data: SearchBugHit };

const KIND_CHIPS: (SearchKind | "all")[] = ["all", "task", "project", "bug"];

export default function TaskSearchPalette() {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    formatMessage({ id }, values);
  const { memberMap, ensureBase } = useData();

  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [kind, setKind] = useState<SearchKind | "all">("all");
  const [result, setResult] = useState<PmSearchVO>(EMPTY_SEARCH);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** 遅れて返ってきた古いレスポンスで新しい結果を上書きしないための世代番号 */
  const seqRef = useRef(0);
  /** IME 変換中は検索を投げない（「かんり」の途中で叩かない） */
  const composingRef = useRef(false);

  // ---- 開閉 ----
  const openPalette = useCallback(
    (initialKeyword?: string) => {
      setOpen(true);
      // 呼び出し側が語を渡してきたときだけ入力欄を埋める。
      // ⌘K / ボタンからは undefined なので、閉じたときの初期化がそのまま効く
      if (initialKeyword !== undefined) {
        setKeyword(initialKeyword);
        setKind("all");
        setCursor(0);
      }
      ensureBase();
    },
    [ensureBase]
  );

  useEffect(() => {
    const onOpen = (e: Event) =>
      openPalette((e as CustomEvent<{ keyword?: string }>).detail?.keyword);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [openPalette]);

  // ---- 検索（デバウンス + 世代チェック）----
  useEffect(() => {
    if (!open) return;
    const kw = keyword.trim();
    if (!kw) {
      setResult(EMPTY_SEARCH);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++seqRef.current;
    const timer = window.setTimeout(() => {
      searchAll(kw)
        .then((r) => {
          if (seq !== seqRef.current) return;
          setResult(r ?? EMPTY_SEARCH);
          setCursor(0);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setResult(EMPTY_SEARCH);
        })
        .finally(() => {
          if (seq === seqRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [keyword, open]);

  // ---- 表示行（チップで種別を絞る）----
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (kind === "all" || kind === "task")
      for (const d of result.tasks) out.push({ kind: "task", data: d });
    if (kind === "all" || kind === "project")
      for (const d of result.projects) out.push({ kind: "project", data: d });
    if (kind === "all" || kind === "bug")
      for (const d of result.bugs) out.push({ kind: "bug", data: d });
    return out;
  }, [result, kind]);

  const counts = {
    all: result.tasks.length + result.projects.length + result.bugs.length,
    task: result.tasks.length,
    project: result.projects.length,
    bug: result.bugs.length,
  };

  // ---- 遷移 ----
  const go = useCallback((row: Row) => {
    setOpen(false);
    if (row.kind === "task") {
      // 俯瞰と同じディープリンク。gantt 側が ?taskId= で当該行をハイライトする
      if (row.data.projectId)
        history.push(
          `/projects/${row.data.projectId}/gantt?taskId=${row.data.id}`
        );
      return;
    }
    if (row.kind === "project") {
      history.push(`/projects/${row.data.id}/gantt`);
      return;
    }
    history.push(
      row.data.customerId
        ? `/quality?customerId=${row.data.customerId}&bugId=${row.data.id}`
        : "/quality"
    );
  }, []);

  /** タスク行で Shift+Enter → 案件（WBS トップ）を開く */
  const goProject = useCallback((row: Row) => {
    const pid =
      row.kind === "task"
        ? row.data.projectId
        : row.kind === "project"
        ? row.data.id
        : row.data.projectId;
    if (!pid) return;
    setOpen(false);
    history.push(`/projects/${pid}/gantt`);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      const row = rows[cursor];
      if (!row) return;
      e.preventDefault();
      if (e.shiftKey) goProject(row);
      else go(row);
    }
  };

  // 選択行を可視領域に保つ
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const renderAssignees = (ids: string[]) => {
    if (!ids.length) return null;
    return (
      <Avatar.Group size={20} max={{ count: 3 }}>
        {ids.map((id) => {
          const m = memberMap[id];
          return (
            <Tooltip key={id} title={m?.name ?? id}>
              <Avatar size={20} style={{ background: m?.color || "#1677ff" }}>
                {(m?.name ?? "?").slice(0, 1)}
              </Avatar>
            </Tooltip>
          );
        })}
      </Avatar.Group>
    );
  };

  const renderRow = (row: Row, idx: number) => {
    const selected = idx === cursor;
    const cls = `tsp-row${selected ? " is-selected" : ""}`;
    const common = {
      key: `${row.kind}-${row.data.id}`,
      className: cls,
      "data-idx": idx,
      onMouseEnter: () => setCursor(idx),
      onClick: () => go(row),
    };

    if (row.kind === "task") {
      const d = row.data;
      const isMilestone = d.type === "milestone";
      return (
        <div {...common}>
          <span
            className={`tsp-icon tsp-icon-task${isMilestone ? " is-ms" : ""}`}
          >
            {isMilestone ? "◆" : "T"}
          </span>
          <span className="tsp-main">
            <span className="tsp-title">{highlightText(d.name, keyword)}</span>
            <span className="tsp-path">
              {d.customerName ? `${d.customerName} › ` : ""}
              {d.projectName ?? "—"}
            </span>
          </span>
          <span className="tsp-meta">
            {renderAssignees(d.assigneeIds)}
            {d.end && <span className="tsp-due">{d.end}</span>}
            {d.overdueDays > 0 && (
              <Tag color="error" bordered={false}>
                {t("search.overdueDays", { n: d.overdueDays })}
              </Tag>
            )}
            <span className="tsp-progress">
              <i
                className={d.progress >= 100 ? "is-done" : ""}
                style={{ width: `${Math.min(100, d.progress)}%` }}
              />
            </span>
          </span>
        </div>
      );
    }

    if (row.kind === "project") {
      const d = row.data;
      return (
        <div {...common}>
          <span className="tsp-icon tsp-icon-project">P</span>
          <span className="tsp-main">
            <span className="tsp-title">{highlightText(d.name, keyword)}</span>
            <span className="tsp-path">
              {d.customerName ?? "—"}
              {d.openTaskCount > 0
                ? ` · ${t("search.openTasks", { n: d.openTaskCount })}`
                : ""}
            </span>
          </span>
          <span className="tsp-meta">
            {d.end && <span className="tsp-due">{d.end}</span>}
            <span className="tsp-progress">
              <i
                className={d.progress >= 100 ? "is-done" : ""}
                style={{ width: `${Math.min(100, d.progress)}%` }}
              />
            </span>
          </span>
        </div>
      );
    }

    const d = row.data;
    return (
      <div {...common}>
        <span className="tsp-icon tsp-icon-bug">B</span>
        <span className="tsp-main">
          <span className="tsp-title">{highlightText(d.title, keyword)}</span>
          <span className="tsp-path">
            {[bugDisplayNo(d), d.customerName, d.projectName, d.status]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="tsp-meta">
          {d.assigneeName && <span className="tsp-due">{d.assigneeName}</span>}
          {d.reportedOn && <span className="tsp-due">{d.reportedOn}</span>}
        </span>
      </div>
    );
  };

  // 種別ごとの見出しを差し込むため、直前の行と kind が変わったところで <div class="tsp-group">
  const body = () => {
    if (loading && !rows.length)
      return (
        <div className="tsp-state">
          <Spin />
        </div>
      );
    if (!keyword.trim())
      return <div className="tsp-state tsp-hint">{t("search.hint")}</div>;
    if (!rows.length)
      return (
        <div className="tsp-state">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("search.empty", { kw: keyword.trim() })}
          />
        </div>
      );
    const out: React.ReactNode[] = [];
    let prev: string | null = null;
    rows.forEach((row, idx) => {
      if (row.kind !== prev) {
        prev = row.kind;
        out.push(
          <div className="tsp-group" key={`g-${row.kind}`}>
            {t(`search.kind.${row.kind}`)} · {counts[row.kind]}
          </div>
        );
      }
      out.push(renderRow(row, idx));
    });
    return out;
  };

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      closable={false}
      destroyOnHidden
      /* 660px を下限に、画面のおよそ半分まで広がる。上限を切らないと
         ウルトラワイドで 1 行が読み切れない長さになるため 1280px で止める。
         下限より画面が狭いときは .tsp-modal の max-width が効く（max-width は width より優先）。 */
      width="clamp(660px, 50vw, 1280px)"
      style={{ top: 72 }}
      className="tsp-modal"
      afterOpenChange={(o) => {
        if (o) inputRef.current?.focus();
        else {
          setKeyword("");
          setKind("all");
          setResult(EMPTY_SEARCH);
          setCursor(0);
        }
      }}
    >
      <div className="tsp-input">
        <SearchOutlined className="tsp-input-icon" />
        <input
          ref={inputRef}
          value={keyword}
          placeholder={t("search.placeholder")}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKeyword(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            setKeyword(e.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
        />
        {loading && <Spin size="small" />}
        <kbd className="tsp-kbd">ESC</kbd>
      </div>

      <div className="tsp-chips">
        {KIND_CHIPS.map((k) => (
          <button
            type="button"
            key={k}
            className={`tsp-chip${kind === k ? " is-on" : ""}`}
            onClick={() => {
              setKind(k);
              setCursor(0);
            }}
          >
            {t(`search.kind.${k}`)}
            <b>{counts[k]}</b>
          </button>
        ))}
      </div>

      <div className="tsp-body" ref={listRef}>
        {body()}
      </div>

      <div className="tsp-foot">
        <span>
          <kbd>↑↓</kbd>
          {t("search.foot.move")}
        </span>
        <span>
          <kbd>↵</kbd>
          {t("search.foot.open")}
        </span>
        <span>
          <kbd>⇧↵</kbd>
          {t("search.foot.openProject")}
        </span>
      </div>
    </Modal>
  );
}

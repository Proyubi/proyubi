import type { Task } from "../types";

/** {@link matchTasks} の結果。 */
export interface TaskFilterResult {
  /** 実際に名前がヒットしたタスク（<mark> と行の強調に使う） */
  hitIds: Set<string>;
  /** 表示する行（= ヒット + その子孫 + その祖先）。null なら絞り込みなし＝全行 */
  keepIds: Set<string> | null;
  /** ヒット件数（祖先の文脈行は数えない） */
  hitCount: number;
}

/** 絞り込みなしの結果。 */
export const NO_FILTER: TaskFilterResult = {
  hitIds: new Set(),
  keepIds: null,
  hitCount: 0,
};

/**
 * WBS のキーワード絞り込み。タスク名のみを見る（説明や担当者名まで広げると
 * 「なぜヒットしたか」が画面から読めなくなるため）。
 *
 * 木を壊さないための 2 ルール：
 * <ul>
 *   <li><b>祖先は残す</b> — 一致した葉だけ残すと、どのフェーズ配下か分からなくなる。
 *       祖先は文脈行として薄く出す（{@code hitIds} に入らないので強調されない）。</li>
 *   <li><b>ヒットが summary なら子孫ごと残す</b> — フェーズ名で引いたときに
 *       空のフェーズ行だけ出ても意味がない。「その枝を見せて」が期待される挙動。</li>
 * </ul>
 *
 * ロールアップ（集計）はこの関数の外・絞り込み前に全件で走るので、
 * 文脈行に出る日付や進捗は絞り込んでも変わらない。
 */
export function matchTasks(tasks: Task[], keyword: string): TaskFilterResult {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return NO_FILTER;

  const byId = new Map<string, Task>();
  const childrenOf = new Map<string | null, Task[]>();
  for (const t of tasks) {
    byId.set(t.id, t);
    const key = t.parentId;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)?.push(t);
  }

  const hitIds = new Set<string>();
  for (const t of tasks) {
    if (t.name.toLowerCase().includes(kw)) hitIds.add(t.id);
  }

  const keepIds = new Set<string>();
  // 展開済みの印は keepIds と分ける。祖先として先に keepIds へ入った枝を
  // 「もう見た」と誤判定すると、その枝がヒットだったときに子孫を取りこぼす。
  const expanded = new Set<string>();
  const addSubtree = (id: string) => {
    if (expanded.has(id)) return; // 循環データが紛れ込んでも止まる
    expanded.add(id);
    keepIds.add(id);
    for (const c of childrenOf.get(id) ?? []) addSubtree(c.id);
  };
  for (const id of hitIds) {
    addSubtree(id);
    // 祖先を辿って文脈として残す
    let parentId = byId.get(id)?.parentId ?? null;
    while (parentId && !keepIds.has(parentId)) {
      keepIds.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  return { hitIds, keepIds, hitCount: hitIds.size };
}

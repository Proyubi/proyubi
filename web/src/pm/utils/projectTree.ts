import type { Project } from "@/pm/types";
import dayjs from "@/pm/utils/date";

/**
 * サブプロジェクト（pm_project の親子 1 階層）の前端側ヘルパー。
 *
 * 子の一覧は後端の childCount ではなく、一覧 API が返す全プロジェクトの parentId から導出する
 * （サブは親と同じ顧客・チームに固定されるので、同じ一覧に必ず一緒に載る）。
 */

/**
 * 期限超過（自分自身）：終了日が過ぎているのに終わっていないもの。
 * 終了日なし＝継続中（運用型）は期限が無いので対象外。
 */
export function isOwnOverdue(p: Project) {
  return (
    !!p.end &&
    p.status !== "done" &&
    (p.progress ?? 0) < 100 &&
    dayjs(p.end).isBefore(dayjs(), "day")
  );
}

/** 親 id → サブ一覧（一覧の並び＝sort_order 順を保つ） */
export function groupChildren(projects: Project[]) {
  const m = new Map<string, Project[]>();
  for (const p of projects) {
    if (!p.parentId) continue;
    const list = m.get(p.parentId);
    if (list) list.push(p);
    else m.set(p.parentId, [p]);
  }
  return m;
}

export interface SubSummary {
  /** サブ件数 */
  count: number;
  /** うち納品済み */
  done: number;
  /** うち期限超過 */
  overdue: number;
  /** サブがあり、全部納品済み */
  allDone: boolean;
}

export function subSummary(children: Project[] | undefined): SubSummary {
  const list = children ?? [];
  let done = 0;
  let overdue = 0;
  for (const c of list) {
    if (c.status === "done") done += 1;
    if (isOwnOverdue(c)) overdue += 1;
  }
  return {
    count: list.length,
    done,
    overdue,
    allDone: list.length > 0 && done === list.length,
  };
}

/** 親は「自分が期限超過」または「サブのどれかが期限超過」なら期限超過扱い（UI 表示・絞り込み用） */
export function isOverdueWithSubs(p: Project, children: Project[] | undefined) {
  return isOwnOverdue(p) || (children ?? []).some(isOwnOverdue);
}

/** サブの期間が親の期間からはみ出しているか（はみ出していれば延長後の期間を返す） */
export function extendedParentRange(
  parent: Pick<Project, "start" | "end">,
  start: string,
  end: string | null
): { start: string; end: string | null } | null {
  let nextStart = parent.start;
  let nextEnd = parent.end;
  let changed = false;
  if (start < parent.start) {
    nextStart = start;
    changed = true;
  }
  // 親の終了日なし（継続中）は「はみ出し」が起きない
  if (parent.end && end && end > parent.end) {
    nextEnd = end;
    changed = true;
  }
  return changed ? { start: nextStart, end: nextEnd } : null;
}
